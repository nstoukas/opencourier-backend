import { EnumCourierStatus, EnumDeliveryIssueReason, EnumDeliveryStatus } from '@prisma/types'
import { INSTANCE_TIMEZONE } from 'src/constants'
import { dayjs } from 'src/core/utils/time'
import { DeliveryOfferView } from 'src/domains/delivery/types/delivery-offer-view.type'
import {
  DeliveredToday,
  LiveDelivery,
  WorkingCourier,
} from 'src/persistence/repositories/dispatch-board.repository'
import { OpenDeliveryIssue } from 'src/persistence/repositories/delivery-issue.repository'
import { SosIncidentWithPeople } from 'src/persistence/repositories/sos-incident.repository'
import {
  ATTENTION_KIND,
  AttentionRow,
  buildCards,
  buildMap,
  offerUnansweredRows,
  orderAttentionRows,
  restaurantLateRows,
  riderReportRows,
  sosRows,
  todayBounds,
  waitingForRiderRows,
  unreadMessageRows,
  UNREAD_MESSAGE_PREVIEW_LENGTH,
} from './dispatch-board'

describe('Dispatch Board pure functions (spec 0034)', () => {
  const BASE_NOW = new Date('2026-11-09T14:00:00.000Z')

  function createLiveDelivery(overrides: Partial<LiveDelivery> = {}): LiveDelivery {
    return {
      id: 'del-1',
      status: EnumDeliveryStatus.ASSIGNING_COURIER,
      courierId: null,
      matchedCourierId: null,
      offeredAt: null,
      offerExpiresAt: null,
      offerGroupId: null,
      stopSequence: null,
      addOnExtraMetres: null,
      addOnExtraSeconds: null,
      orderReference: 'ORD-101',
      pickupBusinessName: 'Souvlaki tou Nikou',
      dropoffName: 'Elena Kostopoulou',
      dropoffBusinessName: null,
      createdAt: new Date('2026-11-09T13:45:00.000Z'),
      readyAt: null,
      foodReadyAt: null,
      promisedReadyAt: null,
      undispatchedAt: null,
      pickupLocation: { latitude: 39.362, longitude: 22.942 },
      courier: null,
      ...overrides,
    }
  }

  function createWorkingCourier(overrides: Partial<WorkingCourier> = {}): WorkingCourier {
    return {
      id: 'courier-1',
      name: 'Nikos Papastamou',
      status: EnumCourierStatus.ONLINE,
      busy: false,
      latitude: 39.361,
      longitude: 22.941,
      ...overrides,
    }
  }

  // AC-2: Card maths
  describe('buildCards (AC-2)', () => {
    test('active deliveries: toPickup counts ACCEPTED, DISPATCHED, COURIER_ARRIVED_AT_PICKUP_LOCATION', () => {
      const deliveries: LiveDelivery[] = [
        createLiveDelivery({ id: 'd-1', status: EnumDeliveryStatus.ACCEPTED }),
        createLiveDelivery({ id: 'd-2', status: EnumDeliveryStatus.DISPATCHED }),
        createLiveDelivery({ id: 'd-3', status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION }),
      ]

      const cards = buildCards(deliveries, [], [], BASE_NOW)

      expect(cards.active.toPickup).toBe(3)
      expect(cards.active.toDropoff).toBe(0)
      expect(cards.active.total).toBe(3)
    })

    test('active deliveries: toDropoff counts PICKED_UP, ON_THE_WAY, COURIER_ARRIVED_AT_DROPOFF_LOCATION', () => {
      const deliveries: LiveDelivery[] = [
        createLiveDelivery({ id: 'd-1', status: EnumDeliveryStatus.PICKED_UP }),
        createLiveDelivery({ id: 'd-2', status: EnumDeliveryStatus.ON_THE_WAY }),
        createLiveDelivery({ id: 'd-3', status: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION }),
      ]

      const cards = buildCards(deliveries, [], [], BASE_NOW)

      expect(cards.active.toPickup).toBe(0)
      expect(cards.active.toDropoff).toBe(3)
      expect(cards.active.total).toBe(3)
    })

    test('active deliveries: CREATED, ASSIGNING_COURIER, DROPPED_OFF, CANCELED do not count toward active cards', () => {
      const deliveries: LiveDelivery[] = [
        createLiveDelivery({ id: 'd-1', status: EnumDeliveryStatus.CREATED }),
        createLiveDelivery({ id: 'd-2', status: EnumDeliveryStatus.ASSIGNING_COURIER }),
        createLiveDelivery({ id: 'd-3', status: EnumDeliveryStatus.DROPPED_OFF }),
        createLiveDelivery({ id: 'd-4', status: EnumDeliveryStatus.CANCELED }),
        createLiveDelivery({ id: 'd-5', status: EnumDeliveryStatus.FAILED }),
      ]

      const cards = buildCards(deliveries, [], [], BASE_NOW)

      expect(cards.active.toPickup).toBe(0)
      expect(cards.active.toDropoff).toBe(0)
      expect(cards.active.total).toBe(0)
    })

    test('waiting card: counts ASSIGNING_COURIER with no courierId only (CREATED left out, ASSIGNING_COURIER with courierId left out)', () => {
      const deliveries: LiveDelivery[] = [
        createLiveDelivery({
          id: 'wait-1',
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId: null,
          createdAt: new Date('2026-11-09T13:40:00.000Z'), // 20 min ago
        }),
        createLiveDelivery({
          id: 'wait-2',
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId: null,
          createdAt: new Date('2026-11-09T13:50:00.000Z'), // 10 min ago
        }),
        // CREATED lasts an instant and is left out of waiting count
        createLiveDelivery({ id: 'created-1', status: EnumDeliveryStatus.CREATED, courierId: null }),
        // ASSIGNING_COURIER with a courierId (should not happen in healthy state, but guard ensures only null courierId counts)
        createLiveDelivery({ id: 'assigned-1', status: EnumDeliveryStatus.ASSIGNING_COURIER, courierId: 'c-1' }),
      ]

      const cards = buildCards(deliveries, [], [], BASE_NOW)

      expect(cards.waiting.total).toBe(2)
      expect(cards.waiting.oldestWaitingMinutes).toBe(20)
    })

    test('waiting card: counts ASSIGNING_COURIER with an open offer (matchedCourierId set) as waiting (AC-2)', () => {
      const deliveries: LiveDelivery[] = [
        createLiveDelivery({
          id: 'wait-unoffered',
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId: null,
          matchedCourierId: null,
          createdAt: new Date('2026-11-09T13:40:00.000Z'), // 20 min ago
        }),
        // An open offer: ASSIGNING_COURIER, no courierId, matchedCourierId set. AC-2: same set the list shows
        createLiveDelivery({
          id: 'wait-offered',
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId: null,
          matchedCourierId: 'courier-1',
          createdAt: new Date('2026-11-09T13:30:00.000Z'), // 30 min ago (oldest waiting)
        }),
      ]

      const cards = buildCards(deliveries, [], [], BASE_NOW)

      expect(cards.waiting.total).toBe(2)
      expect(cards.waiting.oldestWaitingMinutes).toBe(30)
    })

    test('waiting card: when no deliveries are waiting, shows 0 and oldestWaitingMinutes is null', () => {
      const cards = buildCards([], [], [], BASE_NOW)

      expect(cards.waiting.total).toBe(0)
      expect(cards.waiting.oldestWaitingMinutes).toBeNull()
    })

    test('couriers card: counts busy, free and Last Call correctly', () => {
      const couriers: WorkingCourier[] = [
        createWorkingCourier({ id: 'c-1', status: EnumCourierStatus.ONLINE, busy: true }),
        createWorkingCourier({ id: 'c-2', status: EnumCourierStatus.ONLINE, busy: false }),
        createWorkingCourier({ id: 'c-3', status: EnumCourierStatus.ONLINE, busy: false }),
        createWorkingCourier({ id: 'c-4', status: EnumCourierStatus.LAST_CALL, busy: true }),
        createWorkingCourier({ id: 'c-5', status: EnumCourierStatus.LAST_CALL, busy: false }),
      ]

      const cards = buildCards([], couriers, [], BASE_NOW)

      // total online + lastCall = 3 + 2 = 5
      expect(cards.couriers.total).toBe(5)
      // busy: ONLINE and busy = 1
      expect(cards.couriers.busy).toBe(1)
      // free: ONLINE and not busy = 2
      expect(cards.couriers.free).toBe(2)
      // lastCall: total LAST_CALL = 2
      expect(cards.couriers.lastCall).toBe(2)
    })

    test('delivered today: median from Delivery.createdAt to DROPPED_OFF occurredAt, none when count is 0', () => {
      // 0 delivered
      const emptyCards = buildCards([], [], [], BASE_NOW)
      expect(emptyCards.deliveredToday.total).toBe(0)
      expect(emptyCards.deliveredToday.medianMinutes).toBeNull()

      // 3 delivered with doorToDoor of 15 min, 25 min, 35 min -> median is 25 min
      const delivered: DeliveredToday[] = [
        {
          deliveryId: 'd-1',
          createdAt: new Date('2026-11-09T10:00:00.000Z'),
          occurredAt: new Date('2026-11-09T10:15:00.000Z'), // 15 min
        },
        {
          deliveryId: 'd-2',
          createdAt: new Date('2026-11-09T11:00:00.000Z'),
          occurredAt: new Date('2026-11-09T11:25:00.000Z'), // 25 min
        },
        {
          deliveryId: 'd-3',
          createdAt: new Date('2026-11-09T12:00:00.000Z'),
          occurredAt: new Date('2026-11-09T12:35:00.000Z'), // 35 min
        },
      ]

      const cards = buildCards([], [], delivered, BASE_NOW)
      expect(cards.deliveredToday.total).toBe(3)
      expect(cards.deliveredToday.medianMinutes).toBe(25)
    })
  })

  // AC-2: todayBounds timezone calculations
  describe('todayBounds (AC-2)', () => {
    test('today means INSTANCE_TIMEZONE (Europe/Athens), not UTC, including delivery just after local midnight', () => {
      // Athens in November is UTC+2 (EET).
      // Local time in Athens: 2026-11-09 00:05:00
      // In UTC: 2026-11-08 22:05:00Z
      const justAfterLocalMidnightUtc = new Date('2026-11-08T22:05:00.000Z')

      const bounds = todayBounds(justAfterLocalMidnightUtc)

      // Start of day in Athens on Nov 9: 2026-11-09 00:00:00 Athens = 2026-11-08 22:00:00Z
      expect(bounds.start.toISOString()).toBe('2026-11-08T22:00:00.000Z')
      // End of day (next day start): 2026-11-10 00:00:00 Athens = 2026-11-09 22:00:00Z
      expect(bounds.end.toISOString()).toBe('2026-11-09T22:00:00.000Z')

      // The delivery just after midnight falls within these bounds!
      expect(justAfterLocalMidnightUtc.getTime()).toBeGreaterThanOrEqual(bounds.start.getTime())
      expect(justAfterLocalMidnightUtc.getTime()).toBeLessThan(bounds.end.getTime())
    })

    test('on Athens autumn clock change day (2026-10-25), window is 25 hours ending at next local midnight 2026-10-25T22:00:00.000Z', () => {
      // Athens leaves summer time on Sunday 2026-10-25: 04:00 EEST (UTC+3) -> 03:00 EET (UTC+2).
      // The local day lasts 25 hours.
      // Start: 2026-10-25 00:00:00 EEST = 2026-10-24T21:00:00.000Z
      // End: next local midnight 2026-10-26 00:00:00 EET = 2026-10-25T22:00:00.000Z
      const now = new Date('2026-10-25T12:00:00.000Z')
      const bounds = todayBounds(now)

      expect(bounds.start.toISOString()).toBe('2026-10-24T21:00:00.000Z')
      expect(bounds.end.toISOString()).toBe('2026-10-25T22:00:00.000Z')
      // Window duration must be exactly 25 hours (90,000,000 ms)
      const durationHours = (bounds.end.getTime() - bounds.start.getTime()) / (60 * 60 * 1000)
      expect(durationHours).toBe(25)
      // Must fail if end goes back to start plus 24 hours (2026-10-25T21:00:00.000Z)
      expect(bounds.end.toISOString()).not.toBe('2026-10-25T21:00:00.000Z')
    })

    test('on Athens spring clock change day (2027-03-28), window is 23 hours ending at next local midnight 2027-03-28T21:00:00.000Z', () => {
      // Athens enters summer time on Sunday 2027-03-28: 03:00 EET (UTC+2) -> 04:00 EEST (UTC+3).
      // The local day lasts 23 hours.
      // Start: 2027-03-28 00:00:00 EET = 2027-03-27T22:00:00.000Z
      // End: next local midnight 2027-03-29 00:00:00 EEST = 2027-03-28T21:00:00.000Z
      const now = new Date('2027-03-28T12:00:00.000Z')
      const bounds = todayBounds(now)

      expect(bounds.start.toISOString()).toBe('2027-03-27T22:00:00.000Z')
      expect(bounds.end.toISOString()).toBe('2027-03-28T21:00:00.000Z')
      // Window duration must be exactly 23 hours (82,800,000 ms)
      const durationHours = (bounds.end.getTime() - bounds.start.getTime()) / (60 * 60 * 1000)
      expect(durationHours).toBe(23)
      // Must fail if end goes back to start plus 24 hours (2027-03-28T22:00:00.000Z)
      expect(bounds.end.toISOString()).not.toBe('2027-03-28T22:00:00.000Z')
    })

    test('an ordinary day stays exactly 24 hours', () => {
      // Ordinary day with no clock change (e.g. 2026-11-09)
      const now = new Date('2026-11-09T14:00:00.000Z')
      const bounds = todayBounds(now)

      expect(bounds.start.toISOString()).toBe('2026-11-08T22:00:00.000Z')
      expect(bounds.end.toISOString()).toBe('2026-11-09T22:00:00.000Z')
      const durationHours = (bounds.end.getTime() - bounds.start.getTime()) / (60 * 60 * 1000)
      expect(durationHours).toBe(24)
    })

    test.each(['UTC', 'Asia/Tokyo', 'America/New_York'])(
      'todayBounds produces identical results regardless of system TZ environment variable (TZ=%s)',
      (tz) => {
        const originalTz = process.env.TZ
        try {
          process.env.TZ = tz
          const testTime = new Date('2026-11-09T12:00:00.000Z')
          const bounds = todayBounds(testTime)

          // In Athens, 12:00 UTC is 14:00 EET. Start of day is 00:00 EET = 2026-11-08T22:00:00.000Z
          expect(bounds.start.toISOString()).toBe('2026-11-08T22:00:00.000Z')
          expect(bounds.end.toISOString()).toBe('2026-11-09T22:00:00.000Z')
          expect((bounds.end.getTime() - bounds.start.getTime()) / 3600000).toBe(24)
        } finally {
          process.env.TZ = originalTz
        }
      }
    )

    test.each(['UTC', 'Asia/Tokyo'])(
      'clock change days produce identical 25h and 23h bounds regardless of system TZ (TZ=%s)',
      (tz) => {
        const originalTz = process.env.TZ
        try {
          process.env.TZ = tz

          // Autumn 25h day: 2026-10-25
          const autumnBounds = todayBounds(new Date('2026-10-25T14:00:00.000Z'))
          expect(autumnBounds.start.toISOString()).toBe('2026-10-24T21:00:00.000Z')
          expect(autumnBounds.end.toISOString()).toBe('2026-10-25T22:00:00.000Z')
          expect((autumnBounds.end.getTime() - autumnBounds.start.getTime()) / 3600000).toBe(25)
          expect(autumnBounds.end.toISOString()).not.toBe('2026-10-25T21:00:00.000Z')

          // Spring 23h day: 2027-03-28
          const springBounds = todayBounds(new Date('2027-03-28T14:00:00.000Z'))
          expect(springBounds.start.toISOString()).toBe('2027-03-27T22:00:00.000Z')
          expect(springBounds.end.toISOString()).toBe('2027-03-28T21:00:00.000Z')
          expect((springBounds.end.getTime() - springBounds.start.getTime()) / 3600000).toBe(23)
          expect(springBounds.end.toISOString()).not.toBe('2027-03-28T22:00:00.000Z')
        } finally {
          process.env.TZ = originalTz
        }
      }
    )
  })

  // AC-3: Needs attention ordering and capping
  describe('orderAttentionRows (AC-3)', () => {
    function makeAttentionRow(
      id: string,
      kind: string,
      sortAt: Date,
      since: Date | null = sortAt
    ): AttentionRow {
      return {
        id,
        kind,
        since,
        sortAt,
        deliveryId: 'del-1',
        sosId: null,
        issueId: null,
        threadId: null,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId: null,
        orderReference: 'ORD-1',
        restaurantName: 'Souvlaki',
        riderName: 'Nikos',
        customerLabel: 'Elena',
        detail: 'detail',
        detailCode: null,
        detailParams: null,
        held: false,
      }
    }

    test('SOS rows come first, then others, each group oldest first by sortAt', () => {
      const sosOlder = makeAttentionRow('sos-old', ATTENTION_KIND.SOS, new Date('2026-11-09T10:00:00Z'))
      const sosNewer = makeAttentionRow('sos-new', ATTENTION_KIND.SOS, new Date('2026-11-09T11:00:00Z'))
      const waitOld = makeAttentionRow('wait-old', ATTENTION_KIND.WAITING_FOR_RIDER, new Date('2026-11-09T09:00:00Z'))
      const lateNew = makeAttentionRow('late-new', ATTENTION_KIND.RESTAURANT_LATE, new Date('2026-11-09T12:00:00Z'))
      const reportMid = makeAttentionRow('rep-mid', ATTENTION_KIND.RIDER_REPORT, new Date('2026-11-09T10:30:00Z'))

      // Put them in scrambled order
      const { attention, attentionMore } = orderAttentionRows([
        lateNew,
        waitOld,
        sosNewer,
        reportMid,
        sosOlder,
      ])

      expect(attentionMore).toBe(0)
      // SOS first: older (10:00), then newer (11:00)
      expect(attention[0]?.id).toBe('sos-old')
      expect(attention[1]?.id).toBe('sos-new')
      // Others: waitOld (09:00), reportMid (10:30), lateNew (12:00)
      expect(attention[2]?.id).toBe('wait-old')
      expect(attention[3]?.id).toBe('rep-mid')
      expect(attention[4]?.id).toBe('late-new')
    })

    test('at most 100 rows returned with attentionMore counting the rest', () => {
      const rows: AttentionRow[] = []
      for (let i = 0; i < 115; i++) {
        rows.push(
          makeAttentionRow(`row-${i}`, ATTENTION_KIND.WAITING_FOR_RIDER, new Date(1762690000000 + i * 1000))
        )
      }

      const { attention, attentionMore } = orderAttentionRows(rows)

      expect(attention).toHaveLength(100)
      expect(attentionMore).toBe(15)
      expect(attention[0]?.id).toBe('row-0')
      expect(attention[99]?.id).toBe('row-99')
    })
  })

  // AC-4: WAITING_FOR_RIDER
  describe('waitingForRiderRows (AC-4)', () => {
    test('since is waitingForCourierSince when present, else createdAt', () => {
      const deliveryWithWaitingSince = createLiveDelivery({
        id: 'del-offerview',
        createdAt: new Date('2026-11-09T13:00:00.000Z'),
      })
      const deliveryWithoutWaitingSince = createLiveDelivery({
        id: 'del-plain',
        createdAt: new Date('2026-11-09T13:10:00.000Z'),
      })

      const offerViews = new Map<string, DeliveryOfferView>([
        [
          'del-offerview',
          {
            waitingForCourierSince: new Date('2026-11-09T13:05:00.000Z'),
            matchedCourierName: null,
          } as unknown as DeliveryOfferView,
        ],
      ])

      const rows = waitingForRiderRows(
        [deliveryWithWaitingSince, deliveryWithoutWaitingSince],
        offerViews,
        false,
        BASE_NOW
      )

      expect(rows).toHaveLength(2)
      expect(rows[0]?.since?.toISOString()).toBe('2026-11-09T13:05:00.000Z')
      expect(rows[0]?.sortAt.toISOString()).toBe('2026-11-09T13:05:00.000Z')
      expect(rows[1]?.since?.toISOString()).toBe('2026-11-09T13:10:00.000Z')
      expect(rows[1]?.sortAt.toISOString()).toBe('2026-11-09T13:10:00.000Z')
    })

    test('a held delivery stays listed and shows held wording with clock in Athens time', () => {
      // 14:30 Athens time is 12:30 UTC
      const foodReadyAt = new Date('2026-11-09T12:30:00.000Z')
      const heldDelivery = createLiveDelivery({
        id: 'del-held',
        undispatchedAt: new Date('2026-11-09T11:00:00.000Z'),
        foodReadyAt,
      })

      const rows = waitingForRiderRows([heldDelivery], new Map(), false, new Date('2026-11-09T12:00:00.000Z'))

      expect(rows).toHaveLength(1)
      expect(rows[0]?.held).toBe(true)
      expect(rows[0]?.detail).toBe('Not offered yet, food ready 14:30')
    })

    test('with undispatchedAt null and offerTimingEnabled false, a delivery with ready time in the future is NOT held (AC-4)', () => {
      // Future ready time (14:30 UTC is 30 min after BASE_NOW 14:00)
      const futureReadyAt = new Date('2026-11-09T14:30:00.000Z')
      const delivery = createLiveDelivery({
        id: 'del-future-unheld',
        undispatchedAt: null,
        foodReadyAt: futureReadyAt,
      })

      const rows = waitingForRiderRows([delivery], new Map(), false, BASE_NOW)

      expect(rows).toHaveLength(1)
      expect(rows[0]?.held).toBe(false)
      expect(rows[0]?.detail).toBe('No courier accepted')
      expect(rows[0]?.detail).not.toContain('Not offered yet')
    })

    test('a delivery with waitingForCourierSince is NOT held even when undispatchedAt is set and ready time is in future (AC-4)', () => {
      const futureReadyAt = new Date('2026-11-09T14:30:00.000Z')
      const delivery = createLiveDelivery({
        id: 'del-previously-released',
        undispatchedAt: new Date('2026-11-09T13:00:00.000Z'),
        foodReadyAt: futureReadyAt,
      })

      const offerViews = new Map<string, DeliveryOfferView>([
        [
          'del-previously-released',
          {
            waitingForCourierSince: new Date('2026-11-09T13:50:00.000Z'),
            matchedCourierName: null,
          } as unknown as DeliveryOfferView,
        ],
      ])

      const rows = waitingForRiderRows([delivery], offerViews, false, BASE_NOW)

      expect(rows).toHaveLength(1)
      expect(rows[0]?.held).toBe(false)
      expect(rows[0]?.detail).toBe('No courier accepted')
      expect(rows[0]?.detail).not.toContain('Not offered yet')
    })

    test('unheld delivery reads "No courier accepted" and contains no decline count', () => {
      const normalDelivery = createLiveDelivery({ id: 'del-unheld' })

      const rows = waitingForRiderRows([normalDelivery], new Map(), false, BASE_NOW)

      expect(rows).toHaveLength(1)
      expect(rows[0]?.held).toBe(false)
      expect(rows[0]?.detail).toBe('No courier accepted')
      expect(rows[0]?.detail).not.toMatch(/decline/i)
    })

    test('ignores deliveries with courierId or matchedCourierId', () => {
      const withCourier = createLiveDelivery({ id: 'd-1', courierId: 'c-1' })
      const withMatched = createLiveDelivery({ id: 'd-2', matchedCourierId: 'c-2' })

      const rows = waitingForRiderRows([withCourier, withMatched], new Map(), false, BASE_NOW)

      expect(rows).toHaveLength(0)
    })
  })

  // AC-5: OFFER_UNANSWERED
  describe('offerUnansweredRows (AC-5)', () => {
    test('an offer with offerExpiresAt set sends no minutes (since is null) yet still sorts by offeredAt', () => {
      const offeredAt = new Date('2026-11-09T13:50:00.000Z')
      const runningOffer = createLiveDelivery({
        id: 'del-running-offer',
        matchedCourierId: 'courier-1',
        offeredAt,
        offerExpiresAt: new Date('2026-11-09T13:51:30.000Z'),
      })

      const offerViews = new Map<string, DeliveryOfferView>([
        ['del-running-offer', { matchedCourierName: 'Kostas' } as DeliveryOfferView],
      ])

      const rows = offerUnansweredRows([runningOffer], offerViews)

      expect(rows).toHaveLength(1)
      expect(rows[0]?.id).toBe(`${ATTENTION_KIND.OFFER_UNANSWERED}:del-running-offer`)
      expect(rows[0]?.since).toBeNull() // No minutes displayed to client!
      expect(rows[0]?.sortAt).toEqual(offeredAt) // Still sorts correctly!
      expect(rows[0]?.riderName).toBe('Kostas')
      expect(rows[0]?.detail).toBe('Offered to Kostas, unanswered')
    })

    test('an offer with offerExpiresAt null sends since = offeredAt', () => {
      const offeredAt = new Date('2026-11-09T13:40:00.000Z')
      const noExpiryOffer = createLiveDelivery({
        id: 'del-no-expiry',
        matchedCourierId: 'courier-2',
        offeredAt,
        offerExpiresAt: null,
      })

      const offerViews = new Map<string, DeliveryOfferView>([
        ['del-no-expiry', { matchedCourierName: 'Eleni' } as DeliveryOfferView],
      ])

      const rows = offerUnansweredRows([noExpiryOffer], offerViews)

      expect(rows).toHaveLength(1)
      expect(rows[0]?.since).toEqual(offeredAt)
      expect(rows[0]?.sortAt).toEqual(offeredAt)
      expect(rows[0]?.riderName).toBe('Eleni')
      expect(rows[0]?.detail).toBe('Offered to Eleni, unanswered')
    })

    test('an open add on offer creates attention row naming the held job and added km/min (AC-12, row 81)', () => {
      const offeredAt = new Date('2026-11-09T13:40:00.000Z')
      const heldJob = createLiveDelivery({
        id: 'del-held-job-1',
        orderReference: 'ORD-HELD-99',
        status: EnumDeliveryStatus.ACCEPTED,
        courierId: 'courier-eleni',
      })
      const addOnOffer = createLiveDelivery({
        id: 'del-add-on-1',
        orderReference: 'ORD-ADD-100',
        matchedCourierId: 'courier-eleni',
        courierId: null,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        offeredAt,
        offerExpiresAt: null,
        offerGroupId: null,
        stopSequence: [
          { deliveryId: 'del-held-job-1', stop: 'PICKUP' },
          { deliveryId: 'del-add-on-1', stop: 'PICKUP' },
          { deliveryId: 'del-held-job-1', stop: 'DROPOFF' },
          { deliveryId: 'del-add-on-1', stop: 'DROPOFF' },
        ],
        addOnExtraMetres: 2100,
        addOnExtraSeconds: 420,
      })

      const offerViews = new Map<string, DeliveryOfferView>([
        ['del-add-on-1', { matchedCourierName: 'Eleni' } as DeliveryOfferView],
      ])

      const rows = offerUnansweredRows([heldJob, addOnOffer], offerViews)

      expect(rows).toHaveLength(1)
      expect(rows[0]?.id).toBe(`${ATTENTION_KIND.OFFER_UNANSWERED}:del-add-on-1`)
      expect(rows[0]?.addOn).toBe(true)
      expect(rows[0]?.pairedDeliveryId).toBe('del-held-job-1')
      expect(rows[0]?.pairedOrderReference).toBe('ORD-HELD-99')
      expect(rows[0]?.detail).toBe(
        'Offered to Eleni as one more order on the way with ORD-HELD-99 (+2.1 km, +7 min), unanswered'
      )
    })
  })

  // AC-6: RESTAURANT_LATE
  describe('restaurantLateRows (AC-6)', () => {
    test('produces row only for COURIER_ARRIVED_AT_PICKUP_LOCATION with foodReadyAt null and promisedReadyAt before now', () => {
      const promised = new Date('2026-11-09T13:45:00.000Z')
      const lateDelivery = createLiveDelivery({
        id: 'del-late',
        status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
        courierId: 'courier-1',
        courier: { firstName: 'Giorgos', lastName: 'Alexiou' },
        foodReadyAt: null,
        promisedReadyAt: promised,
      })

      const rows = restaurantLateRows([lateDelivery], BASE_NOW)

      expect(rows).toHaveLength(1)
      expect(rows[0]?.id).toBe(`${ATTENTION_KIND.RESTAURANT_LATE}:del-late`)
      expect(rows[0]?.since).toEqual(promised)
      expect(rows[0]?.sortAt).toEqual(promised)
      expect(rows[0]?.riderName).toBe('Giorgos Alexiou')
      // 13:45 UTC is 15:45 Athens time
      expect(rows[0]?.detail).toBe('Giorgos Alexiou waiting at Souvlaki tou Nikou, food was due 15:45')
    })

    test('produces NO row if food is already marked ready', () => {
      const readyDelivery = createLiveDelivery({
        status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
        foodReadyAt: new Date('2026-11-09T13:40:00.000Z'),
        promisedReadyAt: new Date('2026-11-09T13:45:00.000Z'),
      })

      expect(restaurantLateRows([readyDelivery], BASE_NOW)).toHaveLength(0)
    })

    test('produces NO row if promisedReadyAt is in the future or equal to now', () => {
      const futureDelivery = createLiveDelivery({
        status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
        foodReadyAt: null,
        promisedReadyAt: new Date('2026-11-09T14:15:00.000Z'),
      })
      const equalDelivery = createLiveDelivery({
        status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
        foodReadyAt: null,
        promisedReadyAt: BASE_NOW,
      })

      expect(restaurantLateRows([futureDelivery, equalDelivery], BASE_NOW)).toHaveLength(0)
    })

    test('produces NO row if status is not COURIER_ARRIVED_AT_PICKUP_LOCATION', () => {
      const promised = new Date('2026-11-09T13:30:00.000Z')
      const statuses = [
        EnumDeliveryStatus.ACCEPTED,
        EnumDeliveryStatus.DISPATCHED,
        EnumDeliveryStatus.PICKED_UP,
        EnumDeliveryStatus.ON_THE_WAY,
        EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
      ]

      for (const status of statuses) {
        const d = createLiveDelivery({ status, foodReadyAt: null, promisedReadyAt: promised })
        expect(restaurantLateRows([d], BASE_NOW)).toHaveLength(0)
      }
    })
  })

  // AC-7: RIDER_REPORT
  describe('riderReportRows (AC-7)', () => {
    test('lists open reports for any delivery status, using reason words and optional note', () => {
      const createdAt = new Date('2026-11-09T13:30:00.000Z')
      const issues: OpenDeliveryIssue[] = [
        {
          id: 'issue-1',
          deliveryId: 'del-1',
          courierId: 'c-1',
          reason: EnumDeliveryIssueReason.WRONG_ADDRESS,
          note: 'Customer is on the back alley',
          createdAt,
          handledAt: null,
          handledByUserId: null,
          courier: { firstName: 'Dimitris', lastName: 'Karras' },
          delivery: {
            status: EnumDeliveryStatus.ON_THE_WAY,
            courierId: 'c-1',
            orderReference: 'ORD-99',
            pickupBusinessName: 'Pizza Bistro',
            dropoffName: 'Stavros',
            dropoffBusinessName: null,
          },
        },
        {
          id: 'issue-2',
          deliveryId: 'del-2',
          courierId: 'c-2',
          reason: EnumDeliveryIssueReason.NO_SIGNAL,
          note: null,
          createdAt,
          handledAt: null,
          handledByUserId: null,
          courier: { firstName: 'Anna', lastName: 'Vougiouka' },
          delivery: {
            status: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
            courierId: 'c-2',
            orderReference: 'ORD-100',
            pickupBusinessName: 'Bakery',
            dropoffName: 'Petros',
            dropoffBusinessName: 'Petros Ltd',
          },
        },
      ]

      const rows = riderReportRows(issues)

      expect(rows).toHaveLength(2)
      expect(rows[0]?.id).toBe(`${ATTENTION_KIND.RIDER_REPORT}:issue-1`)
      expect(rows[0]?.issueId).toBe('issue-1')
      expect(rows[0]?.since).toEqual(createdAt)
      expect(rows[0]?.detail).toBe('Dimitris Karras reported: Wrong address\nCustomer is on the back alley')

      expect(rows[1]?.id).toBe(`${ATTENTION_KIND.RIDER_REPORT}:issue-2`)
      expect(rows[1]?.issueId).toBe('issue-2')
      expect(rows[1]?.detail).toBe('Anna Vougiouka reported: No internet, GPS or signal')
    })
  })

  // AC-8: SOS rows
  describe('sosRows (AC-8)', () => {
    test('includes active and awaiting close incidents, since is startedAt, no position on row', () => {
      const startedAt = new Date('2026-11-09T13:55:00.000Z')
      const incidents: SosIncidentWithPeople[] = [
        {
          id: 'sos-1',
          courierId: 'c-1',
          deliveryId: 'del-10',
          startedAt,
          courier: { firstName: 'Nikos', lastName: 'Papastamou' },
        } as unknown as SosIncidentWithPeople,
      ]

      const rows = sosRows(incidents)

      expect(rows).toHaveLength(1)
      expect(rows[0]?.id).toBe(`${ATTENTION_KIND.SOS}:sos-1`)
      expect(rows[0]?.sosId).toBe('sos-1')
      expect(rows[0]?.deliveryId).toBe('del-10')
      expect(rows[0]?.since).toEqual(startedAt)
      expect(rows[0]?.sortAt).toEqual(startedAt)
      expect(rows[0]?.detail).toBe('Nikos Papastamou, SOS')

      // AC-8 and AC-13 invariant: No position fields on the row!
      expect((rows[0] as any).latitude).toBeUndefined()
      expect((rows[0] as any).longitude).toBeUndefined()
    })
  })

  // AC-10: Trust rule (critical scenario)
  describe('AC-10 Trust rule: no timer monitors a rider', () => {
    test('a rider at the dropoff for an hour, or on the way for an hour, produces NO attention row', () => {
      const oneHourAgo = new Date('2026-11-09T13:00:00.000Z')
      const riderAtDropoff = createLiveDelivery({
        id: 'del-dropoff-hour',
        status: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
        courierId: 'courier-1',
        createdAt: oneHourAgo,
      })
      const riderOnTheWay = createLiveDelivery({
        id: 'del-on-way-hour',
        status: EnumDeliveryStatus.ON_THE_WAY,
        courierId: 'courier-2',
        createdAt: oneHourAgo,
      })

      const live = [riderAtDropoff, riderOnTheWay]
      const offerViews = new Map<string, DeliveryOfferView>()

      // 0 waiting rows
      expect(waitingForRiderRows(live, offerViews, true, BASE_NOW)).toHaveLength(0)
      // 0 unanswered offer rows
      expect(offerUnansweredRows(live, offerViews)).toHaveLength(0)
      // 0 restaurant late rows
      expect(restaurantLateRows(live, BASE_NOW)).toHaveLength(0)
    })
  })

  // AC-11 and AC-12: buildMap
  describe('buildMap (AC-11, AC-12)', () => {
    test('Offline couriers never appear, free Last Call is absent, Last Call carrying appears', () => {
      const carryingDelivery = createLiveDelivery({
        id: 'del-carrying',
        status: EnumDeliveryStatus.ON_THE_WAY,
        courierId: 'c-lastcall-busy',
      })

      const couriers: WorkingCourier[] = [
        // Free Last Call rider: should be absent
        createWorkingCourier({
          id: 'c-lastcall-free',
          status: EnumCourierStatus.LAST_CALL,
          busy: false,
        }),
        // Last Call rider carrying active delivery: should appear with state: BUSY
        createWorkingCourier({
          id: 'c-lastcall-busy',
          status: EnumCourierStatus.LAST_CALL,
          busy: true,
        }),
        // Online rider with no delivery: FREE
        createWorkingCourier({
          id: 'c-online-free',
          status: EnumCourierStatus.ONLINE,
          busy: false,
        }),
        // Online rider with busy flag: BUSY
        createWorkingCourier({
          id: 'c-online-busy',
          status: EnumCourierStatus.ONLINE,
          busy: true,
        }),
      ]

      const map = buildMap([carryingDelivery], couriers)

      const ids = map.couriers.map((c) => c.id)
      expect(ids).not.toContain('c-lastcall-free')
      expect(ids).toContain('c-lastcall-busy')
      expect(ids).toContain('c-online-free')
      expect(ids).toContain('c-online-busy')

      const lastCallBusy = map.couriers.find((c) => c.id === 'c-lastcall-busy')
      expect(lastCallBusy?.state).toBe('BUSY')
      expect(lastCallBusy?.carrying).toEqual([
        { deliveryId: 'del-carrying', orderReference: 'ORD-101', offered: false },
      ])

      const onlineFree = map.couriers.find((c) => c.id === 'c-online-free')
      expect(onlineFree?.state).toBe('FREE')

      const onlineBusy = map.couriers.find((c) => c.id === 'c-online-busy')
      expect(onlineBusy?.state).toBe('BUSY')
    })

    test('a Last Call rider holding only an open offer (nothing carried) is absent from map.couriers (AC-11)', () => {
      const courierId = 'c-lastcall-offered-only'
      const offeredDelivery = createLiveDelivery({
        id: 'del-offered-only',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId: null,
        matchedCourierId: courierId,
      })

      const courier = createWorkingCourier({
        id: courierId,
        status: EnumCourierStatus.LAST_CALL,
        busy: true,
      })

      const map = buildMap([offeredDelivery], [courier])

      expect(map.couriers.map((c) => c.id)).not.toContain(courierId)
      expect(map.couriers).toHaveLength(0)
    })

    test('a Last Call rider carrying an active delivery is BUSY even when courier.busy flag is false (AC-11)', () => {
      const courierId = 'c-lastcall-carrying-not-busy-flag'
      const activeDelivery = createLiveDelivery({
        id: 'del-active',
        status: EnumDeliveryStatus.ACCEPTED,
        courierId,
      })

      const courier = createWorkingCourier({
        id: courierId,
        status: EnumCourierStatus.LAST_CALL,
        busy: false, // fixture's busy flag is false
      })

      const map = buildMap([activeDelivery], [courier])

      const rider = map.couriers.find((c) => c.id === courierId)
      expect(rider).toBeDefined()
      expect(rider?.state).toBe('BUSY')
    })

    test('a courier with null latitude or longitude (position older than 5 min) is absent from map', () => {
      const couriers: WorkingCourier[] = [
        createWorkingCourier({ id: 'c-fresh', latitude: 39.36, longitude: 22.94 }),
        createWorkingCourier({ id: 'c-stale-lat', latitude: null, longitude: 22.94 }),
        createWorkingCourier({ id: 'c-stale-lon', latitude: 39.36, longitude: null }),
        createWorkingCourier({ id: 'c-no-pos', latitude: null, longitude: null }),
      ]

      const map = buildMap([], couriers)

      expect(map.couriers).toHaveLength(1)
      expect(map.couriers[0]?.id).toBe('c-fresh')
    })

    test('waiting deliveries with pickupLocation are mapped to waitingDeliveries', () => {
      const waitingWithLocation = createLiveDelivery({
        id: 'del-wait-1',
        orderReference: 'ORD-WAIT',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId: null,
        pickupLocation: { latitude: 39.365, longitude: 22.945 },
      })
      const waitingWithoutLocation = createLiveDelivery({
        id: 'del-wait-2',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId: null,
        pickupLocation: null,
      })
      const activeDelivery = createLiveDelivery({
        id: 'del-active',
        status: EnumDeliveryStatus.ACCEPTED,
        courierId: 'c-1',
        pickupLocation: { latitude: 39.366, longitude: 22.946 },
      })

      const map = buildMap([waitingWithLocation, waitingWithoutLocation, activeDelivery], [])

      expect(map.waitingDeliveries).toEqual([
        {
          deliveryId: 'del-wait-1',
          orderReference: 'ORD-WAIT',
          latitude: 39.365,
          longitude: 22.945,
        },
      ])
    })

    test('carrying distinguishes carried deliveries (offered: false) from offered deliveries (offered: true)', () => {
      const courierId = 'courier-test'
      const carried = createLiveDelivery({
        id: 'del-carried',
        orderReference: 'ORD-CARRIED',
        status: EnumDeliveryStatus.PICKED_UP,
        courierId,
      })
      const offered = createLiveDelivery({
        id: 'del-offered',
        orderReference: 'ORD-OFFERED',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId: null,
        matchedCourierId: courierId,
      })

      const courier = createWorkingCourier({ id: courierId, status: EnumCourierStatus.ONLINE, busy: true })

      const map = buildMap([carried, offered], [courier])

      expect(map.couriers[0]?.carrying).toEqual([
        { deliveryId: 'del-carried', orderReference: 'ORD-CARRIED', offered: false },
        { deliveryId: 'del-offered', orderReference: 'ORD-OFFERED', offered: true },
      ])
    })
  })

  // Spec 0034 (chat), AC-17: unreadMessageRows
  describe('unreadMessageRows (spec 0034, AC-17)', () => {
    test('makes one UNREAD_MESSAGE row per unread thread with correct since, threadId, names, and preview', () => {
      const oldestUnreadAt = new Date('2026-11-09T13:30:00.000Z')
      const riderThread = {
        threadId: 'thread-rider-1',
        oldestUnreadAt,
        courierId: 'courier-1',
        name: 'Dimitris Rider',
        lastMessageBody: 'Customer not answering doorbell',
      }
      const restaurantThread = {
        threadId: 'thread-partner-1',
        oldestUnreadAt,
        courierId: null,
        name: 'Souvlaki Tou Nikou',
        lastMessageBody: 'Food is ready for pickup',
      }

      const rows = unreadMessageRows([riderThread, restaurantThread])

      expect(rows).toHaveLength(2)

      // Rider thread
      expect(rows[0]).toEqual({
        id: `${ATTENTION_KIND.UNREAD_MESSAGE}:thread-rider-1`,
        kind: ATTENTION_KIND.UNREAD_MESSAGE,
        since: oldestUnreadAt,
        sortAt: oldestUnreadAt,
        deliveryId: null,
        sosId: null,
        issueId: null,
        threadId: 'thread-rider-1',
        status: null,
        courierId: 'courier-1',
        orderReference: null,
        restaurantName: null,
        riderName: 'Dimitris Rider',
        customerLabel: null,
        detail: 'Dimitris Rider: Customer not answering doorbell',
        detailCode: null,
        detailParams: null,
        held: false,
      })

      // Restaurant thread
      expect(rows[1]).toEqual({
        id: `${ATTENTION_KIND.UNREAD_MESSAGE}:thread-partner-1`,
        kind: ATTENTION_KIND.UNREAD_MESSAGE,
        since: oldestUnreadAt,
        sortAt: oldestUnreadAt,
        deliveryId: null,
        sosId: null,
        issueId: null,
        threadId: 'thread-partner-1',
        status: null,
        courierId: null,
        orderReference: null,
        restaurantName: 'Souvlaki Tou Nikou',
        riderName: null,
        customerLabel: null,
        detail: 'Souvlaki Tou Nikou: Food is ready for pickup',
        detailCode: null,
        detailParams: null,
        held: false,
      })
    })

    test('truncates message bodies longer than 140 characters at 140 with ellipsis', () => {
      const longBody = 'A'.repeat(200)
      const thread = {
        threadId: 'thread-long',
        oldestUnreadAt: new Date(),
        courierId: 'courier-1',
        name: 'Nikos',
        lastMessageBody: longBody,
      }

      const rows = unreadMessageRows([thread])
      expect(rows).toHaveLength(1)
      expect(UNREAD_MESSAGE_PREVIEW_LENGTH).toBe(140)
      expect(rows[0]?.detail).toBe(`Nikos: ${'A'.repeat(140)}…`)
    })

    test('handles null or empty body by falling back to thread name', () => {
      const thread = {
        threadId: 'thread-empty',
        oldestUnreadAt: new Date(),
        courierId: null,
        name: 'Pizza House',
        lastMessageBody: null,
      }

      const rows = unreadMessageRows([thread])
      expect(rows).toHaveLength(1)
      expect(rows[0]?.detail).toBe('Pizza House')
    })
  })
})
