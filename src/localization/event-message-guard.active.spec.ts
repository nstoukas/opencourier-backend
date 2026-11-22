// Spec 0054 (row 47), cross check 4: the guard the spec names as part of the build. It fails when any code
// writes a DeliveryEvent with a `message` typed by hand instead of a code (eventText / storedEventText),
// because such a row could only ever be read in English.
//
// It reads the source with the TypeScript parser rather than a regular expression, so a template literal
// spread over several lines is still found. What it looks for: an object literal that names an event type
// (`type: EnumDeliveryEventType.X`) and also has its own `message` property. The text must instead arrive
// by a spread (`...eventText(...)`, `...text`, `...storedEventText(...)`), which carries the code with it.
// A `where:` filter is a read, not a write, and is left alone (rows written before spec 0054 are still
// found by their message).
import * as fs from 'fs'
import * as path from 'path'
import * as ts from 'typescript'

const ROOT = path.resolve(__dirname, '../..')

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'client') continue
      found.push(...sourceFiles(full))
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') && !entry.name.endsWith('.d.ts')) {
      found.push(full)
    }
  }
  return found
}

function propertyName(property: ts.ObjectLiteralElementLike): string | null {
  if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
    return property.name.getText()
  }
  return null
}

// Every hand typed event message: `file:line` for each object literal breaking the rule.
function handTypedEventMessages(name: string, text: string): string[] {
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true)
  const offences: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const namesAnEventType = node.properties.some(
        (property) =>
          ts.isPropertyAssignment(property) &&
          property.name.getText() === 'type' &&
          property.initializer.getText().startsWith('EnumDeliveryEventType.')
      )
      const hasOwnMessage = node.properties.some((property) => propertyName(property) === 'message')
      const isAFilter = ts.isPropertyAssignment(node.parent) && node.parent.name.getText() === 'where'
      if (namesAnEventType && hasOwnMessage && !isAFilter) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart())
        offences.push(`${name}:${line + 1}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return offences
}

describe('Event messages are written as codes (spec 0054, cross check 4)', () => {
  const files = [...sourceFiles(path.join(ROOT, 'src')), ...sourceFiles(path.join(ROOT, 'scripts'))]

  test('the scan reads the files that write events', () => {
    // A guard that silently reads nothing passes for the wrong reason: make sure the main writers are in.
    const names = files.map((file) => path.relative(ROOT, file))
    expect(names).toContain(path.join('src', 'services', 'delivery-event', 'delivery-event.service.ts'))
    expect(names).toContain(path.join('src', 'domains', 'delivery', 'delivery.domain.service.ts'))
    expect(names).toContain(path.join('src', 'persistence', 'repositories', 'review-request.repository.ts'))
  })

  test('no DeliveryEvent is written with a hand typed message', () => {
    const offences = files.flatMap((file) =>
      handTypedEventMessages(path.relative(ROOT, file), fs.readFileSync(file, 'utf8'))
    )
    expect(offences).toEqual([])
  })

  test('the scan catches a hand typed message', () => {
    // The rule itself, on a made up file, so a broken scan cannot pass the test above by finding nothing.
    const sample =
      "const e = { deliveryId: 'd', type: EnumDeliveryEventType.CREATED, message: `made ${'d'}` }\n" +
      "const ok = { deliveryId: 'd', type: EnumDeliveryEventType.CREATED, ...eventText('SEEDED_COMPLETED', {}) }\n" +
      "const read = find({ where: { type: EnumDeliveryEventType.CREATED, message: 'x' } })\n"
    expect(handTypedEventMessages('sample.ts', sample)).toEqual(['sample.ts:1'])
  })
})
