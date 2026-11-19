import { CourierAdminDto } from 'src/rest-api/courier/admin/dtos/courier.admin.dto'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import {
  EnumCourierCompensationReason,
  EnumCourierDeliverySetting,
  EnumCourierStatus,
  EnumCourierStatusChangeCause,
} from '@prisma/types'
import {
  COOP_TOTALS_MIN_RIDERS,
  TimeWorkedService,
  TotalsRow,
} from 'src/services/time-worked/time-worked.service'
import { toShiftDto, toTotalsRowDto } from './time-worked.dto'
import { WorkedShift } from 'src/domains/time-worked/worked-shifts'

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

  test('a totals row and toTotalsRowDto carry no courierId or any rider id', () => {
    const row: TotalsRow = {
      period: '2026-11-19',
      riderCount: 5,
      workSeconds: 36000,
      jobSeconds: 24000,
      paidWaitSeconds: 2000,
      unpaidSeconds: 10000,
      moneyCents: 15000,
      unlinkedMoneyCents: 500,
      centsPerHour: 1450,
    }

    const rowDto = toTotalsRowDto(row)
    const dtoKeys = Object.keys(rowDto)

    expect(dtoKeys).not.toContain('courierId')
    expect(dtoKeys).not.toContain('riderId')
    expect(dtoKeys).not.toContain('userId')
    expect(dtoKeys).not.toContain('id')
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
})
