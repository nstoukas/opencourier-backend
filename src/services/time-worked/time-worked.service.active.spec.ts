import {
  EnumCourierStatus,
  EnumCourierStatusChangeCause,
} from '@prisma/types'
import { TimeWorkedService } from './time-worked.service'
import { TimeWorkedRecords } from 'src/persistence/repositories/time-worked.repository'

describe('TimeWorkedService.current (spec 0040, AC-10)', () => {
  const courierId = 'courier-current-test-1'
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

  it('an open shift returns shift with endedAt null and asOf equals the now passed in', async () => {
    const now = new Date('2026-11-20T14:00:00+02:00')

    const mockTimeWorkedRepository = {
      findRecordedFrom: jest.fn().mockResolvedValue(new Date('2026-01-01T00:00:00+02:00')),
      findRecords: jest.fn().mockResolvedValue(
        createEmptyRecords({
          statusChanges: [
            {
              id: 'sc-1',
              courierId,
              createdAt: new Date('2026-11-20T12:00:00+02:00'),
              fromStatus: EnumCourierStatus.OFFLINE,
              toStatus: EnumCourierStatus.ONLINE,
              cause: EnumCourierStatusChangeCause.RIDER,
              adminUserId: null,
            },
          ],
        })
      ),
    }

    const service = new TimeWorkedService(mockTimeWorkedRepository as any, mockConfigDomainService as any)

    const result = await service.current(courierId, now)

    expect(result.asOf).toEqual(now)
    expect(result.shiftBreakMinutes).toBe(shiftBreakMinutes)
    expect(result.shift).not.toBeNull()
    expect(result.shift!.endedAt).toBeNull()
    expect(result.shift!.onBreakSince).toBeNull()
  })

  it('a shift on a break shorter than shiftBreakMinutes returns shift with onBreakSince set and endedAt null', async () => {
    const now = new Date('2026-11-20T14:00:00+02:00')
    const breakStart = new Date('2026-11-20T13:45:00+02:00') // 15 min break, shorter than 30 min limit

    const mockTimeWorkedRepository = {
      findRecordedFrom: jest.fn().mockResolvedValue(new Date('2026-01-01T00:00:00+02:00')),
      findRecords: jest.fn().mockResolvedValue(
        createEmptyRecords({
          statusChanges: [
            {
              id: 'sc-1',
              courierId,
              createdAt: new Date('2026-11-20T12:00:00+02:00'),
              fromStatus: EnumCourierStatus.OFFLINE,
              toStatus: EnumCourierStatus.ONLINE,
              cause: EnumCourierStatusChangeCause.RIDER,
              adminUserId: null,
            },
            {
              id: 'sc-2',
              courierId,
              createdAt: breakStart,
              fromStatus: EnumCourierStatus.ONLINE,
              toStatus: EnumCourierStatus.OFFLINE,
              cause: EnumCourierStatusChangeCause.RIDER,
              adminUserId: null,
            },
          ],
        })
      ),
    }

    const service = new TimeWorkedService(mockTimeWorkedRepository as any, mockConfigDomainService as any)

    const result = await service.current(courierId, now)

    expect(result.asOf).toEqual(now)
    expect(result.shiftBreakMinutes).toBe(shiftBreakMinutes)
    expect(result.shift).not.toBeNull()
    expect(result.shift!.endedAt).toBeNull()
    expect(result.shift!.onBreakSince).toEqual(breakStart)
  })

  it('a break that reached the limit returns shift null', async () => {
    const now = new Date('2026-11-20T14:00:00+02:00')
    const breakStart = new Date('2026-11-20T13:20:00+02:00') // 40 min break >= 30 min limit

    const mockTimeWorkedRepository = {
      findRecordedFrom: jest.fn().mockResolvedValue(new Date('2026-01-01T00:00:00+02:00')),
      findRecords: jest.fn().mockResolvedValue(
        createEmptyRecords({
          statusChanges: [
            {
              id: 'sc-1',
              courierId,
              createdAt: new Date('2026-11-20T12:00:00+02:00'),
              fromStatus: EnumCourierStatus.OFFLINE,
              toStatus: EnumCourierStatus.ONLINE,
              cause: EnumCourierStatusChangeCause.RIDER,
              adminUserId: null,
            },
            {
              id: 'sc-2',
              courierId,
              createdAt: breakStart,
              fromStatus: EnumCourierStatus.ONLINE,
              toStatus: EnumCourierStatus.OFFLINE,
              cause: EnumCourierStatusChangeCause.RIDER,
              adminUserId: null,
            },
          ],
        })
      ),
    }

    const service = new TimeWorkedService(mockTimeWorkedRepository as any, mockConfigDomainService as any)

    const result = await service.current(courierId, now)

    expect(result.asOf).toEqual(now)
    expect(result.shiftBreakMinutes).toBe(shiftBreakMinutes)
    expect(result.shift).toBeNull()
  })
})
