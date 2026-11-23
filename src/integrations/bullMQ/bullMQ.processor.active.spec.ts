import { BullMQProcessor } from './bullMQ.processor'
import { EventBusService } from '../../services/eventBus/eventBus.service'
import { Job } from 'bullmq'
import { Prisma } from '@prisma/types'
import { describeErrorForLog, errorSummaryForLog } from '../../utils/errorForLog'

describe('BullMQProcessor (Row 139)', () => {
  let processor: BullMQProcessor
  let mockEventBusService: jest.Mocked<EventBusService>
  let loggerErrorSpy: jest.SpyInstance

  beforeEach(() => {
    mockEventBusService = {
      emit: jest.fn(),
    } as unknown as jest.Mocked<EventBusService>

    processor = new BullMQProcessor(mockEventBusService)
    loggerErrorSpy = jest.spyOn((processor as any).logger, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('calls eventBusService.emit with job.name and job.data and resolves', async () => {
    mockEventBusService.emit.mockResolvedValue(undefined as any)
    const job = {
      name: 'delivery-event',
      data: { deliveryId: 'del-123' },
    } as Job

    await expect(processor.process(job)).resolves.toBeUndefined()
    expect(mockEventBusService.emit).toHaveBeenCalledWith('delivery-event', { deliveryId: 'del-123' })
    expect(loggerErrorSpy).not.toHaveBeenCalled()
  })

  it('logs "Job <name> failed: <summary>" with frames only as stack, never job.data, and process() rejects with the same error', async () => {
    const error = new Error('Database handler crashed')
    mockEventBusService.emit.mockRejectedValue(error)

    const sensitiveData = {
      recipientPhone: '+306999123456',
      customerName: 'Kostas Karyotakis',
      secretNote: 'Doorbell broken',
    }
    const job = {
      name: 'cancellation-sweep',
      data: sensitiveData,
    } as Job

    // process() must reject with the same error so BullMQ marks the job failed
    await expect(processor.process(job)).rejects.toBe(error)

    expect(loggerErrorSpy).toHaveBeenCalledTimes(1)
    const [msg, stack] = loggerErrorSpy.mock.calls[0]!

    // 1st argument: message ends with summary
    expect(msg).toBe(`Job cancellation-sweep failed: ${errorSummaryForLog(error)}`)
    expect(msg).toContain('Error: Database handler crashed')

    // 2nd argument: frames only, never the Error object
    expect(stack).toBe(describeErrorForLog(error).stack)
    expect(stack).not.toBeInstanceOf(Error)
    expect(typeof stack).toBe('string')
    const lines = stack.split('\n')
    expect(lines.length).toBeGreaterThan(0)
    lines.forEach((line: string) => expect(line).toMatch(/^\s+at\s/))

    // job.data must never be logged in any argument
    const allLogged = loggerErrorSpy.mock.calls[0]!.map(String).join(' ')
    expect(allLogged).not.toContain(sensitiveData.recipientPhone)
    expect(allLogged).not.toContain(sensitiveData.customerName)
    expect(allLogged).not.toContain(sensitiveData.secretNote)
  })

  it('withholds Prisma error message carrying customer data and process() rejects with the same error', async () => {
    const customerPhone = '+306941112233'
    const customerName = 'Maria Callas'
    const validationMessage = `Invalid invocation for ${customerName} (${customerPhone})`
    const prismaError = new Prisma.PrismaClientValidationError(validationMessage, {
      clientVersion: '5.3.1',
    })

    mockEventBusService.emit.mockRejectedValue(prismaError)

    const job = {
      name: 'offer-expiry',
      data: { offerId: 'off-99' },
    } as Job

    await expect(processor.process(job)).rejects.toBe(prismaError)

    expect(loggerErrorSpy).toHaveBeenCalledTimes(1)
    const [msg, stack] = loggerErrorSpy.mock.calls[0]!

    expect(msg).toBe(
      `Job offer-expiry failed: PrismaClientValidationError (message withheld: it can repeat the call's data)`
    )
    expect(msg).not.toContain(customerName)
    expect(msg).not.toContain(customerPhone)

    expect(stack).toBe(describeErrorForLog(prismaError).stack)
    expect(stack).not.toBeInstanceOf(Error)
    expect(stack).not.toContain(customerName)
    expect(stack).not.toContain(customerPhone)
  })
})
