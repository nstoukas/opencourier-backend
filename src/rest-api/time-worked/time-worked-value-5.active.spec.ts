import { CourierAdminDto } from 'src/rest-api/courier/admin/dtos/courier.admin.dto'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import {
  EnumCourierCompensationReason,
  EnumCourierDeliverySetting,
  EnumCourierStatus,
  EnumCourierStatusChangeCause,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
} from '@prisma/types'
import {
  COOP_TOTALS_MIN_RIDERS,
  DayRange,
  TimeWorkedService,
  TotalsRow,
} from 'src/services/time-worked/time-worked.service'
import {
  CurrentShiftDto,
  TimeWorkedTotalsRowDto,
  toCurrentShiftDto,
  toShiftDto,
  toTotalsRowDto,
} from './time-worked.dto'
import { WorkedShift } from 'src/domains/time-worked/worked-shifts'
import { TimeWorkedAdminRestApiController } from './admin/time-worked.admin.rest-api.controller'
import { TimeWorkedRecords } from 'src/persistence/repositories/time-worked.repository'

describe('Value 5 Guards (spec 0040, AC-12, AC-14, AC-16)', () => {
  const FORBIDDEN_COURIER_ADMIN_KEYS = [
    'workSeconds',
    'jobSeconds',
    'paidWaitSeconds',
    'unpaidSeconds',
    'moneyCents',
    'centsPerHour',
    'shifts',
    'statusChanges',
  ]

  const EXPECTED_TOTALS_KEYS = [
    'centsPerHour',
    'jobSeconds',
    'moneyCents',
    'paidWaitSeconds',
    'period',
    'riderCount',
    'unlinkedMoneyCents',
    'unpaidSeconds',
    'workSeconds',
  ]

  test('CourierAdminDto has none of the AC-16 forbidden keys (Object.keys and class prototype)', () => {
    const courier = new CourierEntity({
      id: 'c-admin-test-1',
      node_uri: null,
      firstName: 'Kostas',
      lastName: 'Papadopoulos',
      phoneNumber: '+306911111111',
      status: EnumCourierStatus.ONLINE,
      deliverySetting: EnumCourierDeliverySetting.AUTO_ACCEPT,
      userId: 'user-c-1',
      createdAt: new Date('2026-01-01T10:00:00Z'),
    } as any)

    const dto = new CourierAdminDto(courier)
    const instanceKeys = Object.keys(dto)
    const prototypeKeys = Object.getOwnPropertyNames(CourierAdminDto.prototype)

    for (const key of FORBIDDEN_COURIER_ADMIN_KEYS) {
      expect(instanceKeys).not.toContain(key)
      expect(prototypeKeys).not.toContain(key)
      expect((dto as any)[key]).toBeUndefined()
    }
  })

  test('TimeWorkedService.totals and coopWeeks results carry no rider id anywhere and each totals row has exactly the nine allowed keys', async () => {
    const knownRiderIds = ['rider-alpha', 'rider-beta', 'rider-gamma']

    const mockRecords: TimeWorkedRecords = {
      // Status changes for all three riders
      statusChanges: [
        // rider-alpha: 08:00 to 10:00 (2h work)
        {
          id: 'sc-alpha-1',
          courierId: 'rider-alpha',
          createdAt: new Date('2026-11-19T08:00:00+02:00'),
          fromStatus: EnumCourierStatus.OFFLINE,
          toStatus: EnumCourierStatus.ONLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
        {
          id: 'sc-alpha-2',
          courierId: 'rider-alpha',
          createdAt: new Date('2026-11-19T10:00:00+02:00'),
          fromStatus: EnumCourierStatus.ONLINE,
          toStatus: EnumCourierStatus.OFFLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
        // rider-beta: 08:30 to 11:00 (2.5h work), with accepted delivery
        {
          id: 'sc-beta-1',
          courierId: 'rider-beta',
          createdAt: new Date('2026-11-19T08:30:00+02:00'),
          fromStatus: EnumCourierStatus.OFFLINE,
          toStatus: EnumCourierStatus.ONLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
        {
          id: 'sc-beta-2',
          courierId: 'rider-beta',
          createdAt: new Date('2026-11-19T11:00:00+02:00'),
          fromStatus: EnumCourierStatus.ONLINE,
          toStatus: EnumCourierStatus.OFFLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
        // rider-gamma: 09:00 to 10:30 (1.5h work), with manual compensation
        {
          id: 'sc-gamma-1',
          courierId: 'rider-gamma',
          createdAt: new Date('2026-11-19T09:00:00+02:00'),
          fromStatus: EnumCourierStatus.OFFLINE,
          toStatus: EnumCourierStatus.ONLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
        {
          id: 'sc-gamma-2',
          courierId: 'rider-gamma',
          createdAt: new Date('2026-11-19T10:30:00+02:00'),
          fromStatus: EnumCourierStatus.ONLINE,
          toStatus: EnumCourierStatus.OFFLINE,
          cause: EnumCourierStatusChangeCause.RIDER,
          adminUserId: null,
        },
      ],
      statusBefore: new Map(),
      // rider-beta accepted del-beta-1
      acceptedDeliveries: new Map([['rider-beta', new Set(['del-beta-1'])]]),
      events: [
        {
          id: 'ev-beta-1',
          deliveryId: 'del-beta-1',
          type: EnumDeliveryEventType.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId: 'rider-beta',
          occurredAt: new Date('2026-11-19T09:00:00+02:00'),
          createdAt: new Date('2026-11-19T09:00:00+02:00'),
        },
        {
          id: 'ev-beta-2',
          deliveryId: 'del-beta-1',
          type: EnumDeliveryEventType.DROPPED_OFF,
          oldStatus: EnumDeliveryStatus.ON_THE_WAY,
          courierId: 'rider-beta',
          occurredAt: new Date('2026-11-19T09:30:00+02:00'),
          createdAt: new Date('2026-11-19T09:30:00+02:00'),
        },
      ],
      deliveries: [
        {
          id: 'del-beta-1',
          status: EnumDeliveryStatus.DROPPED_OFF,
          courierId: 'rider-beta',
          totalCompensation: 800,
          tips: 200,
          pickupName: 'Bakery Beta',
        },
      ],
      // rider-gamma has compensation
      compensations: [
        {
          id: 'comp-gamma-1',
          courierId: 'rider-gamma',
          deliveryId: 'del-gamma-comp',
          amount: 500,
          currencyCode: 'EUR',
          reason: EnumCourierCompensationReason.REVIEW,
          waitMinutes: null,
          createdAt: new Date('2026-11-19T09:15:00+02:00'),
        },
      ],
      everAccepted: new Set(['rider-gamma:del-gamma-comp']),
    }

    const mockTimeWorkedRepository = {
      findRecordedFrom: jest.fn().mockResolvedValue(new Date('2026-01-01')),
      findRecords: jest.fn().mockResolvedValue(mockRecords),
    }

    const mockConfigDomainService = {
      instanceConfig: {
        getShiftBreakMinutes: jest.fn().mockResolvedValue(30),
        getCurrency: jest.fn().mockResolvedValue('EUR'),
      },
    }

    const service = new TimeWorkedService(
      mockTimeWorkedRepository as any,
      mockConfigDomainService as any
    )

    const now = new Date('2026-11-19T14:00:00+02:00')
    const dayRange: DayRange = {
      from: '2026-11-19',
      to: '2026-11-19',
      rangeStart: new Date('2026-11-19T00:00:00+02:00'),
      rangeEnd: new Date('2026-11-20T00:00:00+02:00'),
    }

    // 1a: Check totals by day
    const totalsDay = await service.totals(dayRange, 'day', now)
    const totalsDayJson = JSON.stringify(totalsDay)
    for (const riderId of knownRiderIds) {
      expect(totalsDayJson).not.toContain(riderId)
    }
    expect(totalsDay.rows.length).toBeGreaterThan(0)
    for (const row of totalsDay.rows) {
      expect(Object.keys(row).sort()).toEqual(EXPECTED_TOTALS_KEYS)
    }

    // 1b: Check totals by week
    const totalsWeek = await service.totals(dayRange, 'week', now)
    const totalsWeekJson = JSON.stringify(totalsWeek)
    for (const riderId of knownRiderIds) {
      expect(totalsWeekJson).not.toContain(riderId)
    }
    expect(totalsWeek.rows.length).toBeGreaterThan(0)
    for (const row of totalsWeek.rows) {
      expect(Object.keys(row).sort()).toEqual(EXPECTED_TOTALS_KEYS)
    }

    // 1c: Check coopWeeks
    const coopWeeksResult = await service.coopWeeks(now)
    const coopWeeksJson = JSON.stringify(coopWeeksResult)
    for (const riderId of knownRiderIds) {
      expect(coopWeeksJson).not.toContain(riderId)
    }
  })

  test('toTotalsRowDto strips extra rider keys and its keys are exactly the nine allowed keys', () => {
    // Cast an object with extra rider keys to TotalsRow
    const rowWithExtraKeys = {
      period: '2026-11-19',
      riderCount: 3,
      workSeconds: 36000,
      jobSeconds: 24000,
      paidWaitSeconds: 2000,
      unpaidSeconds: 10000,
      moneyCents: 15000,
      unlinkedMoneyCents: 500,
      centsPerHour: 1450,
      courierId: 'rider-alpha',
      courierIds: ['rider-alpha', 'rider-beta'],
    } as unknown as TotalsRow

    const rowDto = toTotalsRowDto(rowWithExtraKeys)
    expect(Object.keys(rowDto).sort()).toEqual(EXPECTED_TOTALS_KEYS)
    expect((rowDto as any).courierId).toBeUndefined()
    expect((rowDto as any).courierIds).toBeUndefined()
    expect(JSON.stringify(rowDto)).not.toContain('rider-alpha')
    expect(JSON.stringify(rowDto)).not.toContain('rider-beta')
  })

  test("admin controller's totals route returns rows with none of the extra rider keys returned by service", async () => {
    const mockTimeWorkedService = {
      totals: jest.fn().mockResolvedValue({
        currencyCode: 'EUR',
        rows: [
          {
            period: '2026-11-19',
            riderCount: 2,
            workSeconds: 7200,
            jobSeconds: 5000,
            paidWaitSeconds: 500,
            unpaidSeconds: 1700,
            moneyCents: 3000,
            unlinkedMoneyCents: 0,
            centsPerHour: 1500,
            courierId: 'rider-alpha',
            courierIds: ['rider-alpha', 'rider-beta'],
          },
        ],
      }),
    }
    const mockCourierRepository = {}
    const controller = new TimeWorkedAdminRestApiController(
      mockTimeWorkedService as any,
      mockCourierRepository as any
    )

    const response = await controller.totals({
      from: '2026-11-19',
      to: '2026-11-19',
      by: 'day',
    })

    expect(response.rows).toHaveLength(1)
    const row = response.rows[0]!
    expect(Object.keys(row).sort()).toEqual(EXPECTED_TOTALS_KEYS)
    expect((row as any).courierId).toBeUndefined()
    expect((row as any).courierIds).toBeUndefined()
    expect(JSON.stringify(response)).not.toContain('rider-alpha')
    expect(JSON.stringify(response)).not.toContain('rider-beta')
  })

  test('coopWeeks returns { weekStart, tooFewRiders: true } and nothing else for a week with 2 riders, and full figures for 3', async () => {
    expect(COOP_TOTALS_MIN_RIDERS).toBe(3)

    const mockTimeWorkedRepository = {}
    const mockConfigDomainService = {
      instanceConfig: {
        getShiftBreakMinutes: jest.fn().mockResolvedValue(30),
        getCurrency: jest.fn().mockResolvedValue('EUR'),
      },
    }

    const service = new TimeWorkedService(
      mockTimeWorkedRepository as any,
      mockConfigDomainService as any
    )

    // Case 1: 2 riders (fewer than COOP_TOTALS_MIN_RIDERS)
    jest.spyOn(service, 'totals').mockResolvedValueOnce({
      currencyCode: 'EUR',
      rows: [
        {
          period: '2026-11-16', // thisWeek
          riderCount: 2,
          workSeconds: 7200,
          jobSeconds: 5000,
          paidWaitSeconds: 500,
          unpaidSeconds: 1700,
          moneyCents: 3000,
          unlinkedMoneyCents: 0,
          centsPerHour: 1500,
        },
        {
          period: '2026-11-09', // lastWeek
          riderCount: 3,
          workSeconds: 10800,
          jobSeconds: 7000,
          paidWaitSeconds: 1000,
          unpaidSeconds: 2800,
          moneyCents: 4500,
          unlinkedMoneyCents: 0,
          centsPerHour: 1500,
        },
      ],
    })

    const fixedNow = new Date('2026-11-19T12:00:00+02:00')
    const { thisWeek, lastWeek } = await service.coopWeeks(fixedNow)

    // With 2 riders: tooFewRiders true, carries NO figure at all (not even rider count or workSeconds)
    expect(thisWeek).toEqual({
      weekStart: '2026-11-16',
      tooFewRiders: true,
    })
    expect('workSeconds' in thisWeek).toBe(false)
    expect('unpaidShare' in thisWeek).toBe(false)
    expect('centsPerHour' in thisWeek).toBe(false)
    expect('riderCount' in thisWeek).toBe(false)

    // With 3 riders: full figures returned
    expect(lastWeek).toEqual({
      weekStart: '2026-11-09',
      tooFewRiders: false,
      workSeconds: 10800,
      unpaidShare: 2800 / 10800,
      centsPerHour: 1500,
    })
  })

  test('totals counts riderCount as distinct riders with work over 0 and an admin sees every row', async () => {
    const mockTimeWorkedRepository = {
      findRecordedFrom: jest.fn().mockResolvedValue(new Date('2026-01-01')),
      findRecords: jest.fn().mockResolvedValue({
        statusChanges: [
          // Rider 1 worked 1 hour (3600s)
          {
            id: 'sc-1',
            courierId: 'rider-1',
            createdAt: new Date('2026-11-19T08:00:00+02:00'),
            fromStatus: EnumCourierStatus.OFFLINE,
            toStatus: EnumCourierStatus.ONLINE,
            cause: EnumCourierStatusChangeCause.RIDER,
            adminUserId: null,
          },
          {
            id: 'sc-2',
            courierId: 'rider-1',
            createdAt: new Date('2026-11-19T09:00:00+02:00'),
            fromStatus: EnumCourierStatus.ONLINE,
            toStatus: EnumCourierStatus.OFFLINE,
            cause: EnumCourierStatusChangeCause.RIDER,
            adminUserId: null,
          },
          // Rider 2 had status change but 0 work time (online and offline at same timestamp)
          {
            id: 'sc-3',
            courierId: 'rider-2',
            createdAt: new Date('2026-11-19T10:00:00+02:00'),
            fromStatus: EnumCourierStatus.OFFLINE,
            toStatus: EnumCourierStatus.ONLINE,
            cause: EnumCourierStatusChangeCause.RIDER,
            adminUserId: null,
          },
          {
            id: 'sc-4',
            courierId: 'rider-2',
            createdAt: new Date('2026-11-19T10:00:00+02:00'),
            fromStatus: EnumCourierStatus.ONLINE,
            toStatus: EnumCourierStatus.OFFLINE,
            cause: EnumCourierStatusChangeCause.RIDER,
            adminUserId: null,
          },
        ],
        statusBefore: new Map(),
        acceptedDeliveries: new Map(),
        events: [],
        deliveries: [],
        compensations: [],
        everAccepted: new Set(),
      }),
    }
    const mockConfigDomainService = {
      instanceConfig: {
        getShiftBreakMinutes: jest.fn().mockResolvedValue(30),
        getCurrency: jest.fn().mockResolvedValue('EUR'),
      },
    }

    const service = new TimeWorkedService(
      mockTimeWorkedRepository as any,
      mockConfigDomainService as any
    )

    const range = {
      from: '2026-11-19',
      to: '2026-11-19',
      rangeStart: new Date('2026-11-19T00:00:00+02:00'),
      rangeEnd: new Date('2026-11-20T00:00:00+02:00'),
    }

    const { rows } = await service.totals(range, 'day', new Date('2026-11-19T23:59:59+02:00'))

    // Admin sees every row even with 1 rider
    expect(rows).toHaveLength(1)
    // Only rider-1 had workSeconds > 0, so riderCount is 1
    expect(rows[0]!.riderCount).toBe(1)
    expect(rows[0]!.workSeconds).toBe(3600)
  })

  test("the rider's toShiftDto never carries adminLabel while the admin's does", () => {
    const shift: WorkedShift = {
      startedAt: new Date('2026-11-19T10:00:00Z'),
      startedBeforeRange: false,
      endedAt: new Date('2026-11-19T12:00:00Z'),
      onBreakSince: null,
      workSeconds: 7200,
      jobSeconds: 5000,
      paidWaitSeconds: 600,
      unpaidSeconds: 1600,
      breaks: [],
      moneyCents: 2500,
      lateMoneyCents: 0,
      centsPerHour: 1250,
      currencyCode: 'EUR',
      statusChanges: [
        {
          at: new Date('2026-11-19T10:00:00Z'),
          fromStatus: EnumCourierStatus.OFFLINE,
          toStatus: EnumCourierStatus.ONLINE,
          cause: EnumCourierStatusChangeCause.ADMIN,
          byAdmin: true,
          adminLabel: 'representative@coop.org',
        },
      ],
      jobs: [],
    }

    // Rider view: withAdminLabels = false
    const riderDto = toShiftDto(shift, false)
    expect(riderDto.statusChanges[0]!.adminLabel).toBeUndefined()
    expect('adminLabel' in riderDto.statusChanges[0]!).toBe(false)
    expect(riderDto.statusChanges[0]!.byAdmin).toBe(true)

    // Admin view: withAdminLabels = true
    const adminDto = toShiftDto(shift, true)
    expect(adminDto.statusChanges[0]!.adminLabel).toBe('representative@coop.org')
  })

  describe('Spec 0042 Value 5 Guards (AC-15, AC-16, decision 75.41)', () => {
    const FORBIDDEN_EARNINGS_FIGURE_KEYS = [
      'activeCentsPerHour',
      'centsPerPaidKm',
      'medianPickupWaitSeconds',
      'pickupWaitCount',
      'pickupWaitSeconds',
      'paidKm',
      'dropOffCount',
      'dropoffStreet',
      'endLabel',
      'jobs',
      'weeks',
    ]

    test('CourierAdminDto never carries any of the 11 forbidden keys on instance or prototype', () => {
      const courier = new CourierEntity({
        id: 'c-admin-test-1',
        node_uri: null,
        firstName: 'Kostas',
        lastName: 'Papadopoulos',
        phoneNumber: '+306911111111',
        status: EnumCourierStatus.ONLINE,
        deliverySetting: EnumCourierDeliverySetting.AUTO_ACCEPT,
        userId: 'user-c-1',
        createdAt: new Date('2026-01-01T10:00:00Z'),
      } as any)

      const dto = new CourierAdminDto(courier)
      const instanceKeys = Object.keys(dto)
      const prototypeKeys = Object.getOwnPropertyNames(CourierAdminDto.prototype)

      for (const key of FORBIDDEN_EARNINGS_FIGURE_KEYS) {
        expect(instanceKeys).not.toContain(key)
        expect(prototypeKeys).not.toContain(key)
        expect((dto as any)[key]).toBeUndefined()
      }
    })

    test('neither time-worked-totals rows nor time-worked/current DTO carry any of the forbidden keys', () => {
      // 1. time-worked-totals row
      const totalsRow: TotalsRow = {
        period: '2026-11-19',
        riderCount: 3,
        workSeconds: 36000,
        jobSeconds: 24000,
        paidWaitSeconds: 2000,
        unpaidSeconds: 10000,
        moneyCents: 15000,
        unlinkedMoneyCents: 500,
        centsPerHour: 1450,
      }
      const totalsRowDto = toTotalsRowDto(totalsRow)
      const totalsRowKeys = Object.keys(totalsRowDto)
      const totalsRowProtoKeys = Object.getOwnPropertyNames(TimeWorkedTotalsRowDto.prototype)

      for (const key of FORBIDDEN_EARNINGS_FIGURE_KEYS) {
        expect(totalsRowKeys).not.toContain(key)
        expect(totalsRowProtoKeys).not.toContain(key)
        expect((totalsRowDto as any)[key]).toBeUndefined()
      }

      // 2. time-worked/current DTO (CurrentShiftDto)
      const shift: WorkedShift = {
        startedAt: new Date('2026-11-19T10:00:00Z'),
        startedBeforeRange: false,
        endedAt: null,
        onBreakSince: null,
        workSeconds: 7200,
        jobSeconds: 5000,
        paidWaitSeconds: 600,
        unpaidSeconds: 1600,
        breaks: [],
        moneyCents: 2500,
        lateMoneyCents: 0,
        centsPerHour: 1250,
        currencyCode: 'EUR',
        statusChanges: [],
        jobs: [],
      }
      const currentShiftDto = toCurrentShiftDto(shift)
      expect(currentShiftDto).not.toBeNull()
      const currentShiftKeys = Object.keys(currentShiftDto!)
      const currentShiftProtoKeys = Object.getOwnPropertyNames(CurrentShiftDto.prototype)

      for (const key of FORBIDDEN_EARNINGS_FIGURE_KEYS) {
        expect(currentShiftKeys).not.toContain(key)
        expect(currentShiftProtoKeys).not.toContain(key)
        expect((currentShiftDto as any)![key]).toBeUndefined()
      }
    })

    test('the admin rider route returns the same view with no reach limit (reachFrom null) and takes one rider id', async () => {
      const mockCourierRepository = {
        findById: jest.fn().mockResolvedValue({ id: 'courier-1', firstName: 'Nikos' }),
      }
      const mockTimeWorkedService = {
        earnings: jest.fn().mockResolvedValue({
          from: '2026-11-01',
          to: '2026-11-19',
          recordedFrom: null,
          currencyCode: 'EUR',
          days: [],
          weeks: [],
          shifts: [],
          jobsInNoShift: [],
        }),
      }

      const controller = new TimeWorkedAdminRestApiController(
        mockTimeWorkedService as any,
        mockCourierRepository as any
      )

      const result = await controller.forRider('courier-1', { from: '2026-11-01', to: '2026-11-19' })

      expect(mockCourierRepository.findById).toHaveBeenCalledWith('courier-1')
      expect(mockTimeWorkedService.earnings).toHaveBeenCalledWith(
        'courier-1',
        { from: '2026-11-01', to: '2026-11-19', reachFrom: null },
        { withAdminLabels: true }
      )
      expect(result).toBeDefined()
      expect(result.from).toBe('2026-11-01')
      expect(result.to).toBe('2026-11-19')
    })
  })
})
