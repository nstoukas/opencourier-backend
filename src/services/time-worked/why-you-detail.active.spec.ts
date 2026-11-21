import {
  EnumCourierStatus,
  EnumCourierStatusChangeCause,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
} from '@prisma/types'
import { TimeWorkedService } from './time-worked.service'
import { toEarningsDeliveryDto } from 'src/rest-api/time-worked/earnings.dto'

// Spec 0045 (AC-1, AC-5, cross check 1 and 4; decision 14.2): the earnings delivery detail carries
// `whyYou`, from the rider's own latest reason up to their last accept plus five seconds (review ruling
// 2026-11-21, decision 14.5: a minute could pick a later offer that was never accepted).
describe('TimeWorkedService.deliveryDetail whyYou (spec 0045: AC-1, AC-5, cross check 4)', () => {
  const courierId = 'courier-why-me'
  const deliveryId = 'del-why-1'
  const now = new Date('2026-11-20T10:00:00Z')
  // The rider held the delivery twice: handed back on the 15th, accepted again and delivered on the 16th.
  const firstAccept = new Date('2026-10-15T12:00:00Z')
  const lastAccept = new Date('2026-10-16T13:00:00Z')

  const OTHER_COURIER_IDS = ['courier-other-1', 'courier-other-2', 'courier-other-3', 'courier-other-4']
  const FORBIDDEN_KEYS = ['candidates', 'scaled', 'score', 'candidateCount', 'ridersInRange']

  // The whole OfferReason row as the database holds it, five candidates included. findOwnLatest must
  // never select most of this; the service and DTO must not leak it even if it did.
  const fullStoredRow = {
    id: 'reason-1',
    deliveryEventId: 'ev-offered-2',
    deliveryId,
    courierId,
    strategy: 'FAIRNESS',
    kind: 'SINGLE',
    weights: { roadTime: 50, earnings: 30, waiting: 20 },
    values: {
      roadSeconds: 480,
      roadEstimated: false,
      centsPerHour: 940,
      earningsAssumed: false,
      earningsEqual: false,
      waitingSeconds: 1320,
      straightMetres: 1200,
      scaled: { roadTime: 0, earnings: 1, waiting: 0.5 },
      score: 0.42,
      candidateCount: 5,
      ridersInRange: 7,
    },
    score: 0.42,
    candidateCount: 5,
    ridersInRange: 7,
    candidates: [
      { courierId, roadSeconds: 480, centsPerHour: 940, scaled: { roadTime: 0 }, score: 0.42 },
      ...OTHER_COURIER_IDS.map((id, i) => ({
        courierId: id,
        roadSeconds: 500 + i,
        centsPerHour: 1500 + i,
        waitingSeconds: 60 + i,
        scaled: { roadTime: 0.5, earnings: 0.2, waiting: 0.1 },
        score: 0.6 + i / 10,
      })),
    ],
    createdAt: new Date('2026-10-16T12:59:30Z'),
  }

  function collectAllKeys(obj: unknown): string[] {
    const keys: string[] = []
    const traverse = (current: unknown) => {
      if (!current || typeof current !== 'object') return
      if (Array.isArray(current)) return current.forEach(traverse)
      for (const [k, v] of Object.entries(current)) {
        keys.push(k)
        traverse(v)
      }
    }
    traverse(obj)
    return keys
  }

  let mockTimeWorkedRepository: any
  let mockConfigDomainService: any
  let mockOfferReasonRepository: { findOwnLatest: jest.Mock }

  function recordsFor(accept: Date, endType: EnumDeliveryEventType, endAt: Date, delivered: boolean) {
    return {
      statusChanges: [
        {
          id: `sc-${accept.toISOString()}`,
          courierId,
          createdAt: new Date(accept.getTime() - 2 * 3600_000),
          fromStatus: EnumCourierStatus.OFFLINE,
          toStatus: EnumCourierStatus.ONLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
      ],
      statusBefore: new Map(),
      acceptedDeliveries: new Map([[courierId, new Set([deliveryId])]]),
      events: [
        {
          id: `ev-acc-${accept.toISOString()}`,
          deliveryId,
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId,
          occurredAt: accept,
          createdAt: accept,
        },
        {
          id: `ev-end-${accept.toISOString()}`,
          deliveryId,
          type: endType,
          oldStatus: delivered ? EnumDeliveryStatus.ON_THE_WAY : EnumDeliveryStatus.ACCEPTED,
          courierId,
          occurredAt: endAt,
          createdAt: endAt,
        },
      ],
      deliveries: [
        {
          id: deliveryId,
          status: delivered ? EnumDeliveryStatus.DROPPED_OFF : EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId: delivered ? courierId : null,
          totalCompensation: 500,
          tips: 0,
          pickupName: 'Taverna Nosh',
        },
      ],
      compensations: [],
      everAccepted: new Set([deliveryId]),
    }
  }

  beforeEach(() => {
    mockConfigDomainService = {
      instanceConfig: {
        getShiftBreakMinutes: jest.fn().mockResolvedValue(30),
        getCurrency: jest.fn().mockResolvedValue('EUR'),
      },
    }

    const firstEnd = new Date('2026-10-15T12:02:00Z')
    const lastEnd = new Date('2026-10-16T13:30:00Z')
    mockTimeWorkedRepository = {
      findRecordedFrom: jest.fn().mockResolvedValue(new Date('2026-01-01T00:00:00Z')),
      findAcceptTimes: jest.fn().mockResolvedValue([firstAccept, lastAccept]),
      findRecords: jest.fn().mockImplementation(({ rangeStart }: any) => {
        const isFirstDay = rangeStart.getTime() < new Date('2026-10-15T20:00:00Z').getTime()
        return Promise.resolve(
          isFirstDay
            ? recordsFor(firstAccept, EnumDeliveryEventType.HANDED_BACK, firstEnd, false)
            : recordsFor(lastAccept, EnumDeliveryEventType.DROPPED_OFF, lastEnd, true)
        )
      }),
      findDeliveryPay: jest.fn().mockResolvedValue({
        id: deliveryId,
        status: EnumDeliveryStatus.DROPPED_OFF,
        courierId,
        totalCompensation: 500,
        tips: 0,
        pickupName: 'Taverna Nosh',
        baseFee: 200,
        distanceFee: 300,
        paidKm: 2.0,
        dropoffArea: 'Iasonos',
      }),
      findTimelineEvents: jest.fn().mockResolvedValue([
        {
          id: 'ev-1',
          deliveryId,
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          actor: EnumEventActor.COURIER,
          courierId,
          occurredAt: firstAccept,
          createdAt: firstAccept,
        },
        {
          id: 'ev-2',
          deliveryId,
          type: EnumDeliveryEventType.HANDED_BACK,
          oldStatus: EnumDeliveryStatus.ACCEPTED,
          actor: EnumEventActor.COURIER,
          courierId,
          occurredAt: firstEnd,
          createdAt: firstEnd,
        },
        {
          id: 'ev-3',
          deliveryId,
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          actor: EnumEventActor.COURIER,
          courierId,
          occurredAt: lastAccept,
          createdAt: lastAccept,
        },
        {
          id: 'ev-4',
          deliveryId,
          type: EnumDeliveryEventType.DROPPED_OFF,
          oldStatus: EnumDeliveryStatus.ON_THE_WAY,
          actor: EnumEventActor.COURIER,
          courierId,
          occurredAt: lastEnd,
          createdAt: lastEnd,
        },
      ]),
    }

    mockOfferReasonRepository = { findOwnLatest: jest.fn().mockResolvedValue(null) }
  })

  function makeService() {
    return new TimeWorkedService(mockTimeWorkedRepository, mockConfigDomainService, mockOfferReasonRepository as any)
  }

  test('the fixture holds: the rider held the delivery twice, last accepted on the 16th', async () => {
    const result = await makeService().deliveryDetail(courierId, deliveryId, now)
    expect(result.jobs.map((j) => j.acceptedAt)).toEqual([firstAccept, lastAccept])
  })

  test("asks for this rider's own reason on this delivery, up to their LAST accept plus 5 seconds", async () => {
    await makeService().deliveryDetail(courierId, deliveryId, now)

    expect(mockOfferReasonRepository.findOwnLatest).toHaveBeenCalledTimes(1)
    const [askedCourier, askedDelivery, upTo] = mockOfferReasonRepository.findOwnLatest.mock.calls[0]
    expect(askedCourier).toBe(courierId)
    expect(askedDelivery).toBe(deliveryId)
    expect(upTo).toBeInstanceOf(Date)
    // Five seconds of grace, no more: a reason written for a later offer must stay outside the bound.
    expect((upTo as Date).getTime() - lastAccept.getTime()).toBe(5_000)
    expect((upTo as Date).toISOString()).toBe('2026-10-16T13:00:05.000Z')
  })

  test('returns whyYou from the reason found: own raw values, the weights in force then, estimated', async () => {
    mockOfferReasonRepository.findOwnLatest.mockResolvedValue({
      strategy: 'FAIRNESS',
      kind: 'SINGLE',
      values: { ...fullStoredRow.values, roadEstimated: true },
      weights: { roadTime: 50, earnings: 30, waiting: 20 },
    })

    const result = await makeService().deliveryDetail(courierId, deliveryId, now)

    expect(result.whyYou).toEqual({
      strategy: 'FAIRNESS',
      kind: 'SINGLE',
      values: {
        roadSeconds: 480,
        roadEstimated: true,
        centsPerHour: 940,
        earningsAssumed: false,
        earningsEqual: false,
        waitingSeconds: 1320,
        straightMetres: 1200,
      },
      weights: { roadTime: 50, earnings: 30, waiting: 20 },
      estimated: true,
    })
  })

  test('whyYou is null when no reason exists (a job before spec 0044, or a failed write)', async () => {
    mockOfferReasonRepository.findOwnLatest.mockResolvedValue(null)

    const result = await makeService().deliveryDetail(courierId, deliveryId, now)

    expect(result).toHaveProperty('whyYou')
    expect(result.whyYou).toBeNull()
  })

  // Review ruling 2026-11-21 (decision 14.5, AC-5): an assumed or equal rider's stored centsPerHour is the
  // co-op mean, made of other riders' pay. It must not reach the rider's answer.
  describe('centsPerHour through the courier answer (decision 14.5, AC-5)', () => {
    // 1730 stands for a colleague's exact rate, stored as this rider's figure by the matcher.
    const answerFor = async (flags: { earningsAssumed: boolean; earningsEqual: boolean }) => {
      mockOfferReasonRepository.findOwnLatest.mockResolvedValue({
        ...fullStoredRow,
        values: { ...fullStoredRow.values, ...flags, centsPerHour: 1730 },
      })
      const detail = await makeService().deliveryDetail(courierId, deliveryId, now)
      return JSON.parse(JSON.stringify(toEarningsDeliveryDto(detail)))
    }

    test.each([
      ['earningsAssumed', { earningsAssumed: true, earningsEqual: false }],
      ['earningsEqual', { earningsAssumed: false, earningsEqual: true }],
    ])('not sent when %s is true, and the flag is', async (flag, flags) => {
      const json = await answerFor(flags)

      expect(json.whyYou.values).not.toHaveProperty('centsPerHour')
      expect(collectAllKeys(json.whyYou)).not.toContain('centsPerHour')
      expect(JSON.stringify(json.whyYou)).not.toContain('1730')
      expect(json.whyYou.values[flag]).toBe(true)
      // The rest of the rider's own reason is still there.
      expect(json.whyYou.values.roadSeconds).toBe(480)
      expect(json.whyYou.values.waitingSeconds).toBe(1320)
    })

    test("sent when the rate is the rider's own (neither flag true)", async () => {
      const json = await answerFor({ earningsAssumed: false, earningsEqual: false })
      expect(json.whyYou.values.centsPerHour).toBe(1730)
    })
  })

  test('AC-5: even if the whole stored row with five candidates came back, nothing of the others reaches the rider', async () => {
    mockOfferReasonRepository.findOwnLatest.mockResolvedValue(fullStoredRow)

    const detail = await makeService().deliveryDetail(courierId, deliveryId, now)
    const json = JSON.parse(JSON.stringify(toEarningsDeliveryDto(detail)))
    const serialized = JSON.stringify(json)

    // The rider's own reason is there...
    expect(json.whyYou.strategy).toBe('FAIRNESS')
    expect(json.whyYou.values.roadSeconds).toBe(480)
    // ...and nothing that says who else was compared, or where this rider stood among them.
    for (const other of OTHER_COURIER_IDS) expect(serialized).not.toContain(other)
    const allKeys = collectAllKeys(json)
    for (const forbidden of FORBIDDEN_KEYS) expect(allKeys).not.toContain(forbidden)
    expect(Object.keys(json.whyYou).sort()).toEqual(['estimated', 'kind', 'strategy', 'values', 'weights'])
  })
})
