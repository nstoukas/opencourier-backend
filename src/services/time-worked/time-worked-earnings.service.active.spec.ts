import { BadRequestException } from '@nestjs/common'
import * as errors from 'src/errors'
import {
  EnumCourierCompensationReason,
  EnumCourierStatus,
  EnumCourierStatusChangeCause,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
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
import { EnumTimelineWho } from 'src/domains/time-worked/delivery-timeline'

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

    test('AC-8, AC-17, decision 75.25: a shift starting before asked range with jobs before and inside returns only the job inside, and jobsInNoShift is cut the same way', async () => {
      const now = new Date('2026-11-20T10:00:00Z')

      // Range: from 2026-11-05 to 2026-11-05
      // Shift: 2026-11-04 22:00 Athens (2026-11-04T20:00:00Z) to 2026-11-05 06:00 Athens (2026-11-05T04:00:00Z)
      // Job 1 inside shift: accepted 2026-11-04 23:00 Athens (2026-11-04T21:00:00Z) - before asked range
      // Job 2 inside shift: accepted 2026-11-05 01:30 Athens (2026-11-04T23:30:00Z) - inside asked range
      // Job 3 no shift: accepted 2026-11-04 20:00 Athens (2026-11-04T18:00:00Z) - before asked range
      // Job 4 no shift: accepted 2026-11-05 07:00 Athens (2026-11-05T05:00:00Z) - inside asked range
      mockTimeWorkedRepository.findRecords.mockResolvedValue({
        statusChanges: [
          {
            id: 'sc-1',
            courierId,
            createdAt: new Date('2026-11-04T20:00:00Z'),
            fromStatus: EnumCourierStatus.OFFLINE,
            toStatus: EnumCourierStatus.ONLINE,
            cause: EnumCourierStatusChangeCause.RIDER,
            adminUserId: null,
          },
          {
            id: 'sc-2',
            courierId,
            createdAt: new Date('2026-11-05T04:00:00Z'),
            fromStatus: EnumCourierStatus.ONLINE,
            toStatus: EnumCourierStatus.OFFLINE,
            cause: EnumCourierStatusChangeCause.RIDER,
            adminUserId: null,
          },
        ],
        statusBefore: new Map(),
        acceptedDeliveries: new Map([[courierId, new Set(['del-shift-before', 'del-shift-inside', 'del-noshift-before', 'del-noshift-inside'])]]),
        events: [
          {
            id: 'ev-1',
            deliveryId: 'del-shift-before',
            type: EnumDeliveryEventType.ACCEPTED,
            oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
            courierId,
            occurredAt: new Date('2026-11-04T21:00:00Z'),
            createdAt: new Date('2026-11-04T21:00:00Z'),
          },
          {
            id: 'ev-2',
            deliveryId: 'del-shift-before',
            type: EnumDeliveryEventType.DROPPED_OFF,
            oldStatus: EnumDeliveryStatus.ON_THE_WAY,
            courierId,
            occurredAt: new Date('2026-11-04T21:30:00Z'),
            createdAt: new Date('2026-11-04T21:30:00Z'),
          },
          {
            id: 'ev-3',
            deliveryId: 'del-shift-inside',
            type: EnumDeliveryEventType.ACCEPTED,
            oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
            courierId,
            occurredAt: new Date('2026-11-04T23:30:00Z'),
            createdAt: new Date('2026-11-04T23:30:00Z'),
          },
          {
            id: 'ev-4',
            deliveryId: 'del-shift-inside',
            type: EnumDeliveryEventType.DROPPED_OFF,
            oldStatus: EnumDeliveryStatus.ON_THE_WAY,
            courierId,
            occurredAt: new Date('2026-11-05T00:00:00Z'),
            createdAt: new Date('2026-11-05T00:00:00Z'),
          },
          {
            id: 'ev-5',
            deliveryId: 'del-noshift-before',
            type: EnumDeliveryEventType.ACCEPTED,
            oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
            courierId,
            occurredAt: new Date('2026-11-04T18:00:00Z'),
            createdAt: new Date('2026-11-04T18:00:00Z'),
          },
          {
            id: 'ev-6',
            deliveryId: 'del-noshift-before',
            type: EnumDeliveryEventType.DROPPED_OFF,
            oldStatus: EnumDeliveryStatus.ON_THE_WAY,
            courierId,
            occurredAt: new Date('2026-11-04T18:00:00Z'),
            createdAt: new Date('2026-11-04T18:00:00Z'),
          },
          {
            id: 'ev-7',
            deliveryId: 'del-noshift-inside',
            type: EnumDeliveryEventType.ACCEPTED,
            oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
            courierId,
            occurredAt: new Date('2026-11-05T05:00:00Z'),
            createdAt: new Date('2026-11-05T05:00:00Z'),
          },
          {
            id: 'ev-8',
            deliveryId: 'del-noshift-inside',
            type: EnumDeliveryEventType.DROPPED_OFF,
            oldStatus: EnumDeliveryStatus.ON_THE_WAY,
            courierId,
            occurredAt: new Date('2026-11-05T05:00:00Z'),
            createdAt: new Date('2026-11-05T05:00:00Z'),
          },
        ],
        deliveries: [
          {
            id: 'del-shift-before',
            status: EnumDeliveryStatus.DROPPED_OFF,
            courierId,
            totalCompensation: 500,
            tips: 0,
            pickupName: 'Restaurant 1',
            paidKm: 2.0,
            dropoffArea: 'Area 1',
          },
          {
            id: 'del-shift-inside',
            status: EnumDeliveryStatus.DROPPED_OFF,
            courierId,
            totalCompensation: 600,
            tips: 0,
            pickupName: 'Restaurant 2',
            paidKm: 3.0,
            dropoffArea: 'Area 2',
          },
          {
            id: 'del-noshift-before',
            status: EnumDeliveryStatus.DROPPED_OFF,
            courierId,
            totalCompensation: 300,
            tips: 0,
            pickupName: 'Restaurant 3',
            paidKm: 1.0,
            dropoffArea: 'Area 3',
          },
          {
            id: 'del-noshift-inside',
            status: EnumDeliveryStatus.DROPPED_OFF,
            courierId,
            totalCompensation: 400,
            tips: 0,
            pickupName: 'Restaurant 4',
            paidKm: 1.5,
            dropoffArea: 'Area 4',
          },
        ],
        compensations: [],
        everAccepted: new Set(['del-shift-before', 'del-shift-inside', 'del-noshift-before', 'del-noshift-inside']),
      })

      const result = await service.earnings(
        courierId,
        { from: '2026-11-05', to: '2026-11-05', reachFrom: null },
        { withAdminLabels: false },
        now
      )

      expect(result.shifts).toHaveLength(1)
      const shiftJobs = result.shifts[0]!.jobs
      // Must contain only the job accepted inside the asked days
      expect(shiftJobs.map((j) => j.deliveryId)).toEqual(['del-shift-inside'])
      expect(shiftJobs.some((j) => j.deliveryId === 'del-shift-before')).toBe(false)

      // jobsInNoShift must also be cut to the asked days
      expect(result.jobsInNoShift.map((j) => j.deliveryId)).toEqual(['del-noshift-inside'])
      expect(result.jobsInNoShift.some((j) => j.deliveryId === 'del-noshift-before')).toBe(false)
    })

    test('riderMonth returns no job accepted before reachFrom in shifts or in jobsInNoShift (AC-8, AC-17, decision 75.25)', async () => {
      const now = new Date('2026-11-20T10:00:00Z') // Athens: 2026-11-20, reachFrom: 2026-09-20

      // Month: 2026-09. Clamped range: 2026-09-20 to 2026-09-30.
      // Shift starts 2026-09-19 22:00 Athens (2026-09-19T19:00:00Z) and ends 2026-09-20 06:00 Athens (2026-09-20T03:00:00Z)
      // Job 1 inside shift: accepted 2026-09-19 23:00 Athens (2026-09-19T20:00:00Z) - before reachFrom
      // Job 2 inside shift: accepted 2026-09-20 01:00 Athens (2026-09-19T22:00:00Z) - inside reachFrom
      // Job 3 no shift: accepted 2026-09-19 21:00 Athens (2026-09-19T18:00:00Z) - before reachFrom
      // Job 4 no shift: accepted 2026-09-20 08:00 Athens (2026-09-20T05:00:00Z) - inside reachFrom
      mockTimeWorkedRepository.findRecords.mockResolvedValue({
        statusChanges: [
          {
            id: 'sc-1',
            courierId,
            createdAt: new Date('2026-09-19T19:00:00Z'),
            fromStatus: EnumCourierStatus.OFFLINE,
            toStatus: EnumCourierStatus.ONLINE,
            cause: EnumCourierStatusChangeCause.RIDER,
            adminUserId: null,
          },
          {
            id: 'sc-2',
            courierId,
            createdAt: new Date('2026-09-20T03:00:00Z'),
            fromStatus: EnumCourierStatus.ONLINE,
            toStatus: EnumCourierStatus.OFFLINE,
            cause: EnumCourierStatusChangeCause.RIDER,
            adminUserId: null,
          },
        ],
        statusBefore: new Map(),
        acceptedDeliveries: new Map([[courierId, new Set(['del-sep-before', 'del-sep-inside', 'del-sep-noshift-before', 'del-sep-noshift-inside'])]]),
        events: [
          {
            id: 'ev-1',
            deliveryId: 'del-sep-before',
            type: EnumDeliveryEventType.ACCEPTED,
            oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
            courierId,
            occurredAt: new Date('2026-09-19T20:00:00Z'),
            createdAt: new Date('2026-09-19T20:00:00Z'),
          },
          {
            id: 'ev-2',
            deliveryId: 'del-sep-before',
            type: EnumDeliveryEventType.DROPPED_OFF,
            oldStatus: EnumDeliveryStatus.ON_THE_WAY,
            courierId,
            occurredAt: new Date('2026-09-19T20:30:00Z'),
            createdAt: new Date('2026-09-19T20:30:00Z'),
          },
          {
            id: 'ev-3',
            deliveryId: 'del-sep-inside',
            type: EnumDeliveryEventType.ACCEPTED,
            oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
            courierId,
            occurredAt: new Date('2026-09-19T22:00:00Z'),
            createdAt: new Date('2026-09-19T22:00:00Z'),
          },
          {
            id: 'ev-4',
            deliveryId: 'del-sep-inside',
            type: EnumDeliveryEventType.DROPPED_OFF,
            oldStatus: EnumDeliveryStatus.ON_THE_WAY,
            courierId,
            occurredAt: new Date('2026-09-19T22:30:00Z'),
            createdAt: new Date('2026-09-19T22:30:00Z'),
          },
          {
            id: 'ev-5',
            deliveryId: 'del-sep-noshift-before',
            type: EnumDeliveryEventType.ACCEPTED,
            oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
            courierId,
            occurredAt: new Date('2026-09-19T18:00:00Z'),
            createdAt: new Date('2026-09-19T18:00:00Z'),
          },
          {
            id: 'ev-6',
            deliveryId: 'del-sep-noshift-before',
            type: EnumDeliveryEventType.DROPPED_OFF,
            oldStatus: EnumDeliveryStatus.ON_THE_WAY,
            courierId,
            occurredAt: new Date('2026-09-19T18:00:00Z'),
            createdAt: new Date('2026-09-19T18:00:00Z'),
          },
          {
            id: 'ev-7',
            deliveryId: 'del-sep-noshift-inside',
            type: EnumDeliveryEventType.ACCEPTED,
            oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
            courierId,
            occurredAt: new Date('2026-09-20T05:00:00Z'),
            createdAt: new Date('2026-09-20T05:00:00Z'),
          },
          {
            id: 'ev-8',
            deliveryId: 'del-sep-noshift-inside',
            type: EnumDeliveryEventType.DROPPED_OFF,
            oldStatus: EnumDeliveryStatus.ON_THE_WAY,
            courierId,
            occurredAt: new Date('2026-09-20T05:00:00Z'),
            createdAt: new Date('2026-09-20T05:00:00Z'),
          },
        ],
        deliveries: [
          {
            id: 'del-sep-before',
            status: EnumDeliveryStatus.DROPPED_OFF,
            courierId,
            totalCompensation: 500,
            tips: 0,
            pickupName: 'Restaurant Sep 1',
            paidKm: 2.0,
            dropoffArea: 'Area 1',
          },
          {
            id: 'del-sep-inside',
            status: EnumDeliveryStatus.DROPPED_OFF,
            courierId,
            totalCompensation: 600,
            tips: 0,
            pickupName: 'Restaurant Sep 2',
            paidKm: 3.0,
            dropoffArea: 'Area 2',
          },
          {
            id: 'del-sep-noshift-before',
            status: EnumDeliveryStatus.DROPPED_OFF,
            courierId,
            totalCompensation: 300,
            tips: 0,
            pickupName: 'Restaurant Sep 3',
            paidKm: 1.0,
            dropoffArea: 'Area 3',
          },
          {
            id: 'del-sep-noshift-inside',
            status: EnumDeliveryStatus.DROPPED_OFF,
            courierId,
            totalCompensation: 400,
            tips: 0,
            pickupName: 'Restaurant Sep 4',
            paidKm: 1.5,
            dropoffArea: 'Area 4',
          },
        ],
        compensations: [],
        everAccepted: new Set(['del-sep-before', 'del-sep-inside', 'del-sep-noshift-before', 'del-sep-noshift-inside']),
      })

      const sepResult = await service.riderMonth(courierId, '2026-09', now)

      expect(sepResult.shifts).toHaveLength(1)
      const shiftJobs = sepResult.shifts[0]!.jobs
      // Only the job accepted on or after reachFrom (2026-09-20) is returned
      expect(shiftJobs.map((j) => j.deliveryId)).toEqual(['del-sep-inside'])
      expect(shiftJobs.some((j) => j.deliveryId === 'del-sep-before')).toBe(false)

      expect(sepResult.jobsInNoShift.map((j) => j.deliveryId)).toEqual(['del-sep-noshift-inside'])
      expect(sepResult.jobsInNoShift.some((j) => j.deliveryId === 'del-sep-noshift-before')).toBe(false)
    })
  })

  describe('Item 7: AC-10, AC-11, AC-17 - deliveryDetail breakdown, timeline and reach rules', () => {
    const now = new Date('2026-11-20T10:00:00Z') // Athens: 2026-11-20, reachFrom: 2026-09-20

    test('deliveryDetail answers 404 when rider never accepted the delivery', async () => {
      mockTimeWorkedRepository.findAcceptTimes.mockResolvedValue([])

      await expect(service.deliveryDetail(courierId, 'del-never-accepted', now)).rejects.toBeInstanceOf(
        errors.NotFoundException
      )
      await expect(service.deliveryDetail(courierId, 'del-never-accepted', now)).rejects.toThrow('Delivery not found')
    })

    test('deliveryDetail answers 404 when delivery is missing from repository (AC-18)', async () => {
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
        acceptedDeliveries: new Map([[courierId, new Set(['del-missing'])]]),
        events: [
          {
            id: 'ev-1',
            deliveryId: 'del-missing',
            type: EnumDeliveryEventType.ACCEPTED,
            oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
            courierId,
            occurredAt: tAccept,
            createdAt: tAccept,
          },
        ],
        deliveries: [
          {
            id: 'del-missing',
            status: EnumDeliveryStatus.ACCEPTED,
            courierId,
            totalCompensation: 500,
            tips: 0,
            pickupName: 'Taverna',
          },
        ],
        compensations: [],
        everAccepted: new Set(['del-missing']),
      })
      mockTimeWorkedRepository.findDeliveryPay.mockResolvedValue(null)
      mockTimeWorkedRepository.findTimelineEvents.mockResolvedValue([])

      await expect(service.deliveryDetail(courierId, 'del-missing', now)).rejects.toBeInstanceOf(
        errors.NotFoundException
      )
      await expect(service.deliveryDetail(courierId, 'del-missing', now)).rejects.toThrow('Delivery not found')
    })

    test('deliveryDetail answers 404 when rider only (or last) job was accepted before reachFrom (AC-17)', async () => {
      // Accept was on 2026-09-10 (before reachFrom: 2026-09-20 when now is 2026-11-20)
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
        acceptedDeliveries: new Map([[courierId, new Set(['del-old'])]]),
        events: [
          {
            id: 'ev-old-accept',
            deliveryId: 'del-old',
            type: EnumDeliveryEventType.ACCEPTED,
            oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
            courierId,
            occurredAt: acceptDate,
            createdAt: acceptDate,
          },
          {
            id: 'ev-old-drop',
            deliveryId: 'del-old',
            type: EnumDeliveryEventType.DROPPED_OFF,
            oldStatus: EnumDeliveryStatus.ON_THE_WAY,
            courierId,
            occurredAt: new Date('2026-09-10T10:30:00Z'),
            createdAt: new Date('2026-09-10T10:30:00Z'),
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
            paidKm: 2.0,
            dropoffArea: 'Old Area',
          },
        ],
        compensations: [],
        everAccepted: new Set(['del-old']),
      })

      // Pay and timeline are mocked with valid data so 404 is strictly due to dateOf(last.acceptedAt) < reachFrom
      mockTimeWorkedRepository.findDeliveryPay.mockResolvedValue({
        id: 'del-old',
        status: EnumDeliveryStatus.DROPPED_OFF,
        courierId,
        totalCompensation: 500,
        tips: 0,
        pickupName: 'Old Restaurant',
        baseFee: 200,
        distanceFee: 300,
        paidKm: 2.0,
        dropoffArea: 'Old Area',
      })
      mockTimeWorkedRepository.findTimelineEvents.mockResolvedValue([])

      await expect(service.deliveryDetail(courierId, 'del-old', now)).rejects.toBeInstanceOf(errors.NotFoundException)
      await expect(service.deliveryDetail(courierId, 'del-old', now)).rejects.toThrow('Delivery not found')
    })

    test('deliveryDetail answers 404 when rider held the delivery multiple times but the last hold was before reachFrom (AC-17)', async () => {
      const tHold1 = new Date('2026-09-05T10:00:00Z')
      const tHold2 = new Date('2026-09-10T10:00:00Z')
      mockTimeWorkedRepository.findAcceptTimes.mockResolvedValue([tHold1, tHold2])

      mockTimeWorkedRepository.findRecords.mockResolvedValue({
        statusChanges: [
          {
            id: 'sc-1',
            courierId,
            createdAt: new Date('2026-09-05T08:00:00Z'),
            fromStatus: EnumCourierStatus.OFFLINE,
            toStatus: EnumCourierStatus.ONLINE,
            cause: EnumCourierStatusChangeCause.RIDER,
            adminUserId: null,
          },
        ],
        statusBefore: new Map(),
        acceptedDeliveries: new Map([[courierId, new Set(['del-multi-old'])]]),
        events: [
          {
            id: 'ev-1',
            deliveryId: 'del-multi-old',
            type: EnumDeliveryEventType.ACCEPTED,
            oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
            courierId,
            occurredAt: tHold1,
            createdAt: tHold1,
          },
          {
            id: 'ev-2',
            deliveryId: 'del-multi-old',
            type: EnumDeliveryEventType.HANDED_BACK,
            oldStatus: EnumDeliveryStatus.ACCEPTED,
            courierId,
            occurredAt: new Date('2026-09-05T10:02:00Z'),
            createdAt: new Date('2026-09-05T10:02:00Z'),
          },
          {
            id: 'ev-3',
            deliveryId: 'del-multi-old',
            type: EnumDeliveryEventType.ACCEPTED,
            oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
            courierId,
            occurredAt: tHold2,
            createdAt: tHold2,
          },
          {
            id: 'ev-4',
            deliveryId: 'del-multi-old',
            type: EnumDeliveryEventType.DROPPED_OFF,
            oldStatus: EnumDeliveryStatus.ON_THE_WAY,
            courierId,
            occurredAt: new Date('2026-09-10T10:30:00Z'),
            createdAt: new Date('2026-09-10T10:30:00Z'),
          },
        ],
        deliveries: [
          {
            id: 'del-multi-old',
            status: EnumDeliveryStatus.DROPPED_OFF,
            courierId,
            totalCompensation: 500,
            tips: 0,
            pickupName: 'Old Restaurant',
            paidKm: 2.0,
            dropoffArea: 'Old Area',
          },
        ],
        compensations: [],
        everAccepted: new Set(['del-multi-old']),
      })

      mockTimeWorkedRepository.findDeliveryPay.mockResolvedValue({
        id: 'del-multi-old',
        status: EnumDeliveryStatus.DROPPED_OFF,
        courierId,
        totalCompensation: 500,
        tips: 0,
        pickupName: 'Old Restaurant',
        baseFee: 200,
        distanceFee: 300,
        paidKm: 2.0,
        dropoffArea: 'Old Area',
      })
      mockTimeWorkedRepository.findTimelineEvents.mockResolvedValue([])

      await expect(service.deliveryDetail(courierId, 'del-multi-old', now)).rejects.toBeInstanceOf(
        errors.NotFoundException
      )
      await expect(service.deliveryDetail(courierId, 'del-multi-old', now)).rejects.toThrow('Delivery not found')
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

    test('AC-10, AC-11, review minor 2: deliveryDetail timeline wiring and compensation addedLater', async () => {
      const deliveryId = 'del-wiring-test'
      const otherCourierId = 'courier-other-999'

      // Shift is 08:00 to 12:00 Athens (06:00 to 10:00 UTC)
      const shiftStart = new Date('2026-11-20T06:00:00Z')
      const shiftEnd = new Date('2026-11-20T10:00:00Z')

      // Delivery events timeline:
      // 1. Other rider accepted at 06:30 UTC
      const tOtherAccept = new Date('2026-11-20T06:30:00Z')
      // 2. Other rider handed back at 06:45 UTC
      const tOtherHandBack = new Date('2026-11-20T06:45:00Z')
      // 3. This rider accepted at 07:00 UTC
      const tAccept = new Date('2026-11-20T07:00:00Z')
      // 4. Step event of this rider's job carrying courierId null, inside hold at 07:15 UTC
      const tStepInside = new Date('2026-11-20T07:15:00Z')
      // 5. This rider dropped off at 07:30 UTC (ends the hold)
      const tDropOff = new Date('2026-11-20T07:30:00Z')
      // 6. Step event received after the hold ended at 08:00 UTC (courierId null)
      const tStepAfter = new Date('2026-11-20T08:00:00Z')

      mockTimeWorkedRepository.findAcceptTimes.mockResolvedValue([tAccept])

      // Compensations:
      // comp1: while shift was open (at 09:00 UTC, before shiftEnd 10:00 UTC) -> addedLater false
      const tCompOpen = new Date('2026-11-20T09:00:00Z')
      // comp2: after shift ended (at 11:00 UTC, after shiftEnd 10:00 UTC) -> addedLater true
      const tCompAfter = new Date('2026-11-20T11:00:00Z')

      const comps = [
        {
          id: 'comp-during-shift',
          courierId,
          deliveryId,
          amount: 150,
          currencyCode,
          reason: EnumCourierCompensationReason.WAITING,
          waitMinutes: 5,
          createdAt: tCompOpen,
        },
        {
          id: 'comp-after-shift',
          courierId,
          deliveryId,
          amount: 250,
          currencyCode,
          reason: EnumCourierCompensationReason.REVIEW,
          waitMinutes: null,
          createdAt: tCompAfter,
        },
      ]

      mockTimeWorkedRepository.findRecords.mockResolvedValue({
        statusChanges: [
          {
            id: 'sc-1',
            courierId,
            createdAt: shiftStart,
            fromStatus: EnumCourierStatus.OFFLINE,
            toStatus: EnumCourierStatus.ONLINE,
            cause: EnumCourierStatusChangeCause.RIDER,
            adminUserId: null,
          },
          {
            id: 'sc-2',
            courierId,
            createdAt: shiftEnd,
            fromStatus: EnumCourierStatus.ONLINE,
            toStatus: EnumCourierStatus.OFFLINE,
            cause: EnumCourierStatusChangeCause.RIDER,
            adminUserId: null,
          },
        ],
        statusBefore: new Map(),
        acceptedDeliveries: new Map([[courierId, new Set([deliveryId])]]),
        events: [
          {
            id: 'ev-accept',
            deliveryId,
            type: EnumDeliveryEventType.ACCEPTED,
            oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
            courierId,
            occurredAt: tAccept,
            createdAt: tAccept,
          },
          {
            id: 'ev-step-in',
            deliveryId,
            type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
            oldStatus: EnumDeliveryStatus.ACCEPTED,
            courierId: null,
            occurredAt: tStepInside,
            createdAt: tStepInside,
          },
          {
            id: 'ev-drop',
            deliveryId,
            type: EnumDeliveryEventType.DROPPED_OFF,
            oldStatus: EnumDeliveryStatus.ON_THE_WAY,
            courierId,
            occurredAt: tDropOff,
            createdAt: tDropOff,
          },
        ],
        deliveries: [
          {
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
          },
        ],
        compensations: comps,
        everAccepted: new Set([deliveryId]),
      })

      mockTimeWorkedRepository.findDeliveryPay.mockResolvedValue({
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
      })

      const allTimelineEvents = [
        {
          id: 'ev-other-accept',
          deliveryId,
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          actor: EnumEventActor.COURIER,
          courierId: otherCourierId,
          occurredAt: tOtherAccept,
          createdAt: tOtherAccept,
        },
        {
          id: 'ev-other-handback',
          deliveryId,
          type: EnumDeliveryEventType.HANDED_BACK,
          oldStatus: EnumDeliveryStatus.ACCEPTED,
          actor: EnumEventActor.COURIER,
          courierId: otherCourierId,
          occurredAt: tOtherHandBack,
          createdAt: tOtherHandBack,
        },
        {
          id: 'ev-my-accept',
          deliveryId,
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          actor: EnumEventActor.COURIER,
          courierId,
          occurredAt: tAccept,
          createdAt: tAccept,
        },
        {
          id: 'ev-my-step-inside',
          deliveryId,
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          oldStatus: EnumDeliveryStatus.ACCEPTED,
          actor: EnumEventActor.COURIER,
          courierId: null, // step event carrying courierId null inside hold
          occurredAt: tStepInside,
          createdAt: tStepInside,
        },
        {
          id: 'ev-my-dropoff',
          deliveryId,
          type: EnumDeliveryEventType.DROPPED_OFF,
          oldStatus: EnumDeliveryStatus.ON_THE_WAY,
          actor: EnumEventActor.COURIER,
          courierId,
          occurredAt: tDropOff,
          createdAt: tDropOff,
        },
        {
          id: 'ev-step-after',
          deliveryId,
          type: EnumDeliveryEventType.ARRIVED_AT_DROPOFF_LOCATION,
          oldStatus: EnumDeliveryStatus.ON_THE_WAY,
          actor: EnumEventActor.COURIER,
          courierId: null, // step event received after hold ended
          occurredAt: tStepAfter,
          createdAt: tStepAfter,
        },
      ]
      mockTimeWorkedRepository.findTimelineEvents.mockResolvedValue(allTimelineEvents)

      const testNow = new Date('2026-11-20T14:00:00Z')
      const result = await service.deliveryDetail(courierId, deliveryId, testNow)

      // 1. Step event carrying courierId null inside hold -> who 'YOU'
      const stepInsideLine = result.timeline.find(
        (l) => l.type === EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION
      )
      expect(stepInsideLine).toBeDefined()
      expect(stepInsideLine!.who).toBe(EnumTimelineWho.YOU)
      expect(stepInsideLine!.anotherRider).toBe(false)

      // 2. Step event received after hold ended -> absent
      const stepAfterLine = result.timeline.find(
        (l) => l.type === EnumDeliveryEventType.ARRIVED_AT_DROPOFF_LOCATION
      )
      expect(stepAfterLine).toBeUndefined()

      // 3. Another rider's ACCEPTED -> one line with who null and anotherRider true, and that rider's id appears nowhere
      const otherAcceptLine = result.timeline.find(
        (l) => l.type === EnumDeliveryEventType.ACCEPTED && l.anotherRider === true
      )
      expect(otherAcceptLine).toBeDefined()
      expect(otherAcceptLine!.who).toBeNull()
      expect(otherAcceptLine!.anotherRider).toBe(true)
      expect(JSON.stringify(result)).not.toContain(otherCourierId)

      // 4. Compensation written after rider's shift ended (addedLater true) and one while open (addedLater false)
      expect(result.breakdown.compensations).toHaveLength(2)
      const openComp = result.breakdown.compensations.find(
        (c) => c.reason === EnumCourierCompensationReason.WAITING
      )
      expect(openComp).toBeDefined()
      expect(openComp!.addedLater).toBe(false)

      const laterComp = result.breakdown.compensations.find(
        (c) => c.reason === EnumCourierCompensationReason.REVIEW
      )
      expect(laterComp).toBeDefined()
      expect(laterComp!.addedLater).toBe(true)
    })
  })

  describe('AC-5, AC-15, review minor 3 - Week figures across month boundary and at reach', () => {
    test('two adjacent months with a shared week crossing month boundary return equal figures for the shared week', async () => {
      const now = new Date('2026-11-20T10:00:00Z') // Athens: 2026-11-20 (EET)

      // Month boundary: October 2026 into November 2026.
      // Shared week: Monday 2026-10-26 to Sunday 2026-11-01 (weekStart: '2026-10-26').
      // Oct 30 is Friday (Athens EET, UTC+2); Nov 1 is Sunday (Athens EET, UTC+2).

      // Oct 30: Shift 08:00 to 12:00 Athens (06:00 to 10:00 UTC) = 4h = 14400s
      const shiftOctStart = new Date('2026-10-30T06:00:00Z')
      const shiftOctEnd = new Date('2026-10-30T10:00:00Z')
      // Job A on Oct 30:
      const tAcceptA = new Date('2026-10-30T06:30:00Z')
      const tArriveA = new Date('2026-10-30T06:35:00Z')
      const tPickupA = new Date('2026-10-30T06:45:00Z') // wait: 10m = 600s
      const tDropA = new Date('2026-10-30T07:00:00Z')

      // Nov 1: Shift 10:00 to 14:00 Athens (08:00 to 12:00 UTC) = 4h = 14400s
      const shiftNovStart = new Date('2026-11-01T08:00:00Z')
      const shiftNovEnd = new Date('2026-11-01T12:00:00Z')
      // Job B on Nov 1:
      const tAcceptB = new Date('2026-11-01T08:30:00Z')
      const tArriveB = new Date('2026-11-01T08:35:00Z')
      const tPickupB = new Date('2026-11-01T08:55:00Z') // wait: 20m = 1200s
      const tDropB = new Date('2026-11-01T09:15:00Z')

      const allStatusChanges = [
        {
          id: 'sc-oct-1',
          courierId,
          createdAt: shiftOctStart,
          fromStatus: EnumCourierStatus.OFFLINE,
          toStatus: EnumCourierStatus.ONLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
        {
          id: 'sc-oct-2',
          courierId,
          createdAt: shiftOctEnd,
          fromStatus: EnumCourierStatus.ONLINE,
          toStatus: EnumCourierStatus.OFFLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
        {
          id: 'sc-nov-1',
          courierId,
          createdAt: shiftNovStart,
          fromStatus: EnumCourierStatus.OFFLINE,
          toStatus: EnumCourierStatus.ONLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
        {
          id: 'sc-nov-2',
          courierId,
          createdAt: shiftNovEnd,
          fromStatus: EnumCourierStatus.ONLINE,
          toStatus: EnumCourierStatus.OFFLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
      ]

      const allEvents = [
        {
          id: 'ev-a-1',
          deliveryId: 'del-oct-a',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId,
          occurredAt: tAcceptA,
          createdAt: tAcceptA,
        },
        {
          id: 'ev-a-2',
          deliveryId: 'del-oct-a',
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          oldStatus: EnumDeliveryStatus.ACCEPTED,
          courierId,
          occurredAt: tArriveA,
          createdAt: tArriveA,
        },
        {
          id: 'ev-a-3',
          deliveryId: 'del-oct-a',
          type: EnumDeliveryEventType.PICKED_UP,
          oldStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
          courierId,
          occurredAt: tPickupA,
          createdAt: tPickupA,
        },
        {
          id: 'ev-a-4',
          deliveryId: 'del-oct-a',
          type: EnumDeliveryEventType.DROPPED_OFF,
          oldStatus: EnumDeliveryStatus.ON_THE_WAY,
          courierId,
          occurredAt: tDropA,
          createdAt: tDropA,
        },
        {
          id: 'ev-b-1',
          deliveryId: 'del-nov-b',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId,
          occurredAt: tAcceptB,
          createdAt: tAcceptB,
        },
        {
          id: 'ev-b-2',
          deliveryId: 'del-nov-b',
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          oldStatus: EnumDeliveryStatus.ACCEPTED,
          courierId,
          occurredAt: tArriveB,
          createdAt: tArriveB,
        },
        {
          id: 'ev-b-3',
          deliveryId: 'del-nov-b',
          type: EnumDeliveryEventType.PICKED_UP,
          oldStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
          courierId,
          occurredAt: tPickupB,
          createdAt: tPickupB,
        },
        {
          id: 'ev-b-4',
          deliveryId: 'del-nov-b',
          type: EnumDeliveryEventType.DROPPED_OFF,
          oldStatus: EnumDeliveryStatus.ON_THE_WAY,
          courierId,
          occurredAt: tDropB,
          createdAt: tDropB,
        },
      ]

      const allDeliveries = [
        {
          id: 'del-oct-a',
          status: EnumDeliveryStatus.DROPPED_OFF,
          courierId,
          totalCompensation: 400,
          tips: 0,
          pickupName: 'Taverna Oct',
          baseFee: 200,
          distanceFee: 200,
          paidKm: 2.0,
          dropoffArea: 'Area Oct',
        },
        {
          id: 'del-nov-b',
          status: EnumDeliveryStatus.DROPPED_OFF,
          courierId,
          totalCompensation: 600,
          tips: 0,
          pickupName: 'Taverna Nov',
          baseFee: 300,
          distanceFee: 300,
          paidKm: 3.0,
          dropoffArea: 'Area Nov',
        },
      ]

      mockTimeWorkedRepository.findRecords.mockImplementation(({ rangeStart, rangeEnd }: any) => {
        const rStart = rangeStart.getTime()
        const rEnd = rangeEnd.getTime()
        const scs = allStatusChanges.filter(
          (sc) => sc.createdAt.getTime() >= rStart && sc.createdAt.getTime() < rEnd
        )
        const evs = allEvents.filter(
          (ev) => ev.createdAt.getTime() >= rStart && ev.createdAt.getTime() < rEnd
        )
        const delIds = new Set(evs.map((e) => e.deliveryId))
        const dels = allDeliveries.filter((d) => delIds.has(d.id))
        return Promise.resolve({
          statusChanges: scs,
          statusBefore: new Map(),
          acceptedDeliveries: new Map([[courierId, delIds]]),
          events: evs,
          deliveries: dels,
          compensations: [],
          everAccepted: delIds,
        })
      })

      const octResult = await service.riderMonth(courierId, '2026-10', now)
      const novResult = await service.riderMonth(courierId, '2026-11', now)

      const octSharedWeek = octResult.weeks.find((w) => w.weekStart === '2026-10-26')
      const novSharedWeek = novResult.weeks.find((w) => w.weekStart === '2026-10-26')

      expect(octSharedWeek).toBeDefined()
      expect(novSharedWeek).toBeDefined()

      // AC-5, AC-15, review minor 3: all figures for the shared week are equal in both answers
      expect(octSharedWeek!.moneyCents).toBe(novSharedWeek!.moneyCents)
      expect(octSharedWeek!.workSeconds).toBe(novSharedWeek!.workSeconds)
      expect(octSharedWeek!.centsPerHour).toBe(novSharedWeek!.centsPerHour)
      expect(octSharedWeek!.medianPickupWaitSeconds).toBe(novSharedWeek!.medianPickupWaitSeconds)
      expect(octSharedWeek!.pickupWaitCount).toBe(novSharedWeek!.pickupWaitCount)
      expect(octSharedWeek!.dropOffCount).toBe(novSharedWeek!.dropOffCount)

      // Expected values for the combined week:
      expect(octSharedWeek!.moneyCents).toBe(1000)
      expect(octSharedWeek!.workSeconds).toBe(28800)
      expect(octSharedWeek!.centsPerHour).toBe(125)
      expect(octSharedWeek!.medianPickupWaitSeconds).toBe(900)
      expect(octSharedWeek!.pickupWaitCount).toBe(2)
      expect(octSharedWeek!.dropOffCount).toBe(2)
    })

    test('week holding reachFrom excludes job accepted before reachFrom for rider, while admin answer includes it', async () => {
      const now = new Date('2026-11-20T10:00:00Z') // Athens: 2026-11-20, reachFrom: 2026-09-20
      // Week of reachFrom: Monday 2026-09-14 to Sunday 2026-09-20 (weekStart: '2026-09-14')

      // Job 1: Friday 2026-09-18 (before reachFrom 2026-09-20)
      // 09:00 to 12:00 Athens (06:00 to 09:00 UTC)
      const shift1Start = new Date('2026-09-18T06:00:00Z')
      const shift1End = new Date('2026-09-18T09:00:00Z')
      const tAccept1 = new Date('2026-09-18T07:00:00Z')
      const tDrop1 = new Date('2026-09-18T07:30:00Z')

      // Job 2: Sunday 2026-09-20 (on reachFrom 2026-09-20)
      // 09:00 to 12:00 Athens (06:00 to 09:00 UTC)
      const shift2Start = new Date('2026-09-20T06:00:00Z')
      const shift2End = new Date('2026-09-20T09:00:00Z')
      const tAccept2 = new Date('2026-09-20T07:00:00Z')
      const tDrop2 = new Date('2026-09-20T07:30:00Z')

      const allStatusChanges = [
        {
          id: 'sc-reach-1',
          courierId,
          createdAt: shift1Start,
          fromStatus: EnumCourierStatus.OFFLINE,
          toStatus: EnumCourierStatus.ONLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
        {
          id: 'sc-reach-2',
          courierId,
          createdAt: shift1End,
          fromStatus: EnumCourierStatus.ONLINE,
          toStatus: EnumCourierStatus.OFFLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
        {
          id: 'sc-reach-3',
          courierId,
          createdAt: shift2Start,
          fromStatus: EnumCourierStatus.OFFLINE,
          toStatus: EnumCourierStatus.ONLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
        {
          id: 'sc-reach-4',
          courierId,
          createdAt: shift2End,
          fromStatus: EnumCourierStatus.ONLINE,
          toStatus: EnumCourierStatus.OFFLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
      ]

      const allEvents = [
        {
          id: 'ev-reach-1',
          deliveryId: 'del-before-reach',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId,
          occurredAt: tAccept1,
          createdAt: tAccept1,
        },
        {
          id: 'ev-reach-2',
          deliveryId: 'del-before-reach',
          type: EnumDeliveryEventType.DROPPED_OFF,
          oldStatus: EnumDeliveryStatus.ON_THE_WAY,
          courierId,
          occurredAt: tDrop1,
          createdAt: tDrop1,
        },
        {
          id: 'ev-reach-3',
          deliveryId: 'del-on-reach',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId,
          occurredAt: tAccept2,
          createdAt: tAccept2,
        },
        {
          id: 'ev-reach-4',
          deliveryId: 'del-on-reach',
          type: EnumDeliveryEventType.DROPPED_OFF,
          oldStatus: EnumDeliveryStatus.ON_THE_WAY,
          courierId,
          occurredAt: tDrop2,
          createdAt: tDrop2,
        },
      ]

      const allDeliveries = [
        {
          id: 'del-before-reach',
          status: EnumDeliveryStatus.DROPPED_OFF,
          courierId,
          totalCompensation: 500,
          tips: 0,
          pickupName: 'Taverna Before',
          baseFee: 200,
          distanceFee: 300,
          paidKm: 2.0,
          dropoffArea: 'Area 1',
        },
        {
          id: 'del-on-reach',
          status: EnumDeliveryStatus.DROPPED_OFF,
          courierId,
          totalCompensation: 700,
          tips: 0,
          pickupName: 'Taverna Reach',
          baseFee: 300,
          distanceFee: 400,
          paidKm: 3.0,
          dropoffArea: 'Area 2',
        },
      ]

      mockTimeWorkedRepository.findRecords.mockImplementation(({ rangeStart, rangeEnd }: any) => {
        const rStart = rangeStart.getTime()
        const rEnd = rangeEnd.getTime()
        const scs = allStatusChanges.filter(
          (sc) => sc.createdAt.getTime() >= rStart && sc.createdAt.getTime() < rEnd
        )
        const evs = allEvents.filter(
          (ev) => ev.createdAt.getTime() >= rStart && ev.createdAt.getTime() < rEnd
        )
        const delIds = new Set(evs.map((e) => e.deliveryId))
        const dels = allDeliveries.filter((d) => delIds.has(d.id))
        return Promise.resolve({
          statusChanges: scs,
          statusBefore: new Map(),
          acceptedDeliveries: new Map([[courierId, delIds]]),
          events: evs,
          deliveries: dels,
          compensations: [],
          everAccepted: delIds,
        })
      })

      // Rider request for September 2026: reachFrom is 2026-09-20
      const riderResult = await service.riderMonth(courierId, '2026-09', now)
      const riderWeek = riderResult.weeks.find((w) => w.weekStart === '2026-09-14')
      expect(riderWeek).toBeDefined()
      expect(riderWeek!.cutAtReach).toBe(true)
      // Rider only sees Job 2 (accepted on 2026-09-20)
      expect(riderWeek!.dropOffCount).toBe(1)
      expect(riderWeek!.moneyCents).toBe(700)

      // Admin request for that same week with reachFrom: null
      const adminResult = await service.earnings(
        courierId,
        { from: '2026-09-14', to: '2026-09-20', reachFrom: null },
        { withAdminLabels: true },
        now
      )
      const adminWeek = adminResult.weeks.find((w) => w.weekStart === '2026-09-14')
      expect(adminWeek).toBeDefined()
      expect(adminWeek!.cutAtReach).toBe(false)
      // Admin sees both Job 1 (accepted on 2026-09-18) and Job 2 (accepted on 2026-09-20)
      expect(adminWeek!.dropOffCount).toBe(2)
      expect(adminWeek!.moneyCents).toBe(1200)
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
