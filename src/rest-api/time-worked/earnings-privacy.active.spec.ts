import {
  toEarningsDeliveryDto,
  toEarningsMonthDto,
} from './earnings.dto'
import {
  EarningsDeliveryDetail,
  EarningsView,
} from 'src/services/time-worked/time-worked.service'
import {
  EnumCourierCompensationReason,
  EnumDeliveryEventType,
} from '@prisma/types'
import { EnumJobEndLabel } from 'src/domains/time-worked/worked-shifts'
import { EnumTimelineWho } from 'src/domains/time-worked/delivery-timeline'
import { whyYouFrom } from 'src/domains/matching/why-you'

describe('Earnings Privacy (spec 0042 AC-11, AC-12)', () => {
  const FORBIDDEN_PRIVACY_KEYS = [
    'houseNumber',
    'zipCode',
    'addressLine1',
    'addressLine2',
    'formattedAddress',
    'message',
  ]

  function collectAllKeys(obj: any): string[] {
    const keys: string[] = []
    function traverse(current: any) {
      if (!current || typeof current !== 'object') return
      if (Array.isArray(current)) {
        for (const item of current) traverse(item)
        return
      }
      for (const k of Object.keys(current)) {
        keys.push(k)
        traverse(current[k])
      }
    }
    traverse(obj)
    return keys
  }

  test('toEarningsMonthDto never contains forbidden address fields or message anywhere in its response object tree', () => {
    const mockView: EarningsView & { month: string; reachFrom: string } = {
      month: '2026-11',
      reachFrom: '2026-09-20',
      from: '2026-11-01',
      to: '2026-11-20',
      recordedFrom: new Date('2026-01-01T00:00:00Z'),
      currencyCode: 'EUR',
      days: [
        {
          date: '2026-11-20',
          workSeconds: 3600,
          jobSeconds: 2400,
          paidWaitSeconds: 600,
          unpaidSeconds: 600,
          moneyCents: 1500,
          unlinkedMoneyCents: 200,
          noJobMoneyCents: 100,
          centsPerHour: 1300,
          activeCentsPerHour: 1560,
          paidKm: 3.5,
          centsPerPaidKm: 371,
          medianPickupWaitSeconds: 120,
          pickupWaitCount: 1,
          dropOffCount: 1,
        },
      ],
      weeks: [
        {
          weekStart: '2026-11-16',
          soFar: true,
          cutAtReach: false,
          workSeconds: 3600,
          jobSeconds: 2400,
          paidWaitSeconds: 600,
          unpaidSeconds: 600,
          moneyCents: 1500,
          unlinkedMoneyCents: 200,
          noJobMoneyCents: 100,
          centsPerHour: 1300,
          activeCentsPerHour: 1560,
          paidKm: 3.5,
          centsPerPaidKm: 371,
          medianPickupWaitSeconds: 120,
          pickupWaitCount: 1,
          dropOffCount: 1,
        },
      ],
      shifts: [
        {
          startedAt: new Date('2026-11-20T08:00:00Z'),
          startedBeforeRange: false,
          endedAt: new Date('2026-11-20T12:00:00Z'),
          onBreakSince: null,
          workSeconds: 3600,
          jobSeconds: 2400,
          paidWaitSeconds: 600,
          unpaidSeconds: 600,
          breaks: [],
          moneyCents: 1500,
          lateMoneyCents: 0,
          centsPerHour: 1300,
          currencyCode: 'EUR',
          statusChanges: [],
          jobs: [
            {
              deliveryId: 'del-1',
              pickupName: 'Taverna Nosh',
              acceptedAt: new Date('2026-11-20T08:30:00Z'),
              endedAt: new Date('2026-11-20T09:00:00Z'),
              endEventType: EnumDeliveryEventType.DROPPED_OFF,
              droppedOff: true,
              deliveryMoneyCents: 1300,
              paidWaitSeconds: 120,
              compensations: [
                {
                  id: 'comp-1',
                  reason: EnumCourierCompensationReason.WAITING,
                  amountCents: 200,
                  waitMinutes: 10,
                  createdAt: new Date('2026-11-20T09:00:00Z'),
                  addedLater: false,
                },
              ],
              paidKm: 3.5,
              dropoffArea: 'Iasonos',
              pickupWaitSeconds: 120,
              cancelledAfterPickup: false,
              endLabel: null,
            },
          ],
        },
      ],
      jobsInNoShift: [
        {
          deliveryId: 'del-no-shift',
          pickupName: 'Bakery',
          acceptedAt: new Date('2026-11-20T06:00:00Z'),
          endedAt: new Date('2026-11-20T06:00:00Z'),
          endEventType: EnumDeliveryEventType.DROPPED_OFF,
          droppedOff: true,
          deliveryMoneyCents: 500,
          paidWaitSeconds: 0,
          compensations: [],
          paidKm: 1.0,
          dropoffArea: 'Volos',
          pickupWaitSeconds: null,
          cancelledAfterPickup: false,
          endLabel: null,
        },
      ],
    }

    const dto = toEarningsMonthDto(mockView)
    const json = JSON.parse(JSON.stringify(dto))
    const allKeys = collectAllKeys(json)

    for (const forbidden of FORBIDDEN_PRIVACY_KEYS) {
      expect(allKeys).not.toContain(forbidden)
    }

    // Double check as a serialized string
    const serialized = JSON.stringify(json)
    for (const forbidden of FORBIDDEN_PRIVACY_KEYS) {
      expect(serialized).not.toMatch(new RegExp(`"${forbidden}"`))
    }
  })

  test('toEarningsDeliveryDto never contains forbidden address fields or message anywhere in its response object tree', () => {
    const mockDetail: EarningsDeliveryDetail = {
      whyYou: null,
      deliveryId: 'del-priv-detail',
      currencyCode: 'EUR',
      pickupName: 'Taverna Nosh',
      dropoffArea: 'Dimitriadis',
      paidKm: 2.8,
      jobs: [
        {
          acceptedAt: new Date('2026-11-20T10:00:00Z'),
          endedAt: new Date('2026-11-20T10:25:00Z'),
          endLabel: null,
          minutes: 25,
          pickupWaitSeconds: 150,
        },
      ],
      breakdown: {
        baseFeeCents: 300,
        distanceFeeCents: 350,
        deliveryPayCents: 650,
        tipsCents: 50,
        compensations: [
          {
            reason: EnumCourierCompensationReason.WAITING,
            amountCents: 100,
            waitMinutes: 10,
            createdAt: new Date('2026-11-20T10:30:00Z'),
            addedLater: true,
          },
        ],
        totalCents: 800,
      },
      timeline: [
        {
          type: EnumDeliveryEventType.ACCEPTED,
          at: new Date('2026-11-20T10:00:00Z'),
          who: EnumTimelineWho.YOU,
          anotherRider: false,
        },
        {
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          at: new Date('2026-11-20T10:10:00Z'),
          who: EnumTimelineWho.YOU,
          anotherRider: false,
        },
        {
          type: EnumDeliveryEventType.DROPPED_OFF,
          at: new Date('2026-11-20T10:25:00Z'),
          who: EnumTimelineWho.YOU,
          anotherRider: false,
        },
      ],
    }

    const dto = toEarningsDeliveryDto(mockDetail)
    const json = JSON.parse(JSON.stringify(dto))
    const allKeys = collectAllKeys(json)

    for (const forbidden of FORBIDDEN_PRIVACY_KEYS) {
      expect(allKeys).not.toContain(forbidden)
    }

    const serialized = JSON.stringify(json)
    for (const forbidden of FORBIDDEN_PRIVACY_KEYS) {
      expect(serialized).not.toMatch(new RegExp(`"${forbidden}"`))
    }
  })
})

// Spec 0045 (AC-5, cross check 1): the courier API never includes another rider's id, values or score,
// nor anything that tells a rider their place among the candidates.
describe('Why this offer privacy guard (spec 0045 AC-5, cross check 1)', () => {
  const OWN_COURIER_ID = 'courier-me'
  const OTHER_COURIER_IDS = ['courier-other-1', 'courier-other-2', 'courier-other-3', 'courier-other-4']
  const FORBIDDEN_WHY_KEYS = ['candidates', 'scaled', 'score', 'candidateCount', 'ridersInRange', 'courierId']

  function collectAllKeys(obj: any): string[] {
    const keys: string[] = []
    function traverse(current: any) {
      if (!current || typeof current !== 'object') return
      if (Array.isArray(current)) {
        for (const item of current) traverse(item)
        return
      }
      for (const k of Object.keys(current)) {
        keys.push(k)
        traverse(current[k])
      }
    }
    traverse(obj)
    return keys
  }

  // The whole OfferReason row for a FAIRNESS offer scored among five riders (this one and four others).
  const storedReason = {
    id: 'reason-five',
    deliveryEventId: 'ev-offered-1',
    deliveryId: 'del-why-priv',
    courierId: OWN_COURIER_ID,
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
      { courierId: OWN_COURIER_ID, roadSeconds: 480, centsPerHour: 940, scaled: { roadTime: 0 }, score: 0.42 },
      ...OTHER_COURIER_IDS.map((id, i) => ({
        courierId: id,
        roadSeconds: 500 + i,
        centsPerHour: 1500 + i,
        waitingSeconds: 60 + i,
        scaled: { roadTime: 0.5, earnings: 0.2, waiting: 0.1 },
        score: 0.6 + i / 10,
      })),
    ],
  }

  function detailWith(whyYou: EarningsDeliveryDetail['whyYou']): EarningsDeliveryDetail {
    return {
      whyYou,
      deliveryId: 'del-why-priv',
      currencyCode: 'EUR',
      pickupName: 'Taverna Nosh',
      dropoffArea: 'Dimitriadis',
      paidKm: 2.8,
      jobs: [],
      breakdown: {
        baseFeeCents: 300,
        distanceFeeCents: 350,
        deliveryPayCents: 650,
        tipsCents: 0,
        compensations: [],
        totalCents: 650,
      },
      timeline: [],
    }
  }

  function expectNothingOfTheOthers(json: any) {
    const serialized = JSON.stringify(json)
    for (const other of OTHER_COURIER_IDS) expect(serialized).not.toContain(other)
    const allKeys = collectAllKeys(json)
    for (const forbidden of FORBIDDEN_WHY_KEYS) expect(allKeys).not.toContain(forbidden)
    for (const forbidden of FORBIDDEN_WHY_KEYS) expect(serialized).not.toMatch(new RegExp(`"${forbidden}"`))
  }

  test('the fixture has five candidates, four of them other riders', () => {
    expect(storedReason.candidates).toHaveLength(5)
    expect(JSON.stringify(storedReason)).toContain('courier-other-4')
  })

  test('a delivery whose stored reason has five candidates: the DTO holds no other courier id, candidates, scaled, score, candidateCount or ridersInRange anywhere', () => {
    const dto = toEarningsDeliveryDto(detailWith(whyYouFrom(storedReason)))
    const json = JSON.parse(JSON.stringify(dto))

    // The rider's own reason did arrive (the guard is not passing on an empty answer).
    expect(json.whyYou).toEqual({
      strategy: 'FAIRNESS',
      kind: 'SINGLE',
      values: {
        roadSeconds: 480,
        roadEstimated: false,
        centsPerHour: 940,
        earningsAssumed: false,
        earningsEqual: false,
        waitingSeconds: 1320,
        straightMetres: 1200,
      },
      weights: { roadTime: 50, earnings: 30, waiting: 20 },
      estimated: false,
    })
    expectNothingOfTheOthers(json)
  })

  test('toEarningsDeliveryDto copies whyYou field by field: extra fields on the detail never reach the rider', () => {
    // As if a later change let the whole stored row through to the detail.
    const leakyWhyYou = { ...whyYouFrom(storedReason)!, ...storedReason, values: whyYouFrom(storedReason)!.values }
    const dto = toEarningsDeliveryDto(detailWith(leakyWhyYou as EarningsDeliveryDetail['whyYou']))
    const json = JSON.parse(JSON.stringify(dto))

    expect(Object.keys(json.whyYou).sort()).toEqual(['estimated', 'kind', 'strategy', 'values', 'weights'])
    expectNothingOfTheOthers(json)
  })

  test('an admin\'s choice never names the admin', () => {
    const dto = toEarningsDeliveryDto(
      detailWith(whyYouFrom({ strategy: 'ADMIN', kind: 'SINGLE', values: { adminUserId: 'admin-user-7' }, weights: null }))
    )
    const serialized = JSON.stringify(dto)
    expect(serialized).not.toContain('admin-user-7')
    expect(serialized).not.toContain('adminUserId')
  })

  test('whyYou null stays null in the DTO (AC-1)', () => {
    const dto = toEarningsDeliveryDto(detailWith(null))
    expect(dto.whyYou).toBeNull()
  })
})
