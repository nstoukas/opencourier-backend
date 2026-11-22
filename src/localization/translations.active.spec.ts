// Spec 0054 (row 47), AC-8: the backend's completeness guard, part of the build plan's step 1. It fails when
// a key is in one language and not the other, when a text is empty, when an event code has no template,
// or when a template names a value its code does not carry.
import { EVENT_MESSAGE_CODES, EVENT_PART_CODES } from 'src/shared-types/event-messages'
import { el } from './el'
import { en } from './en'
import { translate } from './translate'

// Every leaf of a translation object as `a.b.c` → text.
function leaves(node: unknown, prefix = ''): Map<string, unknown> {
  const found = new Map<string, unknown>()
  if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      const name = prefix ? `${prefix}.${key}` : key
      if (typeof value === 'object' && value !== null) {
        for (const [leaf, text] of leaves(value, name)) found.set(leaf, text)
      } else {
        found.set(name, value)
      }
    }
  }
  return found
}

// `?? ''`: the project's strict index checks type a regex group as possibly undefined.
const placeholders = (text: string | undefined) =>
  [...(text ?? '').matchAll(/\{\{\s*(\w+)/g)].map((match) => match[1] ?? '')
const nestedKeys = (text: string) => [...text.matchAll(/\$t\(([^)]*)\)/g)].map((match) => match[1] ?? '')

describe('Server translations (spec 0054, AC-8)', () => {
  const english = leaves(en)
  const greek = leaves(el)

  test('both languages have the same keys', () => {
    expect([...greek.keys()].sort()).toEqual([...english.keys()].sort())
  })

  test('no text is empty in either language', () => {
    const empty = [...english, ...greek].filter(([, text]) => typeof text !== 'string' || text.trim() === '')
    expect(empty.map(([key]) => key)).toEqual([])
  })

  test('every event code has a template, and every template a code', () => {
    expect(Object.keys(en.server.event).sort()).toEqual(Object.keys(EVENT_MESSAGE_CODES).sort())
    expect(Object.keys(en.server.eventPart).sort()).toEqual(Object.keys(EVENT_PART_CODES).sort())
  })

  test.each([
    ['event', EVENT_MESSAGE_CODES],
    ['eventPart', EVENT_PART_CODES],
  ] as const)('each %s template uses only the values its code carries', (group, codes) => {
    const wrong: string[] = []
    for (const [code, params] of Object.entries(codes)) {
      const allowed = new Set<string>(params)
      for (const [language, file] of [
        ['en', en],
        ['el', el],
      ] as const) {
        const template = (file.server[group] as Record<string, string>)[code]
        for (const name of placeholders(template)) {
          if (!allowed.has(name)) wrong.push(`${language} ${group}.${code}: {{${name}}}`)
        }
      }
      // Every value a code carries is said by at least one language, or it is a fact no reader ever sees.
      // A language may pick: the English record says a removal reason's `label`, the Greek its `labelEl`.
      const said = new Set([
        ...placeholders((en.server[group] as Record<string, string>)[code]),
        ...placeholders((el.server[group] as Record<string, string>)[code]),
      ])
      for (const name of params) {
        if (!said.has(name)) wrong.push(`${group}.${code} never says {{${name}}}`)
      }
    }
    expect(wrong).toEqual([])
  })

  test('every nested key points at a group that exists in both languages', () => {
    const missing: string[] = []
    for (const [language, file] of [
      ['en', english],
      ['el', greek],
    ] as const) {
      for (const [key, text] of file) {
        for (const nested of nestedKeys(String(text))) {
          // `server.enum.boxSize.{{size}}`: the group before the placeholder must have words in it.
          const group = nested.split('.{{')[0] ?? nested
          const hasGroup = [...file.keys()].some((leaf) => leaf.startsWith(`${group}.`))
          if (!hasGroup) missing.push(`${language} ${key} → ${nested}`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  test('a missing key shows the key itself, never a blank', () => {
    expect(translate('el', 'server.event.NOT_A_CODE')).toBe('server.event.NOT_A_CODE')
  })
})
