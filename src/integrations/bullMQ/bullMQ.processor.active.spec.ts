import { BullMQProcessor } from './bullMQ.processor'
import { EventBusService } from '../../services/eventBus/eventBus.service'
import { Job, UnrecoverableError } from 'bullmq'
import { Prisma } from '@prisma/types'
import { describeErrorForLog } from '../../utils/errorForLog'

describe('BullMQProcessor (Row 139, Row 141)', () => {
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

  it('calls eventBusService.emit with job.name and job.data and resolves on success', async () => {
    mockEventBusService.emit.mockResolvedValue(undefined as any)
    const job = {
      name: 'delivery-event',
      data: { deliveryId: 'del-123' },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as unknown as Job

    await expect(processor.process(job)).resolves.toBeUndefined()
    expect(mockEventBusService.emit).toHaveBeenCalledWith('delivery-event', { deliveryId: 'del-123' })
    expect(loggerErrorSpy).not.toHaveBeenCalled()
  })

  it('logs "Job <name> failed (try N of M): <summary>" and rejects with a NEW Error containing summary and stack frames', async () => {
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
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as unknown as Job

    let rejectedError: any
    try {
      await processor.process(job)
    } catch (err) {
      rejectedError = err
    }

    expect(rejectedError).toBeDefined()
    // Row 141: rejects with a NEW Error, not the original error instance
    expect(rejectedError).not.toBe(error)
    expect(rejectedError).toBeInstanceOf(Error)
    expect(rejectedError.name).toBe('Error')
    expect(rejectedError.message).toBe(describeErrorForLog(error).summary)
    expect(rejectedError.message).toContain('Database handler crashed')

    // Stack is formatted as `${described.name}: ${summary}\n${frames}`
    expect(typeof rejectedError.stack).toBe('string')
    expect(rejectedError.stack).toContain(rejectedError.message)

    // Logger assertion
    expect(loggerErrorSpy).toHaveBeenCalledTimes(1)
    const [msg, stack] = loggerErrorSpy.mock.calls[0]!

    expect(msg).toBe(`Job cancellation-sweep failed (try 1 of 3): ${describeErrorForLog(error).summary}`)
    expect(stack).toBe(describeErrorForLog(error).stack)

    // Never logs job.data in any argument
    const allLogged = loggerErrorSpy.mock.calls[0]!.map(String).join(' ')
    expect(allLogged).not.toContain(sensitiveData.recipientPhone)
    expect(allLogged).not.toContain(sensitiveData.customerName)
    expect(allLogged).not.toContain(sensitiveData.secretNote)
  })

  describe('try N of M formatting in log line', () => {
    it('formats try 1 of 3 on first attempt', async () => {
      mockEventBusService.emit.mockRejectedValue(new Error('fail 1'))
      const job = {
        name: 'offer-expiry',
        data: {},
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job

      await expect(processor.process(job)).rejects.toThrow()
      expect(loggerErrorSpy.mock.calls[0]![0]).toContain('Job offer-expiry failed (try 1 of 3):')
    })

    it('formats try 2 of 3 on second attempt', async () => {
      mockEventBusService.emit.mockRejectedValue(new Error('fail 2'))
      const job = {
        name: 'offer-expiry',
        data: {},
        attemptsMade: 1,
        opts: { attempts: 3 },
      } as unknown as Job

      await expect(processor.process(job)).rejects.toThrow()
      expect(loggerErrorSpy.mock.calls[0]![0]).toContain('Job offer-expiry failed (try 2 of 3):')
    })

    it('formats try 1 of 1 when attempts option is absent', async () => {
      mockEventBusService.emit.mockRejectedValue(new Error('fail once'))
      const job = {
        name: 'ad-hoc-job',
        data: {},
        attemptsMade: 0,
        opts: {},
      } as unknown as Job

      await expect(processor.process(job)).rejects.toThrow()
      expect(loggerErrorSpy.mock.calls[0]![0]).toContain('Job ad-hoc-job failed (try 1 of 1):')
    })
  })

  describe('preservation of error name and BullMQ signals', () => {
    it('preserves name of UnrecoverableError so BullMQ knows not to retry it (Row 141 review)', async () => {
      const unrecError = new UnrecoverableError('Unrecoverable fatal condition')
      mockEventBusService.emit.mockRejectedValue(unrecError)

      const job = {
        name: 'some-job',
        data: {},
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job

      let caught: any
      try {
        await processor.process(job)
      } catch (err) {
        caught = err
      }

      expect(caught).toBeDefined()
      expect(caught).not.toBe(unrecError)
      // Name must be 'UnrecoverableError', not generic 'Error'
      expect(caught.name).toBe('UnrecoverableError')
      expect(caught.message).toContain('Unrecoverable fatal condition')
    })

    it('preserves custom error class name on the thrown described error', async () => {
      class CustomProcessingError extends Error {
        constructor(msg: string) {
          super(msg)
          this.name = 'CustomProcessingError'
        }
      }
      const customErr = new CustomProcessingError('Custom error message')
      mockEventBusService.emit.mockRejectedValue(customErr)

      const job = {
        name: 'custom-job',
        data: {},
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job

      let caught: any
      try {
        await processor.process(job)
      } catch (err) {
        caught = err
      }

      expect(caught.name).toBe('CustomProcessingError')
    })

    it('describes a non-Error thrown value with name "Error" and type-based summary', async () => {
      mockEventBusService.emit.mockRejectedValue('plain string rejection')

      const job = {
        name: 'string-job',
        data: {},
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job

      let caught: any
      try {
        await processor.process(job)
      } catch (err) {
        caught = err
      }

      expect(caught).toBeInstanceOf(Error)
      expect(caught.name).toBe('Error')
      expect(caught.message).toBe('A value that is not an Error was thrown (string)')
    })
  })

  describe('Prisma errors with sensitive customer details (Row 141)', () => {
    it('withholds message and stack of PrismaClientKnownRequestError: neither contains customer name or phone', async () => {
      const customerName = 'Maria Callas'
      const customerPhone = '+306941112233'
      const sensitivePrismaMsg = `Unique constraint failed on Maria Callas (${customerPhone}) in table Delivery`
      const prismaError = new Prisma.PrismaClientKnownRequestError(sensitivePrismaMsg, {
        code: 'P2002',
        clientVersion: '5.3.1',
        meta: { modelName: 'Delivery', target: ['dropoffPhoneNumber'] },
      })

      mockEventBusService.emit.mockRejectedValue(prismaError)

      const job = {
        name: 'offer-expiry',
        data: { offerId: 'off-99' },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job

      let caught: any
      try {
        await processor.process(job)
      } catch (err) {
        caught = err
      }

      expect(caught).toBeDefined()
      // Must be a new Error, not the original prismaError
      expect(caught).not.toBe(prismaError)
      expect(caught.name).toBe('PrismaClientKnownRequestError')

      // Neither message nor stack may contain customerName or customerPhone
      expect(caught.message).not.toContain(customerName)
      expect(caught.message).not.toContain(customerPhone)
      expect(caught.stack).not.toContain(customerName)
      expect(caught.stack).not.toContain(customerPhone)

      // Message is the described summary
      expect(caught.message).toBe(describeErrorForLog(prismaError).summary)
      expect(caught.message).toContain('message withheld')

      // Logger also has no sensitive details
      const [msg, stack] = loggerErrorSpy.mock.calls[0]!
      expect(msg).not.toContain(customerName)
      expect(msg).not.toContain(customerPhone)
      expect(stack).not.toContain(customerName)
      expect(stack).not.toContain(customerPhone)
    })

    it('withholds message and stack of PrismaClientValidationError: neither contains customer name or phone', async () => {
      const customerName = 'Kostas Karyotakis'
      const customerPhone = '+306999123456'
      const validationMessage = `Invalid invocation for ${customerName} (${customerPhone})`
      const prismaValidationError = new Prisma.PrismaClientValidationError(validationMessage, {
        clientVersion: '5.3.1',
      })

      mockEventBusService.emit.mockRejectedValue(prismaValidationError)

      const job = {
        name: 'offer-expiry',
        data: { offerId: 'off-100' },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job

      let caught: any
      try {
        await processor.process(job)
      } catch (err) {
        caught = err
      }

      expect(caught).not.toBe(prismaValidationError)
      expect(caught.name).toBe('PrismaClientValidationError')

      expect(caught.message).not.toContain(customerName)
      expect(caught.message).not.toContain(customerPhone)
      expect(caught.stack).not.toContain(customerName)
      expect(caught.stack).not.toContain(customerPhone)

      expect(caught.message).toBe(describeErrorForLog(prismaValidationError).summary)
      expect(caught.message).toContain('message withheld')

      const [msg, stack] = loggerErrorSpy.mock.calls[0]!
      expect(msg).not.toContain(customerName)
      expect(msg).not.toContain(customerPhone)
      expect(stack).not.toContain(customerName)
      expect(stack).not.toContain(customerPhone)
    })
  })
})
