import * as fs from 'fs'
import * as path from 'path'

// Spec 0023, AC-10 and AC-11, read from the source: `readyAt` and `foodReadyAt` belong to the
// restaurant. Only creation and the restaurant's two actions write them; no rider or admin action,
// no matcher, no pay or price code reads or writes them (row 22 will add offer timing, on purpose).
// A new place that touches either field fails here and must be added deliberately.
describe('ready time ownership guard (spec 0023, AC-10, AC-11)', () => {
  const srcRoot = path.resolve(__dirname, '../../')
  // `readyAt` with a lower case r never matches pickupReadyAt or dropoffReadyAt.
  const READY_FIELD = /\b(readyAt|foodReadyAt)\b/

  function sourceFiles(dir: string): string[] {
    const out: string[] = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) out.push(...sourceFiles(full))
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(full)
    }
    return out
  }

  const rel = (file: string) => path.relative(srcRoot, file).split(path.sep).join('/')
  const read = (relative: string) => fs.readFileSync(path.join(srcRoot, relative), 'utf8')

  // The class method (two space indent) each matching line sits in.
  function methodsMentioning(relative: string): Set<string> {
    const lines = read(relative).split('\n')
    const methods = new Set<string>()
    lines.forEach((line, index) => {
      if (!READY_FIELD.test(line)) return
      for (let i = index; i >= 0; i--) {
        const match = /^ {2}(?:(?:private|public|protected|static|readonly)\s+)*(?:async\s+)?(\w+)\s*[(<]/.exec(lines[i] ?? '')
        if (match?.[1] && !['if', 'for', 'while', 'switch', 'return'].includes(match[1])) {
          methods.add(match[1])
          return
        }
        if (/^(export\s+)?(abstract\s+)?class\s/.test(lines[i] ?? '')) break
      }
      methods.add('<outside a method>')
    })
    return methods
  }

  test('only these files name readyAt or foodReadyAt', () => {
    const touching = sourceFiles(srcRoot)
      .filter((file) => READY_FIELD.test(fs.readFileSync(file, 'utf8')))
      .map(rel)
      .sort()

    expect(touching).toEqual(
      [
        // Creation and the two restaurant actions.
        'domains/delivery/delivery.domain.service.ts',
        'domains/delivery/ready-signals.ts',
        // Wait record (spec 0030: reads only).
        'domains/partner/wait-record.ts',
        'persistence/repositories/delivery.repository.ts',
        // Shapes and read only views.
        'domains/delivery/entities/delivery.entity.ts',
        'domains/delivery/entities/delivery-with-locations.entity.ts',
        'rest-api/delivery/courier/dtos/delivery.courier.dto.ts',
        'rest-api/delivery/partner/dtos/delivery.partner.dto.ts',
        // Telling the holding rider (reads only).
        'services/delivery-event/delivery-event.service.ts',
        'services/pushNotification/offer-push.service.ts',
        'shared-types/notification.ts',
      ].sort()
    )
  })

  test('in DeliveryDomainService only create, delayReady, markFoodReady and their refusal check use them', () => {
    expect([...methodsMentioning('domains/delivery/delivery.domain.service.ts')].sort()).toEqual(
      ['create', 'delayReady', 'markFoodReady', 'refuseReadyAction'].sort()
    )
  })

  test('in DeliveryEventService only holdAfterRiderLeft, notifyReadyUpdated and offerTimingOf use them, and never as a write', () => {
    expect([...methodsMentioning('services/delivery-event/delivery-event.service.ts')].sort()).toEqual(
      ['holdAfterRiderLeft', 'notifyReadyUpdated', 'offerTimingOf'].sort()
    )
  })

  test('in DeliveryRepository only findForWaitRecord mentions them (reads only, spec 0030)', () => {
    expect([...methodsMentioning('persistence/repositories/delivery.repository.ts')]).toEqual(['findForWaitRecord'])
  })

  test('no matching, pay, price or quote code reads them (AC-10)', () => {
    const payAndMatching = sourceFiles(srcRoot)
      .map(rel)
      .filter((file) => /delivery-matching|delivery-calculation|delivery-quote|matcher|pricing/i.test(file))
    expect(payAndMatching.length).toBeGreaterThan(0)
    for (const file of payAndMatching) {
      expect({ file, mentions: READY_FIELD.test(read(file)) }).toEqual({ file, mentions: false })
    }
  })

  test('no request input lets a client send readyAt or foodReadyAt (AC-11: only the two audited actions move them)', () => {
    const inputs = sourceFiles(srcRoot)
      .map(rel)
      .filter((file) => /\/(queries|dtos?)\//.test(file) && /\.(input|args)\.ts$/.test(file))
    expect(inputs.length).toBeGreaterThan(0)
    for (const file of inputs) {
      expect({ file, mentions: READY_FIELD.test(read(file)) }).toEqual({ file, mentions: false })
    }
  })
})
