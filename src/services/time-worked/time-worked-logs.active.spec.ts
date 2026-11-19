import { Logger } from '@nestjs/common'
import {
  EnumCourierCompensationReason,
  EnumCourierStatus,
  EnumCourierStatusChangeCause,
} from '@prisma/types'
import { TimeWorkedService } from './time-worked.service'

describe('Time Worked Logs (spec 0040, AC-19)', () => {
  it('the warning for an other currency compensation names only its id, no amount or time figure', async () => {
    const compensationId = 'comp-other-currency-99'
    const compensationAmount = 5432
    const compensationWaitMinutes = 27

    const mockTimeWorkedRepository = {
      findRecordedFrom: jest.fn().mockResolvedValue(new Date('2026-01-01')),
      findRecords: jest.fn().mockResolvedValue({
        statusChanges: [
          {
            id: 'sc-1',
            courierId: 'rider-log-1',
            createdAt: new Date('2026-11-19T08:00:00+02:00'),
            fromStatus: EnumCourierStatus.OFFLINE,
            toStatus: EnumCourierStatus.ONLINE,
            cause: EnumCourierStatusChangeCause.RIDER,
            adminUserId: null,
          },
        ],
        statusBefore: new Map(),
        acceptedDeliveries: new Map(),
        events: [],
        deliveries: [],
        compensations: [
          {
            id: compensationId,
            courierId: 'rider-log-1',
            deliveryId: 'del-log-1',
            amount: compensationAmount,
            currencyCode: 'USD', // not EUR (instance currency)
            reason: EnumCourierCompensationReason.WAITING,
            waitMinutes: compensationWaitMinutes,
            createdAt: new Date('2026-11-19T08:30:00+02:00'),
          },
        ],
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

    const loggerWarnSpy = jest.spyOn((service as any).logger as Logger, 'warn').mockImplementation(() => {})

    const range = {
      from: '2026-11-19',
      to: '2026-11-19',
      rangeStart: new Date('2026-11-19T00:00:00+02:00'),
      rangeEnd: new Date('2026-11-20T00:00:00+02:00'),
    }

    await service.forRider('rider-log-1', range, { withAdminLabels: false })

    expect(loggerWarnSpy).toHaveBeenCalledTimes(1)
    const loggedMessage = loggerWarnSpy.mock.calls[0]?.[0] as string

    // 1. Must name the compensation ID
    expect(loggedMessage).toContain(compensationId)

    // 2. Must NOT contain the money amount
    expect(loggedMessage).not.toContain(String(compensationAmount))
    expect(loggedMessage).not.toContain('54.32')

    // 3. Must NOT contain time figures (wait minutes)
    expect(loggedMessage).not.toContain(String(compensationWaitMinutes))
    expect(loggedMessage).not.toContain('27')

    // 4. Exact message matches the spec
    expect(loggedMessage).toBe(
      `Time worked left out compensation ${compensationId}: it is not in the instance currency`
    )

    loggerWarnSpy.mockRestore()
  })
})
