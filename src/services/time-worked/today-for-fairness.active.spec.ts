import { EnumCourierStatus, EnumCourierStatusChangeCause, EnumDeliveryEventType } from '@prisma/types'
import { TimeWorkedService } from './time-worked.service'
import { TimeWorkedRecords } from 'src/persistence/repositories/time-worked.repository'

describe('TimeWorkedService.todayForFairness (Spec 0044: AC-2, AC-3, cross check 1)', () => {
  const courierId = 'courier-fairness-1'
  const shiftBreakMinutes = 30
  const currencyCode = 'EUR'

  const mockConfigDomainService = {
    instanceConfig: {
      getShiftBreakMinutes: jest.fn().mockResolvedValue(shiftBreakMinutes),
      getCurrency: jest.fn().mockResolvedValue(currencyCode),
    },
  }

  const createEmptyRecords = (overrides: Partial<TimeWorkedRecords> = {}): TimeWorkedRecords => ({
    statusChanges: [],
    statusBefore: new Map(),
    acceptedDeliveries: new Map(),
    events: [],
    deliveries: [],
    compensations: [],
    everAccepted: new Set(),
    ...overrides,
  })

  test('tips do not count in centsPerHour: delivery with tips gives same rate as delivery without tips', async () => {
    // 2026-11-21 14:00 Athens time (UTC+2)
    const now = new Date('2026-11-21T12:00:00Z')

    // Courier was online 10:00 to 14:00 (4 hours = 14400s)
    const statusChanges = [
      {
        id: 'sc-1',
        courierId,
        createdAt: new Date('2026-11-21T08:00:00Z'), // 10:00 Athens
        fromStatus: EnumCourierStatus.OFFLINE,
        toStatus: EnumCourierStatus.ONLINE,
        cause: EnumCourierStatusChangeCause.RIDER,
        adminUserId: null,
      },
    ]

    const acceptedEvent = {
      id: 'evt-acc',
      deliveryId: 'del-1',
      courierId,
      type: EnumDeliveryEventType.ACCEPTED,
      occurredAt: new Date('2026-11-21T08:30:00Z'),
      createdAt: new Date('2026-11-21T08:30:00Z'),
    }

    const deliveredEvent = {
      id: 'evt-del',
      deliveryId: 'del-1',
      courierId,
      type: EnumDeliveryEventType.DROPPED_OFF,
      occurredAt: new Date('2026-11-21T09:00:00Z'),
      createdAt: new Date('2026-11-21T09:00:00Z'),
    }

    // Delivery with baseFee + distanceFee = 400 cents, plus 500 cents tip
    const recordsWithTips = createEmptyRecords({
      statusChanges,
      acceptedDeliveries: new Map([[courierId, new Set(['del-1'])]]),
      events: [acceptedEvent as any, deliveredEvent as any],
      deliveries: [
        {
          id: 'del-1',
          totalCompensation: 400,
          currencyCode: 'EUR',
          tips: 500, // Should be zeroed out in todayForFairness
          boxUnits: 50,
          deliveredAt: new Date('2026-11-21T09:00:00Z'),
          orderReference: null,
          pickupBusinessName: 'Restaurant',
          dropoffLocation: null,
        } as any,
      ],
    })

    const mockRepo = {
      findRecordedFrom: jest.fn().mockResolvedValue(new Date('2026-01-01T00:00:00Z')),
      findRecords: jest.fn().mockResolvedValue(recordsWithTips),
    }

    const service = new TimeWorkedService(mockRepo as any, mockConfigDomainService as any)
    const figures = await service.todayForFairness(now)
    const riderFigure = figures.get(courierId)

    expect(riderFigure).toBeDefined()
    // 400 cents over 4 hours (14400s) = 100 cents/hour.
    // If tips were included (900 cents), centsPerHour would be 225.
    expect(riderFigure!.centsPerHour).toBe(100)
  })

  test('lastJobEndAt is the newest job end today, and ignores jobs ending before today', async () => {
    const now = new Date('2026-11-21T12:00:00Z')

    const statusChanges = [
      {
        id: 'sc-1',
        courierId,
        createdAt: new Date('2026-11-21T06:00:00Z'), // 08:00 Athens
        fromStatus: EnumCourierStatus.OFFLINE,
        toStatus: EnumCourierStatus.ONLINE,
        cause: EnumCourierStatusChangeCause.RIDER,
        adminUserId: null,
      },
    ]

    const job1End = new Date('2026-11-21T07:30:00Z') // 09:30 Athens
    const job2End = new Date('2026-11-21T09:45:00Z') // 11:45 Athens (newest today)

    const records = createEmptyRecords({
      statusChanges,
      acceptedDeliveries: new Map([[courierId, new Set(['del-1', 'del-2'])]]),
      events: [
        {
          id: 'e1',
          deliveryId: 'del-1',
          courierId,
          type: EnumDeliveryEventType.ACCEPTED,
          occurredAt: new Date('2026-11-21T07:00:00Z'),
          createdAt: new Date('2026-11-21T07:00:00Z'),
        },
        {
          id: 'e2',
          deliveryId: 'del-1',
          courierId,
          type: EnumDeliveryEventType.DROPPED_OFF,
          occurredAt: job1End,
          createdAt: job1End,
        },
        {
          id: 'e3',
          deliveryId: 'del-2',
          courierId,
          type: EnumDeliveryEventType.ACCEPTED,
          occurredAt: new Date('2026-11-21T09:15:00Z'),
          createdAt: new Date('2026-11-21T09:15:00Z'),
        },
        {
          id: 'e4',
          deliveryId: 'del-2',
          courierId,
          type: EnumDeliveryEventType.DROPPED_OFF,
          occurredAt: job2End,
          createdAt: job2End,
        },
      ] as any,
      deliveries: [
        {
          id: 'del-1',
          totalCompensation: 300,
          currencyCode: 'EUR',
          tips: 0,
          deliveredAt: job1End,
        } as any,
        {
          id: 'del-2',
          totalCompensation: 350,
          currencyCode: 'EUR',
          tips: 0,
          deliveredAt: job2End,
        } as any,
      ],
    })

    const mockRepo = {
      findRecordedFrom: jest.fn().mockResolvedValue(new Date('2026-01-01T00:00:00Z')),
      findRecords: jest.fn().mockResolvedValue(records),
    }

    const service = new TimeWorkedService(mockRepo as any, mockConfigDomainService as any)
    const figures = await service.todayForFairness(now)
    const riderFigure = figures.get(courierId)

    expect(riderFigure).toBeDefined()
    expect(riderFigure!.lastJobEndAt).toEqual(job2End)
  })

  test('onlineSpellStartAt is the newest move to ONLINE from OFFLINE and LAST_CALL continues it', async () => {
    const now = new Date('2026-11-21T12:00:00Z')

    // Shift 1: Offline -> Online at 06:00, then Online -> Offline at 08:00
    // Shift 2: Offline -> Online at 09:30, then Online -> Last Call at 11:30
    const spell2Start = new Date('2026-11-21T09:30:00Z')

    const statusChanges = [
      {
        id: 'sc-1',
        courierId,
        createdAt: new Date('2026-11-21T06:00:00Z'),
        fromStatus: EnumCourierStatus.OFFLINE,
        toStatus: EnumCourierStatus.ONLINE,
        cause: EnumCourierStatusChangeCause.RIDER,
        adminUserId: null,
      },
      {
        id: 'sc-2',
        courierId,
        createdAt: new Date('2026-11-21T08:00:00Z'),
        fromStatus: EnumCourierStatus.ONLINE,
        toStatus: EnumCourierStatus.OFFLINE,
        cause: EnumCourierStatusChangeCause.RIDER,
        adminUserId: null,
      },
      {
        id: 'sc-3',
        courierId,
        createdAt: spell2Start,
        fromStatus: EnumCourierStatus.OFFLINE,
        toStatus: EnumCourierStatus.ONLINE,
        cause: EnumCourierStatusChangeCause.RIDER,
        adminUserId: null,
      },
      {
        id: 'sc-4',
        courierId,
        createdAt: new Date('2026-11-21T11:30:00Z'),
        fromStatus: EnumCourierStatus.ONLINE,
        toStatus: EnumCourierStatus.LAST_CALL,
        cause: EnumCourierStatusChangeCause.RIDER,
        adminUserId: null,
      },
    ]

    const records = createEmptyRecords({
      statusChanges,
    })

    const mockRepo = {
      findRecordedFrom: jest.fn().mockResolvedValue(new Date('2026-01-01T00:00:00Z')),
      findRecords: jest.fn().mockResolvedValue(records),
    }

    const service = new TimeWorkedService(mockRepo as any, mockConfigDomainService as any)
    const figures = await service.todayForFairness(now)
    const riderFigure = figures.get(courierId)

    expect(riderFigure).toBeDefined()
    // The spell start must be 09:30:00Z (the second move from OFFLINE to ONLINE), NOT 06:00 and NOT 11:30
    expect(riderFigure!.onlineSpellStartAt).toEqual(spell2Start)
  })

  test('a job that ended yesterday at 23:55 is the rider lastJobEndAt at 00:10 today (waiting is not cut at midnight), while centsPerHour still counts today only', async () => {
    // In Europe/Athens (UTC+2 in Nov), today 00:10 is 2026-11-20 22:10:00Z.
    // Yesterday 23:55 is 2026-11-20 21:55:00Z.
    const now = new Date('2026-11-20T22:10:00Z')
    const jobEndYesterday = new Date('2026-11-20T21:55:00Z')

    const statusChanges = [
      {
        id: 'sc-yesterday',
        courierId,
        createdAt: new Date('2026-11-20T20:00:00Z'),
        fromStatus: EnumCourierStatus.OFFLINE,
        toStatus: EnumCourierStatus.ONLINE,
        cause: EnumCourierStatusChangeCause.RIDER,
        adminUserId: null,
      },
    ]

    const records = createEmptyRecords({
      statusChanges,
      acceptedDeliveries: new Map([[courierId, new Set(['del-yesterday'])]]),
      events: [
        {
          id: 'e-acc',
          deliveryId: 'del-yesterday',
          courierId,
          type: EnumDeliveryEventType.ACCEPTED,
          occurredAt: new Date('2026-11-20T21:00:00Z'),
          createdAt: new Date('2026-11-20T21:00:00Z'),
        },
        {
          id: 'e-drop',
          deliveryId: 'del-yesterday',
          courierId,
          type: EnumDeliveryEventType.DROPPED_OFF,
          occurredAt: jobEndYesterday,
          createdAt: jobEndYesterday,
        },
      ] as any,
      deliveries: [
        {
          id: 'del-yesterday',
          totalCompensation: 500,
          currencyCode: 'EUR',
          tips: 0,
          deliveredAt: jobEndYesterday,
        } as any,
      ],
    })

    const mockRepo = {
      findRecordedFrom: jest.fn().mockResolvedValue(new Date('2026-01-01T00:00:00Z')),
      findRecords: jest.fn().mockResolvedValue(records),
    }

    const service = new TimeWorkedService(mockRepo as any, mockConfigDomainService as any)
    const figures = await service.todayForFairness(now)
    const riderFigure = figures.get(courierId)

    expect(riderFigure).toBeDefined()
    // Waiting is not cut at midnight: lastJobEndAt is yesterday's 23:55 Athens time
    expect(riderFigure!.lastJobEndAt).toEqual(jobEndYesterday)
    // centsPerHour counts today only: 0 money earned on jobs accepted today (null or 0 rate)
    expect(riderFigure!.centsPerHour).toBe(0)
  })

  test('a move from OFFLINE to LAST_CALL starts a spell', async () => {
    const now = new Date('2026-11-21T12:00:00Z')
    const lastCallStart = new Date('2026-11-21T10:00:00Z')

    const statusChanges = [
      {
        id: 'sc-last-call',
        courierId,
        createdAt: lastCallStart,
        fromStatus: EnumCourierStatus.OFFLINE,
        toStatus: EnumCourierStatus.LAST_CALL,
        cause: EnumCourierStatusChangeCause.RIDER,
        adminUserId: null,
      },
    ]

    const records = createEmptyRecords({
      statusChanges,
    })

    const mockRepo = {
      findRecordedFrom: jest.fn().mockResolvedValue(new Date('2026-01-01T00:00:00Z')),
      findRecords: jest.fn().mockResolvedValue(records),
    }

    const service = new TimeWorkedService(mockRepo as any, mockConfigDomainService as any)
    const figures = await service.todayForFairness(now)
    const riderFigure = figures.get(courierId)

    expect(riderFigure).toBeDefined()
    // Moving straight from OFFLINE to LAST_CALL must record onlineSpellStartAt
    expect(riderFigure!.onlineSpellStartAt).toEqual(lastCallStart)
  })

  test('a rider Online since before the look back (no move recorded) has onlineSpellStartAt equal to today Athens start, never earlier', async () => {
    // 14:00 Athens time on 2026-11-21 -> todayStart in Athens is 2026-11-20 22:00:00Z
    const now = new Date('2026-11-21T12:00:00Z')
    const todayAthensStart = new Date('2026-11-20T22:00:00Z')

    // Courier was already Online before the look-back window, with no status changes in the window
    const records = createEmptyRecords({
      statusBefore: new Map([[courierId, EnumCourierStatus.ONLINE]]),
      statusChanges: [],
    })

    const mockRepo = {
      findRecordedFrom: jest.fn().mockResolvedValue(new Date('2026-01-01T00:00:00Z')),
      findRecords: jest.fn().mockResolvedValue(records),
    }

    const service = new TimeWorkedService(mockRepo as any, mockConfigDomainService as any)
    const figures = await service.todayForFairness(now)
    const riderFigure = figures.get(courierId)

    expect(riderFigure).toBeDefined()
    // onlineSpellStartAt must equal today's Athens start, never earlier (never window.windowStart from yesterday)
    expect(riderFigure!.onlineSpellStartAt).toEqual(todayAthensStart)
  })
})
