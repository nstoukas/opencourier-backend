import { BadRequestException, NotFoundException } from '@nestjs/common'
import {
  EnumCourierCompensationReason,
  EnumCourierStatus,
  EnumCourierStatusChangeCause,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumDistanceUnit,
  EnumEventActor,
} from '@prisma/types'
import {
  RIDER_REACH_MONTHS,
  TimeWorkedService,
  jobMinutes,
  parseMonth,
  reachFromOf,
} from './time-worked.service'
import { EnumJobEndLabel } from 'src/domains/time-worked/worked-shifts'
import { TimeWorkedRecords } from 'src/persistence/repositories/time-worked.repository'

describe('TimeWorkedService - Earnings & Merged History (spec 0042 AC-9, AC-10, AC-11, AC-17)', () => {
  const courierId = 'courier-service-test-1'
  const currencyCode = 'EUR'
  const shiftBreakMinutes = 30

  let service: TimeWorkedService
  let mockTimeWorkedRepository: any
  let mockConfigDomainService: any

  beforeEach(() => {
    mockConfigDomainService = {
      instanceConfig: {
        getShiftBreakMinutes: jest.fn().mockResolvedValue(shiftBreakMinutes),
        getCurrency: jest.fn().mockResolvedValue(currencyCode),
      },
    }

    mockTimeWorkedRepository = {
      findRecordedFrom: jest.fn().mockResolvedValue(new Date('2026-01-01T00:00:00Z')),
      findRecords: jest.fn().mockResolvedValue({
        statusChanges: [],
        statusBefore: new Map(),
        acceptedDeliveries: new Map(),
        events: [],
        deliveries: [],
        compensations: [],
        everAccepted: new Set(),
      }),
      findAcceptTimes: jest.fn().mockResolvedValue([]),
      findDeliveryPay: jest.fn().mockResolvedValue(null),
      findTimelineEvents: jest.fn().mockResolvedValue([]),
    }

    service = new TimeWorkedService(mockTimeWorkedRepository, mockConfigDomainService)
  })

  describe('Item 6: AC-9, AC-17 - Reach, month parsing and clamping', () => {
    test('reachFromOf reaches back 2 calendar months and clamps to month last day on 31 Jan', () => {
      expect(RIDER_REACH_MONTHS).toBe(2)
      expect(reachFromOf('2026-11-20')).toBe('2026-09-20')
      // 31 January minus 2 months falls back to 30 November (November has 30 days)
      expect(reachFromOf('2027-01-31')).toBe('2026-11-30')
      // 31 March minus 2 months is 31 January (January has 31 days)
      expect(reachFromOf('2027-03-31')).toBe('2027-01-31')
      // 28 February minus 2 months is 28 December
      expect(reachFromOf('2027-02-28')).toBe('2026-12-28')
    })

    test('parseMonth parses valid month and refuses malformed months with 400 sentence', () => {
      const valid = parseMonth('2026-11')
      expect(valid).toEqual({ first: '2026-11-01', last: '2026-11-30' })

      const expectedSentence = 'month must be a month written as YYYY-MM.'

      expect(() => parseMonth('not-a-month')).toThrow(new BadRequestException(expectedSentence))
      expect(() => parseMonth('2026-13')).toThrow(new BadRequestException(expectedSentence))
      expect(() => parseMonth('2026-00')).toThrow(new BadRequestException(expectedSentence))
      expect(() => parseMonth('2026-1')).toThrow(new BadRequestException(expectedSentence))
      expect(() => parseMonth(123)).toThrow(new BadRequestException(expectedSentence))
      expect(() => parseMonth(null)).toThrow(new BadRequestException(expectedSentence))
      expect(() => parseMonth(undefined)).toThrow(new BadRequestException(expectedSentence))
    })

    test('riderMonth clamps from/to to [reachFrom, today], refuses wholly before or wholly after today', async () => {
      // Pin now to 2026-11-20T12:00:00+02:00 (Europe/Athens date: 2026-11-20)
      const now = new Date('2026-11-20T10:00:00Z') // 12:00 Athens
      // reachFrom is 2026-09-20

      // Case 1: Wholly before reachFrom (August 2026) -> 400 naming the limit
      await expect(service.riderMonth(courierId, '2026-08', now)).rejects.toThrow(
        new BadRequestException(
          'You can open your work from 2026-09-20 on, 2 months back. For older work, ask the co-op.'
        )
      )

      // Case 2: Wholly after today (December 2026) -> 400
      await expect(service.riderMonth(courierId, '2026-12', now)).rejects.toThrow(
        new BadRequestException('That month has not started yet.')
      )

      // Case 3: Month holding reachFrom (September 2026):
      // first is 2026-09-01, last is 2026-09-30.
      // Clamped from should be max(2026-09-01, 2026-09-20) = 2026-09-20!
      // to should be min(2026-09-30, 2026-11-20) = 2026-09-30.
      const sepResult = await service.riderMonth(courierId, '2026-09', now)
      expect(sepResult.from).toBe('2026-09-20')
      expect(sepResult.to).toBe('2026-09-30')
      expect(sepResult.reachFrom).toBe('2026-09-20')
      expect(sepResult.month).toBe('2026-09')

      // Week holding reachFrom (week of 2026-09-14 to 2026-09-20):
      // weekStart is 2026-09-14 < reachFrom 2026-09-20 -> cutAtReach is true!
      const reachWeek = sepResult.weeks.find((w) => w.weekStart === '2026-09-14')
      expect(reachWeek).toBeDefined()
      expect(reachWeek!.cutAtReach).toBe(true)

      // Case 4: Current month (November 2026):
      // Clamped to should be min(2026-11-30, 2026-11-20) = 2026-11-20.
      const novResult = await service.riderMonth(courierId, '2026-11', now)
      expect(novResult.from).toBe('2026-11-01')
      expect(novResult.to).toBe('2026-11-20')

      // Week holding today (week of 2026-11-16 to 2026-11-22):
      // soFar is true!
      const currentWeek = novResult.weeks.find((w) => w.weekStart === '2026-11-16')
      expect(currentWeek).toBeDefined()
      expect(currentWeek!.soFar).toBe(true)
    })

    test('no job row accepted before reachFrom is returned in riderMonth', async () => {
      const now = new Date('2026-11-20T10:00:00Z') // Athens: 2026-11-20, reachFrom: 2026-09-20

      // In September, suppose there was an accept on 2026-09-18 (before reachFrom)
      // and an accept on 2026-09-22 (inside reachFrom)
      mockTimeWorkedRepository.findRecords.mockResolvedValue({
        statusChanges: [
          {
            id: 'sc-1',
            courierId,
            createdAt: new Date('2026-09-18T08:00:00Z'),
            fromStatus: EnumCourierStatus.OFFLINE,
            toStatus: EnumCourierStatus.ONLINE,
            cause: EnumCourierStatusChangeCause.RIDER,
            adminUserId: null,
          },
          {
            id: 'sc-2',
            courierId,
            createdAt: new Date('2026-09-22T18:00:00Z'),
            fromStatus: EnumCourierStatus.ONLINE,
            toStatus: EnumCourierStatus.OFFLINE,
            cause: EnumCourierStatusChangeCause.RIDER,
            adminUserId: null,
          },
        ],
        statusBefore: new Map(),
        acceptedDeliveries: new Map([[courierId, new Set(['del-before', 'del-inside'])]]),
        events: [
          {
            id: 'ev-before',
            deliveryId: 'del-before',
            type: EnumDeliveryEventType.ACCEPTED,
            oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
            courierId,
            occurredAt: new Date('2026-09-18T10:00:00Z'),
            createdAt: new Date('2026-09-18T10:00:00Z'),
          },
          {
            id: 'ev-before-drop',
            deliveryId: 'del-before',
            type: EnumDeliveryEventType.DROPPED_OFF,
            oldStatus: EnumDeliveryStatus.ON_THE_WAY,
            courierId,
            occurredAt: new Date('2026-09-18T10:30:00Z'),
            createdAt: new Date('2026-09-18T10:30:00Z'),
          },
          {
            id: 'ev-inside',
            deliveryId: 'del-inside',
            type: EnumDeliveryEventType.ACCEPTED,
            oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
            courierId,
            occurredAt: new Date('2026-09-22T10:00:00Z'),
            createdAt: new Date('2026-09-22T10:00:00Z'),
          },
          {
            id: 'ev-inside-drop',
            deliveryId: 'del-inside',
            type: EnumDeliveryEventType.DROPPED_OFF,
            oldStatus: EnumDeliveryStatus.ON_THE_WAY,
            courierId,
            occurredAt: new Date('2026-09-22T10:30:00Z'),
            createdAt: new Date('2026-09-22T10:30:00Z'),
          },
        ],
        deliveries: [
          {
            id: 'del-before',
            status: EnumDeliveryStatus.DROPPED_OFF,
            courierId,
            totalCompensation: 500,
            tips: 0,
            pickupName: 'Restaurant Before',
            paidKm: 2.0,
            dropoffArea: 'Area 1',
          },
          {
            id: 'del-inside',
            status: EnumDeliveryStatus.DROPPED_OFF,
            courierId,
            totalCompensation: 600,
            tips: 0,
            pickupName: 'Restaurant Inside',
            paidKm: 3.0,
            dropoffArea: 'Area 2',
          },
        ],
        compensations: [],
        everAccepted: new Set(['del-before', 'del-inside']),
      })

      const result = await service.riderMonth(courierId, '2026-09', now)

      const returnedJobs = result.shifts.flatMap((s) => s.jobs)
      // Only the job accepted on or after reachFrom (2026-09-20) is returned
      expect(returnedJobs.some((j) => j.deliveryId === 'del-before')).toBe(false)
      expect(returnedJobs.some((j) => j.deliveryId === 'del-inside')).toBe(true)
    })
  })

  describe('Item 7: AC-10, AC-11, AC-17 - deliveryDetail breakdown, timeline and reach rules', () => {
    const now = new Date('2026-11-20T10:00:00Z') // Athens: 2026-11-20, reachFrom: 2026-09-20

    test('deliveryDetail answers 404 when rider never accepted the delivery', async () => {
      mockTimeWorkedRepository.findAcceptTimes.mockResolvedValue([])

      await expect(service.deliveryDetail(courierId, 'del-never-accepted', now)).rejects.toThrow(
        new NotFoundException('Delivery not found')
      )
    })

    test('deliveryDetail answers 404 when last job was accepted before reachFrom', async () => {
      // Accept was on 2026-09-10 (before reachFrom: 2026-09-20)
      const acceptDate = new Date('2026-09-10T10:00:00Z')
      mockTimeWorkedRepository.findAcceptTimes.mockResolvedValue([acceptDate])

      mockTimeWorkedRepository.findRecords.mockResolvedValue({
        statusChanges: [
          {
            id: 'sc-1',
            courierId,
            createdAt: new Date('2026-09-10T08:00:00Z'),
            fromStatus: EnumCourierStatus.OFFLINE,
            toStatus: EnumCourierStatus.ONLINE,
            cause: EnumCourierStatusChangeCause.RIDER,
            adminUserId: null,
          },
        ],
        statusBefore: new Map(),
        acceptedDeliveries: new Map(),
        events: [
          {
            id: 'ev-old',
            deliveryId: 'del-old',
            type: EnumDeliveryEventType.ACCEPTED,
            oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
            courierId,
            occurredAt: acceptDate,
            createdAt: acceptDate,
          },
        ],
        deliveries: [
          {
            id: 'del-old',
            status: EnumDeliveryStatus.DROPPED_OFF,
            courierId,
            totalCompensation: 500,
            tips: 0,
            pickupName: 'Old Restaurant',
          },
        ],
        compensations: [],
        everAccepted: new Set(['del-old']),
      })

      await expect(service.deliveryDetail(courierId, 'del-old', now)).rejects.toThrow(
        new NotFoundException('Delivery not found')
      )
    })

    test('a first hold before reach and a second inside it gives 200 with both holds', async () => {
      // Hold 1 accepted on 2026-09-10 (before reach)
      // Hold 2 accepted on 2026-10-15 (inside reach)
      const tHold1 = new Date('2026-09-10T10:00:00Z')
      const tHold2 = new Date('2026-10-15T12:00:00Z')
      mockTimeWorkedRepository.findAcceptTimes.mockResolvedValue([tHold1, tHold2])

      // forRider query for 2026-09-10 and 2026-10-15
      mockTimeWorkedRepository.findRecords.mockImplementation(({ rangeStart }: any) => {
        const isSep = rangeStart.getTime() < new Date('2026-10-01T00:00:00Z').getTime()
        if (isSep) {
          return Promise.resolve({
            statusChanges: [
              {
                id: 'sc-sep-1',
                courierId,
                createdAt: new Date('2026-09-10T08:00:00Z'),
                fromStatus: EnumCourierStatus.OFFLINE,
                toStatus: EnumCourierStatus.ONLINE,
                cause: EnumCourierStatusChangeCause.RIDER,
                adminUserId: null,
              },
            ],
            statusBefore: new Map(),
            acceptedDeliveries: new Map([[courierId, new Set(['del-multi-hold'])]]),
            events: [
              {
                id: 'ev-sep-1',
                deliveryId: 'del-multi-hold',
                type: EnumDeliveryEventType.ACCEPTED,
                oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
                courierId,
                occurredAt: tHold1,
                createdAt: tHold1,
              },
              {
                id: 'ev-sep-2',
                deliveryId: 'del-multi-hold',
                type: EnumDeliveryEventType.HANDED_BACK,
                oldStatus: EnumDeliveryStatus.ACCEPTED,
                courierId,
                occurredAt: new Date('2026-09-10T10:02:00Z'),
                createdAt: new Date('2026-09-10T10:02:00Z'),
              },
            ],
            deliveries: [
              {
                id: 'del-multi-hold',
                status: EnumDeliveryStatus.ASSIGNING_COURIER,
                courierId: null,
                totalCompensation: 500,
                tips: 0,
                pickupName: 'Taverna Nosh',
              },
            ],
            compensations: [],
            everAccepted: new Set(['del-multi-hold']),
          })
        } else {
          return Promise.resolve({
            statusChanges: [
              {
                id: 'sc-oct-1',
                courierId,
                createdAt: new Date('2026-10-15T08:00:00Z'),
                fromStatus: EnumCourierStatus.OFFLINE,
                toStatus: EnumCourierStatus.ONLINE,
                cause: EnumCourierStatusChangeCause.RIDER,
                adminUserId: null,
              },
            ],
            statusBefore: new Map(),
            acceptedDeliveries: new Map([[courierId, new Set(['del-multi-hold'])]]),
            events: [
              {
                id: 'ev-oct-1',
                deliveryId: 'del-multi-hold',
                type: EnumDeliveryEventType.ACCEPTED,
                oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
                courierId,
                occurredAt: tHold2,
                createdAt: tHold2,
              },
              {
                id: 'ev-oct-2',
                deliveryId: 'del-multi-hold',
                type: EnumDeliveryEventType.DROPPED_OFF,
                oldStatus: EnumDeliveryStatus.ON_THE_WAY,
                courierId,
                occurredAt: new Date('2026-10-15T12:30:00Z'),
                createdAt: new Date('2026-10-15T12:30:00Z'),
              },
            ],
            deliveries: [
              {
                id: 'del-multi-hold',
                status: EnumDeliveryStatus.DROPPED_OFF,
                courierId,
                totalCompensation: 500,
                tips: 50,
                pickupName: 'Taverna Nosh',
              },
            ],
            compensations: [],
            everAccepted: new Set(['del-multi-hold']),
          })
        }
      })

      mockTimeWorkedRepository.findDeliveryPay.mockResolvedValue({
        id: 'del-multi-hold',
        status: EnumDeliveryStatus.DROPPED_OFF,
        courierId,
        totalCompensation: 500,
        tips: 50,
        pickupName: 'Taverna Nosh',
        baseFee: 200,
        distanceFee: 300,
        paidKm: 2.0,
        dropoffArea: 'Iasonos',
      })

      mockTimeWorkedRepository.findTimelineEvents.mockResolvedValue([
        {
          id: 'ev-1',
          deliveryId: 'del-multi-hold',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          actor: EnumEventActor.COURIER,
          courierId,
          occurredAt: tHold1,
          createdAt: tHold1,
        },
        {
          id: 'ev-2',
          deliveryId: 'del-multi-hold',
          type: EnumDeliveryEventType.HANDED_BACK,
          oldStatus: EnumDeliveryStatus.ACCEPTED,
          actor: EnumEventActor.COURIER,
          courierId,
          occurredAt: new Date('2026-09-10T10:02:00Z'),
          createdAt: new Date('2026-09-10T10:02:00Z'),
        },
        {
          id: 'ev-3',
          deliveryId: 'del-multi-hold',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          actor: EnumEventActor.COURIER,
          courierId,
          occurredAt: tHold2,
          createdAt: tHold2,
        },
        {
          id: 'ev-4',
          deliveryId: 'del-multi-hold',
          type: EnumDeliveryEventType.DROPPED_OFF,
          oldStatus: EnumDeliveryStatus.ON_THE_WAY,
          actor: EnumEventActor.COURIER,
          courierId,
          occurredAt: new Date('2026-10-15T12:30:00Z'),
          createdAt: new Date('2026-10-15T12:30:00Z'),
        },
      ])

      const result = await service.deliveryDetail(courierId, 'del-multi-hold', now)

      expect(result).toBeDefined()
      // Both holds must be returned!
      expect(result.jobs).toHaveLength(2)
      expect(result.jobs[0]!.acceptedAt).toEqual(tHold1)
      expect(result.jobs[0]!.endLabel).toBe(EnumJobEndLabel.HANDED_BACK)
      expect(result.jobs[1]!.acceptedAt).toEqual(tHold2)
      expect(result.jobs[1]!.endLabel).toBeNull() // Dropped off

      // Breakdown check:
      expect(result.breakdown.deliveryPayCents).toBe(500)
      expect(result.breakdown.tipsCents).toBe(50)
      // base (200) + distance (300) === 500 -> both shown!
      expect(result.breakdown.baseFeeCents).toBe(200)
      expect(result.breakdown.distanceFeeCents).toBe(300)
      expect(result.breakdown.totalCents).toBe(550)
    })

    test('breakdown sets baseFee and distanceFee to null when they do not add up to deliveryPayCents', async () => {
      const tAccept = new Date('2026-11-20T10:00:00Z')
      mockTimeWorkedRepository.findAcceptTimes.mockResolvedValue([tAccept])

      mockTimeWorkedRepository.findRecords.mockResolvedValue({
        statusChanges: [
          {
            id: 'sc-1',
            courierId,
            createdAt: new Date('2026-11-20T08:00:00Z'),
            fromStatus: EnumCourierStatus.OFFLINE,
            toStatus: EnumCourierStatus.ONLINE,
            cause: EnumCourierStatusChangeCause.RIDER,
            adminUserId: null,
          },
        ],
        statusBefore: new Map(),
        acceptedDeliveries: new Map([[courierId, new Set(['del-mismatch'])]]),
        events: [
          {
            id: 'ev-1',
            deliveryId: 'del-mismatch',
            type: EnumDeliveryEventType.ACCEPTED,
            oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
            courierId,
            occurredAt: tAccept,
            createdAt: tAccept,
          },
          {
            id: 'ev-2',
            deliveryId: 'del-mismatch',
            type: EnumDeliveryEventType.DROPPED_OFF,
            oldStatus: EnumDeliveryStatus.ON_THE_WAY,
            courierId,
            occurredAt: new Date('2026-11-20T10:30:00Z'),
            createdAt: new Date('2026-11-20T10:30:00Z'),
          },
        ],
        deliveries: [
          {
            id: 'del-mismatch',
            status: EnumDeliveryStatus.DROPPED_OFF,
            courierId,
            totalCompensation: 600, // deliveryPayCents
            tips: 0,
            pickupName: 'Taverna Nosh',
          },
        ],
        compensations: [],
        everAccepted: new Set(['del-mismatch']),
      })

      // baseFee (200) + distanceFee (250) = 450 !== totalCompensation (600)
      mockTimeWorkedRepository.findDeliveryPay.mockResolvedValue({
        id: 'del-mismatch',
        status: EnumDeliveryStatus.DROPPED_OFF,
        courierId,
        totalCompensation: 600,
        tips: 0,
        pickupName: 'Taverna Nosh',
        baseFee: 200,
        distanceFee: 250,
        paidKm: 2.0,
        dropoffArea: 'Iasonos',
      })

      mockTimeWorkedRepository.findTimelineEvents.mockResolvedValue([
        {
          id: 'ev-1',
          deliveryId: 'del-mismatch',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          actor: EnumEventActor.COURIER,
          courierId,
          occurredAt: tAccept,
          createdAt: tAccept,
        },
        {
          id: 'ev-2',
          deliveryId: 'del-mismatch',
          type: EnumDeliveryEventType.DROPPED_OFF,
          oldStatus: EnumDeliveryStatus.ON_THE_WAY,
          actor: EnumEventActor.COURIER,
          courierId,
          occurredAt: new Date('2026-11-20T10:30:00Z'),
          createdAt: new Date('2026-11-20T10:30:00Z'),
        },
      ])

      const result = await service.deliveryDetail(courierId, 'del-mismatch', now)

      expect(result.breakdown.deliveryPayCents).toBe(600)
      expect(result.breakdown.baseFeeCents).toBeNull()
      expect(result.breakdown.distanceFeeCents).toBeNull()
      expect(result.breakdown.totalCents).toBe(600)
    })

    test('breakdown returns 0 delivery pay and tips when rider job did not end in drop off', async () => {
      const tAccept = new Date('2026-11-20T10:00:00Z')
      mockTimeWorkedRepository.findAcceptTimes.mockResolvedValue([tAccept])

      mockTimeWorkedRepository.findRecords.mockResolvedValue({
        statusChanges: [
          {
            id: 'sc-1',
            courierId,
            createdAt: new Date('2026-11-20T08:00:00Z'),
            fromStatus: EnumCourierStatus.OFFLINE,
            toStatus: EnumCourierStatus.ONLINE,
            cause: EnumCourierStatusChangeCause.RIDER,
            adminUserId: null,
          },
        ],
        statusBefore: new Map(),
        acceptedDeliveries: new Map([[courierId, new Set(['del-canc'])]]),
        events: [
          {
            id: 'ev-1',
            deliveryId: 'del-canc',
            type: EnumDeliveryEventType.ACCEPTED,
            oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
            courierId,
            occurredAt: tAccept,
            createdAt: tAccept,
          },
          {
            id: 'ev-2',
            deliveryId: 'del-canc',
            type: EnumDeliveryEventType.CANCELED,
            oldStatus: EnumDeliveryStatus.ACCEPTED,
            courierId: null,
            occurredAt: new Date('2026-11-20T10:15:00Z'),
            createdAt: new Date('2026-11-20T10:15:00Z'),
          },
        ],
        deliveries: [
          {
            id: 'del-canc',
            status: EnumDeliveryStatus.CANCELED,
            courierId,
            totalCompensation: 500,
            tips: 50,
            pickupName: 'Taverna',
          },
        ],
        compensations: [
          {
            id: 'comp-canc',
            courierId,
            deliveryId: 'del-canc',
            amount: 300,
            currencyCode,
            reason: EnumCourierCompensationReason.CANCELLATION,
            waitMinutes: null,
            createdAt: new Date('2026-11-20T10:15:00Z'),
          },
        ],
        everAccepted: new Set(['del-canc']),
      })

      mockTimeWorkedRepository.findDeliveryPay.mockResolvedValue({
        id: 'del-canc',
        status: EnumDeliveryStatus.CANCELED,
        courierId,
        totalCompensation: 500,
        tips: 50,
        pickupName: 'Taverna',
        baseFee: 200,
        distanceFee: 300,
        paidKm: 2.0,
        dropoffArea: 'Iasonos',
      })

      mockTimeWorkedRepository.findTimelineEvents.mockResolvedValue([
        {
          id: 'ev-1',
          deliveryId: 'del-canc',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          actor: EnumEventActor.COURIER,
          courierId,
          occurredAt: tAccept,
          createdAt: tAccept,
        },
        {
          id: 'ev-2',
          deliveryId: 'del-canc',
          type: EnumDeliveryEventType.CANCELED,
          oldStatus: EnumDeliveryStatus.ACCEPTED,
          actor: EnumEventActor.ADMIN,
          courierId: null,
          occurredAt: new Date('2026-11-20T10:15:00Z'),
          createdAt: new Date('2026-11-20T10:15:00Z'),
        },
      ])

      const result = await service.deliveryDetail(courierId, 'del-canc', now)

      expect(result.breakdown.deliveryPayCents).toBe(0)
      expect(result.breakdown.tipsCents).toBe(0)
      expect(result.breakdown.baseFeeCents).toBeNull()
      expect(result.breakdown.distanceFeeCents).toBeNull()
      expect(result.breakdown.compensations).toHaveLength(1)
      expect(result.breakdown.compensations[0]!.amountCents).toBe(300)
      expect(result.breakdown.compensations[0]!.reason).toBe(EnumCourierCompensationReason.CANCELLATION)
      expect(result.breakdown.totalCents).toBe(300)
    })
  })

  describe('jobMinutes', () => {
    test('computes whole minutes between acceptedAt and endedAt (or now while held)', () => {
      const acceptedAt = new Date('2026-11-20T10:00:00Z')
      const endedAt = new Date('2026-11-20T10:14:40Z') // 14m 40s -> rounds to 15m
      expect(jobMinutes({ acceptedAt, endedAt }, new Date())).toBe(15)

      // When endedAt is null, uses now
      const now = new Date('2026-11-20T10:20:10Z') // 20m 10s -> rounds to 20m
      expect(jobMinutes({ acceptedAt, endedAt: null }, now)).toBe(20)
    })
  })
})
