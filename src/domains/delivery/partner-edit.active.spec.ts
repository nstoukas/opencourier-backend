import { EnumDeliveryStatus } from '@prisma/types'
import { DELIVERY_ONGOING_STATUSES } from 'src/shared-types/stateMachine'
import { PARTNER_ENDED_STATUSES } from 'src/domains/delivery/ready-signals'
import { PARTNER_EDIT_SENTENCES, partnerEditRefusal, riderVisibleEdits, tipAfterPartnerEdit } from './partner-edit'
import { ERROR_SENTENCE_CODES } from 'src/localization/error-sentences'
import { en } from 'src/localization/en'
import { el } from 'src/localization/el'

// Row 152: what a restaurant's edit of its own delivery may change, by status.
// Pure functions partnerEditRefusal and tipAfterPartnerEdit.
describe('partner-edit rules (Row 152)', () => {
  const ALL_ELEVEN_STATUSES: EnumDeliveryStatus[] = [
    EnumDeliveryStatus.CREATED,
    EnumDeliveryStatus.ASSIGNING_COURIER,
    EnumDeliveryStatus.ACCEPTED,
    EnumDeliveryStatus.DISPATCHED,
    EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
    EnumDeliveryStatus.PICKED_UP,
    EnumDeliveryStatus.ON_THE_WAY,
    EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
    EnumDeliveryStatus.DROPPED_OFF,
    EnumDeliveryStatus.CANCELED,
    EnumDeliveryStatus.FAILED,
  ].filter(Boolean)

  describe('partnerEditRefusal - exhaustively testing all 11 statuses', () => {
    test('covers all 11 statuses from EnumDeliveryStatus', () => {
      const allEnumStatuses = Object.values(EnumDeliveryStatus)
      expect(allEnumStatuses).toHaveLength(11)
      expect(new Set(allEnumStatuses)).toEqual(
        new Set([
          EnumDeliveryStatus.CREATED,
          EnumDeliveryStatus.ASSIGNING_COURIER,
          EnumDeliveryStatus.ACCEPTED,
          EnumDeliveryStatus.DISPATCHED,
          EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
          EnumDeliveryStatus.PICKED_UP,
          EnumDeliveryStatus.ON_THE_WAY,
          EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
          EnumDeliveryStatus.DROPPED_OFF,
          EnumDeliveryStatus.CANCELED,
          EnumDeliveryStatus.FAILED,
        ])
      )
    })

    describe('when point is NOT moved (pointMoved = false)', () => {
      test.each([EnumDeliveryStatus.DROPPED_OFF, EnumDeliveryStatus.CANCELED, EnumDeliveryStatus.FAILED])(
        'ended status %s refuses with ended sentence',
        (status) => {
          expect(partnerEditRefusal(status, false)).toBe(PARTNER_EDIT_SENTENCES.ended)
        }
      )

      test.each([EnumDeliveryStatus.CREATED, EnumDeliveryStatus.ASSIGNING_COURIER])(
        'unassigned status %s allows edit (returns null)',
        (status) => {
          expect(partnerEditRefusal(status, false)).toBeNull()
        }
      )

      test.each(DELIVERY_ONGOING_STATUSES)('held status %s allows non-point edit (returns null)', (status) => {
        expect(partnerEditRefusal(status, false)).toBeNull()
      })
    })

    describe('when point IS moved (pointMoved = true)', () => {
      test.each([EnumDeliveryStatus.DROPPED_OFF, EnumDeliveryStatus.CANCELED, EnumDeliveryStatus.FAILED])(
        'ended status %s prioritises ended refusal over held check',
        (status) => {
          expect(partnerEditRefusal(status, true)).toBe(PARTNER_EDIT_SENTENCES.ended)
        }
      )

      test.each(DELIVERY_ONGOING_STATUSES)('held status %s refuses point move with pointHeld sentence', (status) => {
        expect(partnerEditRefusal(status, true)).toBe(PARTNER_EDIT_SENTENCES.pointHeld)
      })

      test.each([EnumDeliveryStatus.CREATED, EnumDeliveryStatus.ASSIGNING_COURIER])(
        'unassigned status %s allows point move (returns null)',
        (status) => {
          expect(partnerEditRefusal(status, true)).toBeNull()
        }
      )
    })

    test('ended statuses match PARTNER_ENDED_STATUSES exactly', () => {
      expect([...PARTNER_ENDED_STATUSES].sort()).toEqual(
        [EnumDeliveryStatus.DROPPED_OFF, EnumDeliveryStatus.CANCELED, EnumDeliveryStatus.FAILED].sort()
      )
    })

    test('ongoing statuses match DELIVERY_ONGOING_STATUSES exactly', () => {
      expect([...DELIVERY_ONGOING_STATUSES].sort()).toEqual(
        [
          EnumDeliveryStatus.ACCEPTED,
          EnumDeliveryStatus.DISPATCHED,
          EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
          EnumDeliveryStatus.PICKED_UP,
          EnumDeliveryStatus.ON_THE_WAY,
          EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
        ].sort()
      )
    })
  })

  describe('tipAfterPartnerEdit (decision 152.4)', () => {
    test.each(DELIVERY_ONGOING_STATUSES)('held status %s preserves current tips and ignores sent tips', (status) => {
      expect(tipAfterPartnerEdit(status, 250, 0)).toBe(250)
      expect(tipAfterPartnerEdit(status, 150, 500)).toBe(150)
      expect(tipAfterPartnerEdit(status, 0, 300)).toBe(0)
    })

    test.each([EnumDeliveryStatus.CREATED, EnumDeliveryStatus.ASSIGNING_COURIER])(
      'unassigned status %s adopts sent tips',
      (status) => {
        expect(tipAfterPartnerEdit(status, 0, 300)).toBe(300)
        expect(tipAfterPartnerEdit(status, 200, 0)).toBe(0)
        expect(tipAfterPartnerEdit(status, 150, 500)).toBe(500)
      }
    )

    test.each(PARTNER_ENDED_STATUSES)('ended status %s evaluates to sent tips if called directly', (status) => {
      expect(tipAfterPartnerEdit(status, 100, 200)).toBe(200)
    })
  })

  describe('localization and sentence mappings', () => {
    test('ERROR_SENTENCE_CODES maps PARTNER_EDIT_SENTENCES.ended to PARTNER_EDIT_ORDER_ENDED', () => {
      const entry = ERROR_SENTENCE_CODES.find(([sentence]) => sentence === PARTNER_EDIT_SENTENCES.ended)
      expect(entry).toBeDefined()
      expect(entry?.[1]).toBe('PARTNER_EDIT_ORDER_ENDED')
    })

    test('ERROR_SENTENCE_CODES maps PARTNER_EDIT_SENTENCES.pointHeld to PARTNER_EDIT_POINT_HELD', () => {
      const entry = ERROR_SENTENCE_CODES.find(([sentence]) => sentence === PARTNER_EDIT_SENTENCES.pointHeld)
      expect(entry).toBeDefined()
      expect(entry?.[1]).toBe('PARTNER_EDIT_POINT_HELD')
    })

    test('ERROR_SENTENCE_CODES maps PARTNER_EDIT_SENTENCES.changed to PARTNER_EDIT_CHANGED (Row 161)', () => {
      const entry = ERROR_SENTENCE_CODES.find(([sentence]) => sentence === PARTNER_EDIT_SENTENCES.changed)
      expect(entry).toBeDefined()
      expect(entry?.[1]).toBe('PARTNER_EDIT_CHANGED')
    })

    test('en dictionary matches PARTNER_EDIT_SENTENCES in English', () => {
      expect(en.server.error.PARTNER_EDIT_ORDER_ENDED).toBe(PARTNER_EDIT_SENTENCES.ended)
      expect(en.server.error.PARTNER_EDIT_POINT_HELD).toBe(PARTNER_EDIT_SENTENCES.pointHeld)
      expect(en.server.error.PARTNER_EDIT_CHANGED).toBe(PARTNER_EDIT_SENTENCES.changed)
    })

    test('el dictionary provides Greek translations', () => {
      expect(el.server.error.PARTNER_EDIT_ORDER_ENDED).toBe(
        'Αυτή η παραγγελία έχει ολοκληρωθεί, οπότε δεν αλλάζει πια.'
      )
      expect(el.server.error.PARTNER_EDIT_POINT_HELD).toBe(
        'Ένας διανομέας έχει ήδη αναλάβει αυτή την παραγγελία, οπότε το σημείο παράδοσης δεν μετακινείται. Στείλτε μήνυμα στη διανομή για να το αλλάξετε.'
      )
      expect(el.server.error.PARTNER_EDIT_CHANGED).toBe('Η παραγγελία μόλις άλλαξε. Δείτε την ξανά πριν αποθηκεύσετε.')
    })
  })
})

describe('riderVisibleEdits (Row 164)', () => {
  const baseDelivery = {
    status: EnumDeliveryStatus.DISPATCHED,
    courierId: 'courier-1',
    pickupNotes: 'Pickup note',
    dropoffNotes: 'Dropoff note',
    pickupReadyAt: new Date('2026-11-25T12:00:00.000Z'),
    pickupDeadlineAt: new Date('2026-11-25T12:30:00.000Z'),
    dropoffReadyAt: new Date('2026-11-25T12:35:00.000Z'),
    dropoffDeadlineAt: new Date('2026-11-25T13:00:00.000Z'),
  }

  describe('unheld or non-ongoing deliveries answer empty list', () => {
    test('returns [] when courierId is null, even with ongoing status', () => {
      for (const status of DELIVERY_ONGOING_STATUSES) {
        const result = riderVisibleEdits(
          { ...baseDelivery, status, courierId: null },
          { pickupNotes: 'Changed note' }
        )
        expect(result).toEqual([])
      }
    })

    test.each([
      EnumDeliveryStatus.CREATED,
      EnumDeliveryStatus.ASSIGNING_COURIER,
      EnumDeliveryStatus.DROPPED_OFF,
      EnumDeliveryStatus.CANCELED,
      EnumDeliveryStatus.FAILED,
    ])('returns [] for non-ongoing status %s even when courierId is present', (status) => {
      const result = riderVisibleEdits(
        { ...baseDelivery, status, courierId: 'courier-1' },
        { pickupNotes: 'Changed note', pickupReadyAt: new Date('2026-11-25T12:15:00.000Z') }
      )
      expect(result).toEqual([])
    })

    test.each(DELIVERY_ONGOING_STATUSES)(
      'answers changed fields for held delivery in ongoing status %s',
      (status) => {
        const result = riderVisibleEdits(
          { ...baseDelivery, status, courierId: 'courier-1' },
          { pickupNotes: 'New note' }
        )
        expect(result).toEqual(['NOTES'])
      }
    )
  })

  describe('notes changes', () => {
    test('pickupNotes changed answers [NOTES]', () => {
      const result = riderVisibleEdits(baseDelivery, { pickupNotes: 'Different pickup note' })
      expect(result).toEqual(['NOTES'])
    })

    test('dropoffNotes changed answers [NOTES]', () => {
      const result = riderVisibleEdits(baseDelivery, { dropoffNotes: 'Different dropoff note' })
      expect(result).toEqual(['NOTES'])
    })

    test('both pickupNotes and dropoffNotes changed answers [NOTES] only once', () => {
      const result = riderVisibleEdits(baseDelivery, {
        pickupNotes: 'New pickup note',
        dropoffNotes: 'New dropoff note',
      })
      expect(result).toEqual(['NOTES'])
    })

    test('empty notes and null notes are the same (no change)', () => {
      // delivery has null, input has empty string
      expect(
        riderVisibleEdits({ ...baseDelivery, pickupNotes: null }, { pickupNotes: '' })
      ).toEqual([])

      // delivery has empty string, input has null
      expect(
        riderVisibleEdits({ ...baseDelivery, pickupNotes: '' }, { pickupNotes: null })
      ).toEqual([])

      // both null
      expect(
        riderVisibleEdits({ ...baseDelivery, pickupNotes: null }, { pickupNotes: null })
      ).toEqual([])

      // both empty string
      expect(
        riderVisibleEdits({ ...baseDelivery, pickupNotes: '' }, { pickupNotes: '' })
      ).toEqual([])

      // same for dropoffNotes
      expect(
        riderVisibleEdits({ ...baseDelivery, dropoffNotes: null }, { dropoffNotes: '' })
      ).toEqual([])
      expect(
        riderVisibleEdits({ ...baseDelivery, dropoffNotes: '' }, { dropoffNotes: null })
      ).toEqual([])
    })

    test('field left undefined is no change', () => {
      const result = riderVisibleEdits(baseDelivery, { pickupNotes: undefined, dropoffNotes: undefined })
      expect(result).toEqual([])
    })
  })

  describe('times changes', () => {
    test.each([
      ['pickupReadyAt', { pickupReadyAt: new Date('2026-11-25T12:05:00.000Z') }],
      ['pickupDeadlineAt', { pickupDeadlineAt: new Date('2026-11-25T12:35:00.000Z') }],
      ['dropoffReadyAt', { dropoffReadyAt: new Date('2026-11-25T12:40:00.000Z') }],
      ['dropoffDeadlineAt', { dropoffDeadlineAt: new Date('2026-11-25T13:05:00.000Z') }],
    ])('%s changed answers [TIMES]', (_field, input) => {
      const result = riderVisibleEdits(baseDelivery, input)
      expect(result).toEqual(['TIMES'])
    })

    test('multiple times changed answers [TIMES] only once', () => {
      const result = riderVisibleEdits(baseDelivery, {
        pickupReadyAt: new Date('2026-11-25T12:05:00.000Z'),
        pickupDeadlineAt: new Date('2026-11-25T12:35:00.000Z'),
        dropoffReadyAt: new Date('2026-11-25T12:40:00.000Z'),
        dropoffDeadlineAt: new Date('2026-11-25T13:05:00.000Z'),
      })
      expect(result).toEqual(['TIMES'])
    })

    test('the same moment as a Date and as ISO text is no change', () => {
      const isoText = '2026-11-25T12:00:00.000Z'
      const sameDate = new Date(isoText)
      const deliveryWithDate = { ...baseDelivery, pickupReadyAt: sameDate }

      expect(riderVisibleEdits(deliveryWithDate, { pickupReadyAt: isoText })).toEqual([])
      expect(riderVisibleEdits(deliveryWithDate, { pickupReadyAt: sameDate })).toEqual([])
    })

    test('null time and null input is no change', () => {
      const deliveryWithNull = { ...baseDelivery, pickupReadyAt: null }
      expect(riderVisibleEdits(deliveryWithNull, { pickupReadyAt: null })).toEqual([])
    })

    test('time changed from null to Date answers [TIMES]', () => {
      const deliveryWithNull = { ...baseDelivery, pickupReadyAt: null }
      expect(
        riderVisibleEdits(deliveryWithNull, { pickupReadyAt: new Date('2026-11-25T12:00:00.000Z') })
      ).toEqual(['TIMES'])
    })

    test('time changed from Date to null answers [TIMES]', () => {
      expect(riderVisibleEdits(baseDelivery, { pickupReadyAt: null })).toEqual(['TIMES'])
    })

    test('times left undefined is no change', () => {
      const result = riderVisibleEdits(baseDelivery, {
        pickupReadyAt: undefined,
        pickupDeadlineAt: undefined,
        dropoffReadyAt: undefined,
        dropoffDeadlineAt: undefined,
      })
      expect(result).toEqual([])
    })
  })

  describe('both notes and times changed', () => {
    test('answers [NOTES, TIMES] in that exact order', () => {
      const result = riderVisibleEdits(baseDelivery, {
        pickupNotes: 'Brand new note',
        pickupReadyAt: new Date('2026-11-25T12:15:00.000Z'),
      })
      expect(result).toEqual(['NOTES', 'TIMES'])
    })

    test('empty input object answers [] (no change)', () => {
      expect(riderVisibleEdits(baseDelivery, {})).toEqual([])
    })
  })
})
