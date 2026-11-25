// Spec 0054 (row 47), AC-8: the backend's completeness guard, part of the build plan's step 1. It fails when
// a key is in one language and not the other, when a text is empty, when an event code has no template,
// or when a template names a value its code does not carry.
import { EVENT_MESSAGE_CODES, EVENT_PART_CODES } from 'src/shared-types/event-messages'
import {
  BoxSize,
  EnumDeliveryIssueReason,
  EnumDeliveryStatus,
  EnumDispatchStopReason,
  EnumProductReportKind,
  EnumProductReportSource,
  EnumReviewOutcome,
  EnumReviewTopic,
} from '@prisma/types'
import { el } from './el'
import { en } from './en'
import { renderEventMessage, translate } from './translate'

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

  // Review 2026-11-22 Minor: Enum words completeness check across Prisma enums
  test.each([
    ['boxSize', Object.values(BoxSize)],
    ['dispatchStopReason', Object.values(EnumDispatchStopReason)],
    ['reviewTopic', Object.values(EnumReviewTopic)],
    ['reviewOutcome', Object.values(EnumReviewOutcome)],
    ['productReportKind', Object.values(EnumProductReportKind)],
    ['productReportSource', Object.values(EnumProductReportSource)],
    ['deliveryIssueReason', Object.values(EnumDeliveryIssueReason)],
    ['deliveryStatus', Object.values(EnumDeliveryStatus)],
  ] as const)('every enum value for %s has a non-empty translation in both languages', (group, values) => {
    for (const val of values) {
      const enVal = (en.server.enum as Record<string, Record<string, string>>)[group]?.[val]
      const elVal = (el.server.enum as Record<string, Record<string, string>>)[group]?.[val]
      expect(typeof enVal).toBe('string')
      expect(enVal?.trim().length).toBeGreaterThan(0)
      expect(typeof elVal).toBe('string')
      expect(elVal?.trim().length).toBeGreaterThan(0)
    }
  })

  // Review 2026-11-22 Minor: pay, split and removal events retain their IDs when rendered in English
  test('audit and retry checks: rendered English event messages retain their specific id phrases', () => {
    const waitMsg = renderEventMessage('en', 'COURIER_PAID_FOR_WAIT', {
      courierId: 'c-10',
      amount: 250,
      currency: 'EUR',
      minutes: 15,
      centsPerMinute: 10,
      waitOf: 'wait-claim-99',
    })
    expect(waitMsg).toContain('wait wait-claim-99')

    const waitNoteMsg = renderEventMessage('en', 'COURIER_PAID_FOR_WAIT_NOTE', {
      courierId: 'c-10',
      amount: 250,
      currency: 'EUR',
      note: 'special wait',
      waitOf: 'wait-claim-99',
    })
    expect(waitNoteMsg).toContain('wait wait-claim-99')

    const splitWaitMsg = renderEventMessage('en', 'COURIER_PAID_FOR_SPLIT_WAIT', {
      courierId: 'c-10',
      amount: 150,
      currency: 'EUR',
      minutes: 10,
      centsPerMinute: 15,
      splitId: 'split-req-88',
    })
    expect(splitWaitMsg).toContain('split split-req-88')

    const removalMsg = renderEventMessage('en', 'COURIER_PAID_FOR_REMOVAL', {
      courierId: 'c-10',
      amount: 350,
      currency: 'EUR',
      policy: 'FULL_COMPENSATION',
      label: 'Vehicle issue',
      labelEl: null,
      requestId: 'rem-req-77',
    })
    expect(removalMsg).toContain('removal rem-req-77')

    const partnerRemovalMsg = renderEventMessage('en', 'PARTNER_CHARGED_FOR_REMOVAL', {
      amount: 350,
      currency: 'EUR',
      label: 'Vehicle issue',
      labelEl: null,
      requestId: 'rem-req-77',
    })
    expect(partnerRemovalMsg).toContain('removal rem-req-77')

    const reassignedMsg = renderEventMessage('en', 'REASSIGNED', {
      droppedCourierId: 'c-old',
      newCourierId: 'c-new',
      policy: 'FULL_COMPENSATION',
      amount: 350,
      currency: 'EUR',
      awardId: 'award-claim-55',
    })
    expect(reassignedMsg).toContain('(award award-claim-55)')
  })

  // Row 146: ADD_ON_JOINED template pins both IDs and renders in English and Greek
  test('ADD_ON_JOINED event message renders with addOnId and courierId in both languages (row 146)', () => {
    expect(EVENT_MESSAGE_CODES.ADD_ON_JOINED).toEqual(['courierId', 'addOnId'])

    const enMsg = renderEventMessage('en', 'ADD_ON_JOINED', {
      courierId: 'courier-r81',
      addOnId: 'del-add-on-42',
    })
    expect(enMsg).toBe(
      'Delivery del-add-on-42 was added to this job as one more order on the way; courier courier-r81 has taken both'
    )
    expect(enMsg).toContain('del-add-on-42')
    expect(enMsg).toContain('courier-r81')

    const elMsg = renderEventMessage('el', 'ADD_ON_JOINED', {
      courierId: 'courier-r81',
      addOnId: 'del-add-on-42',
    })
    expect(elMsg).toBe(
      'Η παραγγελία del-add-on-42 προστέθηκε σε αυτή τη δουλειά ως μία ακόμα παραγγελία στον δρόμο· ο διανομέας courier-r81 έχει αναλάβει και τις δύο'
    )
    expect(elMsg).toContain('del-add-on-42')
    expect(elMsg).toContain('courier-r81')
  })

  // Row 149: ADD_ON_LEFT template pins both IDs and renders in English and Greek
  test('ADD_ON_LEFT event message renders with addOnId and courierId in both languages (row 149)', () => {
    expect(EVENT_MESSAGE_CODES.ADD_ON_LEFT).toEqual(['courierId', 'addOnId'])

    const enMsg = renderEventMessage('en', 'ADD_ON_LEFT', {
      courierId: 'courier-r81',
      addOnId: 'del-add-on-42',
    })
    expect(enMsg).toBe('Delivery del-add-on-42 was taken off this job; courier courier-r81 no longer has it')
    expect(enMsg).toContain('del-add-on-42')
    expect(enMsg).toContain('courier-r81')

    const elMsg = renderEventMessage('el', 'ADD_ON_LEFT', {
      courierId: 'courier-r81',
      addOnId: 'del-add-on-42',
    })
    expect(elMsg).toBe('Η παραγγελία del-add-on-42 βγήκε από αυτή τη δουλειά· ο διανομέας courier-r81 δεν την έχει πια')
    expect(elMsg).toContain('del-add-on-42')
    expect(elMsg).toContain('courier-r81')
  })

  // Row 172: ACCEPTED_ALONE_BY_SWEEP template pins courierId and deliveryId and renders in English and Greek
  test('ACCEPTED_ALONE_BY_SWEEP event message renders with courierId and deliveryId in both languages (row 172)', () => {
    expect(EVENT_MESSAGE_CODES.ACCEPTED_ALONE_BY_SWEEP).toEqual(['courierId', 'deliveryId'])

    const enMsg = renderEventMessage('en', 'ACCEPTED_ALONE_BY_SWEEP', {
      courierId: 'courier-r172',
      deliveryId: 'del-single-42',
    })
    expect(enMsg).toBe('Courier courier-r172 accepted delivery del-single-42; completed by the minute sweep')
    expect(enMsg).toContain('courier-r172')
    expect(enMsg).toContain('del-single-42')

    const elMsg = renderEventMessage('el', 'ACCEPTED_ALONE_BY_SWEEP', {
      courierId: 'courier-r172',
      deliveryId: 'del-single-42',
    })
    expect(elMsg).toBe(
      'Ο διανομέας courier-r172 αποδέχτηκε την παραγγελία del-single-42· ολοκληρώθηκε από τον έλεγχο του λεπτού'
    )
    expect(elMsg).toContain('courier-r172')
    expect(elMsg).toContain('del-single-42')
  })

  // Row 172 reviews (decision 172.4): ACCEPT_GIVEN_BACK template pins courierId and reason, and renders with each reason
  test('ACCEPT_GIVEN_BACK event message renders in English and Greek with each reason (row 172 reviews)', () => {
    expect(EVENT_MESSAGE_CODES.ACCEPT_GIVEN_BACK).toEqual(['courierId', 'reason'])

    const reasons: Array<{
      reason: 'STOPPED' | 'FAILING' | 'SOS' | 'DEACTIVATED'
      enExpected: string
      elExpected: string
    }> = [
      {
        reason: 'STOPPED',
        enExpected:
          'Courier courier-r172 accepted, but the accept was not completed (dispatch stopped); the order waits for a rider again',
        elExpected:
          'Ο διανομέας courier-r172 αποδέχτηκε, αλλά η αποδοχή δεν ολοκληρώθηκε (παύση διανομών)· η παραγγελία περιμένει ξανά διανομέα',
      },
      {
        reason: 'FAILING',
        enExpected:
          'Courier courier-r172 accepted, but the accept was not completed (it kept failing); the order waits for a rider again',
        elExpected:
          'Ο διανομέας courier-r172 αποδέχτηκε, αλλά η αποδοχή δεν ολοκληρώθηκε (απέτυχε επανειλημμένα)· η παραγγελία περιμένει ξανά διανομέα',
      },
      {
        reason: 'SOS',
        enExpected:
          'Courier courier-r172 accepted, but the accept was not completed (the rider is in SOS); the order waits for a rider again',
        elExpected:
          'Ο διανομέας courier-r172 αποδέχτηκε, αλλά η αποδοχή δεν ολοκληρώθηκε (ο διανομέας είναι σε SOS)· η παραγγελία περιμένει ξανά διανομέα',
      },
      {
        reason: 'DEACTIVATED',
        enExpected:
          'Courier courier-r172 accepted, but the accept was not completed (the rider was deactivated); the order waits for a rider again',
        elExpected:
          'Ο διανομέας courier-r172 αποδέχτηκε, αλλά η αποδοχή δεν ολοκληρώθηκε (ο διανομέας απενεργοποιήθηκε)· η παραγγελία περιμένει ξανά διανομέα',
      },
    ]

    for (const { reason, enExpected, elExpected } of reasons) {
      const enMsg = renderEventMessage('en', 'ACCEPT_GIVEN_BACK', {
        courierId: 'courier-r172',
        reason,
      })
      expect(enMsg).toBe(enExpected)
      expect(enMsg).toContain('courier-r172')

      const elMsg = renderEventMessage('el', 'ACCEPT_GIVEN_BACK', {
        courierId: 'courier-r172',
        reason,
      })
      expect(elMsg).toBe(elExpected)
      expect(elMsg).toContain('courier-r172')
    }
  })
})
