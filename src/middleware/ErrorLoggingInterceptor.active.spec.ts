import { CallHandler, ExecutionContext } from '@nestjs/common'
import { throwError, lastValueFrom } from 'rxjs'
import { ErrorLoggingInterceptor } from './ErrorLoggingInterceptor'
import {
  ApiException,
  DeliveryNotFoundException,
  ErrorCode,
  ForbiddenException,
  NotFoundException,
  PersonalDataWarningException,
  VerificationCodeException,
} from '../errors'
import { Prisma } from '@prisma/types'

describe('ErrorLoggingInterceptor (Row 121, AC-4)', () => {
  let interceptor: ErrorLoggingInterceptor
  let loggerErrorSpy: jest.SpyInstance
  let loggerWarnSpy: jest.SpyInstance

  beforeEach(() => {
    interceptor = new ErrorLoggingInterceptor()
    loggerErrorSpy = jest.spyOn(interceptor.logger, 'error').mockImplementation(() => interceptor.logger)
    loggerWarnSpy = jest.spyOn(interceptor.logger, 'warn').mockImplementation(() => interceptor.logger)
  })

  afterEach(() => {
    loggerErrorSpy.mockRestore()
    loggerWarnSpy.mockRestore()
  })

  const makeMockContext = (
    contextType: string = 'http',
    reqOverrides?: { method?: string; route?: { path?: string }; url?: string }
  ): ExecutionContext =>
    ({
      getType: () => contextType,
      switchToHttp: () => ({
        getRequest: () =>
          reqOverrides ?? {
            method: 'POST',
            route: { path: '/api/courier/v1/deliveries/:deliveryId/accept' },
            url: '/api/courier/v1/deliveries/abc123/accept',
          },
        getResponse: () => ({}),
      }),
    } as unknown as ExecutionContext)

  const makeMockCallHandler = (err: any): CallHandler => ({
    handle: () => throwError(() => err),
  })

  const runInterceptor = async (err: any, context: ExecutionContext = makeMockContext()) => {
    const callHandler = makeMockCallHandler(err)
    return lastValueFrom(interceptor.intercept(context, callHandler))
  }

  describe('Expected 404 ApiExceptions are not logged as errors (AC-4)', () => {
    it('does not call logger.error for NotFoundException (404)', async () => {
      const err = new NotFoundException('User not found')
      await expect(runInterceptor(err)).rejects.toThrow(err)

      expect(loggerErrorSpy).not.toHaveBeenCalled()
      expect(loggerWarnSpy).not.toHaveBeenCalled()
    })

    it('does not call logger.error for DeliveryNotFoundException (404)', async () => {
      // Row 119 introduced DeliveryNotFoundException; it is an expected 404 and must not log a stack
      const err = new DeliveryNotFoundException('Delivery not found')
      await expect(runInterceptor(err)).rejects.toThrow(err)

      expect(loggerErrorSpy).not.toHaveBeenCalled()
      expect(loggerWarnSpy).not.toHaveBeenCalled()
    })

    it('does not call logger.error for 404 ApiException when server fails to record an accept the rider won (DELIVERY_CANT_BE_ACCEPTED)', async () => {
      const err = new ApiException(ErrorCode.DELIVERY_CANT_BE_ACCEPTED, 'Offer has ended', 404)
      await expect(runInterceptor(err)).rejects.toThrow(err)

      expect(loggerErrorSpy).not.toHaveBeenCalled()
      expect(loggerWarnSpy).not.toHaveBeenCalled()
    })
  })

  describe('Prisma missing row errors log one warning and no error (AC-4)', () => {
    it('logs one logger.warn and NO logger.error for Prisma.NotFoundError naming method and route pattern, never request.url', async () => {
      const err = new Prisma.NotFoundError('No Delivery found', '5.3.1')
      const context = makeMockContext('http', {
        method: 'POST',
        route: { path: '/api/courier/v1/deliveries/:deliveryId/accept' },
        url: '/api/courier/v1/deliveries/abc123/accept',
      })
      await expect(runInterceptor(err, context)).rejects.toThrow(err)

      expect(loggerErrorSpy).not.toHaveBeenCalled()
      expect(loggerWarnSpy).toHaveBeenCalledTimes(1)
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        'Endpoint answered 404 for a missing row: POST /api/courier/v1/deliveries/:deliveryId/accept No Delivery found'
      )
      const warnMessage = loggerWarnSpy.mock.calls[0][0]
      expect(warnMessage).toContain('POST /api/courier/v1/deliveries/:deliveryId/accept')
      expect(warnMessage).not.toContain('abc123')
    })

    it('logs one logger.warn and NO logger.error for PrismaClientKnownRequestError with P2025 naming method and route pattern', async () => {
      const err = new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
        code: 'P2025',
        clientVersion: '5.3.1',
      })
      const context = makeMockContext('http', {
        method: 'POST',
        route: { path: '/api/courier/v1/deliveries/:deliveryId/accept' },
        url: '/api/courier/v1/deliveries/abc123/accept',
      })
      await expect(runInterceptor(err, context)).rejects.toThrow(err)

      expect(loggerErrorSpy).not.toHaveBeenCalled()
      expect(loggerWarnSpy).toHaveBeenCalledTimes(1)
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        'Endpoint answered 404 for a missing row: POST /api/courier/v1/deliveries/:deliveryId/accept Record to update not found.'
      )
      const warnMessage = loggerWarnSpy.mock.calls[0][0]
      expect(warnMessage).toContain('POST /api/courier/v1/deliveries/:deliveryId/accept')
      expect(warnMessage).not.toContain('abc123')
    })

    it('falls back to (no route) when request route path is undefined', async () => {
      const err = new Prisma.NotFoundError('No Delivery found', '5.3.1')
      const context = makeMockContext('http', { method: 'GET' })
      await expect(runInterceptor(err, context)).rejects.toThrow(err)

      expect(loggerErrorSpy).not.toHaveBeenCalled()
      expect(loggerWarnSpy).toHaveBeenCalledTimes(1)
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        'Endpoint answered 404 for a missing row: GET (no route) No Delivery found'
      )
    })

    it('for a non-HTTP context (ws), does not throw and names the context type in logger.warn', async () => {
      const err = new Prisma.NotFoundError('No Delivery found', '5.3.1')
      const context = makeMockContext('ws')
      await expect(runInterceptor(err, context)).rejects.toThrow(err)

      expect(loggerErrorSpy).not.toHaveBeenCalled()
      expect(loggerWarnSpy).toHaveBeenCalledTimes(1)
      expect(loggerWarnSpy).toHaveBeenCalledWith('Endpoint answered 404 for a missing row: ws No Delivery found')
    })

    it('for a non-HTTP context (rpc), does not throw and names the context type in logger.warn', async () => {
      const err = new Prisma.NotFoundError('No Delivery found', '5.3.1')
      const context = makeMockContext('rpc')
      await expect(runInterceptor(err, context)).rejects.toThrow(err)

      expect(loggerErrorSpy).not.toHaveBeenCalled()
      expect(loggerWarnSpy).toHaveBeenCalledTimes(1)
      expect(loggerWarnSpy).toHaveBeenCalledWith('Endpoint answered 404 for a missing row: rpc No Delivery found')
    })
  })

  describe('Other errors are logged with logger.error (AC-4, Row 132 summary and frames)', () => {
    it('logs non-404 ApiException with logger.error (e.g. 400)', async () => {
      const err = new VerificationCodeException('Verification code is invalid')
      await expect(runInterceptor(err)).rejects.toThrow(err)

      expect(loggerWarnSpy).not.toHaveBeenCalled()
      expect(loggerErrorSpy).toHaveBeenCalledTimes(1)
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Endpoint returned error: POST /api/courier/v1/deliveries/:deliveryId/accept VerificationCodeException VERIFICATION_CODE: Verification code is invalid',
        { stack: expect.stringMatching(/^\s+at\s/) }
      )
    })

    it('logs 403 ForbiddenException with logger.error', async () => {
      const err = new ForbiddenException('Forbidden')
      await expect(runInterceptor(err)).rejects.toThrow(err)

      expect(loggerWarnSpy).not.toHaveBeenCalled()
      expect(loggerErrorSpy).toHaveBeenCalledTimes(1)
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Endpoint returned error: POST /api/courier/v1/deliveries/:deliveryId/accept ForbiddenException FORBIDDEN: Forbidden',
        { stack: expect.stringMatching(/^\s+at\s/) }
      )
    })

    it('logs Prisma unique constraint error (P2002) with logger.error and message withheld', async () => {
      const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed on (phone)', {
        code: 'P2002',
        clientVersion: '5.3.1',
      })
      await expect(runInterceptor(err)).rejects.toThrow(err)

      expect(loggerWarnSpy).not.toHaveBeenCalled()
      expect(loggerErrorSpy).toHaveBeenCalledTimes(1)
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        "Endpoint returned error: POST /api/courier/v1/deliveries/:deliveryId/accept PrismaClientKnownRequestError P2002 (message withheld: it can repeat the call's data)",
        { stack: expect.stringMatching(/^\s+at\s/) }
      )
    })

    it('logs generic Error with logger.error', async () => {
      const err = new Error('Database connection failed')
      await expect(runInterceptor(err)).rejects.toThrow(err)

      expect(loggerWarnSpy).not.toHaveBeenCalled()
      expect(loggerErrorSpy).toHaveBeenCalledTimes(1)
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Endpoint returned error: POST /api/courier/v1/deliveries/:deliveryId/accept Error: Database connection failed',
        { stack: expect.stringMatching(/^\s+at\s/) }
      )
    })
  })

  describe('Row 132: Whole error objects in the error logs (AC-6)', () => {
    it('fails if recipient name or phone from a failed create reaches logger.error (Clause 6)', async () => {
      const recipientName = 'Maria Papadopoulou'
      const recipientPhone = '+306912345678'
      const prismaValidationError = new Prisma.PrismaClientValidationError(
        `Invalid \`prisma.delivery.create()\` invocation:\n{\n  recipientName: "${recipientName}",\n  phone: "${recipientPhone}"\n}`,
        { clientVersion: '5.3.1' }
      )

      await expect(runInterceptor(prismaValidationError)).rejects.toThrow(prismaValidationError)

      expect(loggerErrorSpy).toHaveBeenCalledTimes(1)
      const callArgs = loggerErrorSpy.mock.calls[0]
      const loggedMessage = callArgs[0]
      const loggedMeta = callArgs[1]
      const combinedLog = `${loggedMessage} ${JSON.stringify(loggedMeta)}`

      // Assert neither recipient name nor phone appears anywhere in the logged message or meta
      expect(combinedLog).not.toContain(recipientName)
      expect(combinedLog).not.toContain(recipientPhone)

      // Assert error summary was logged properly
      expect(loggedMessage).toContain("PrismaClientValidationError (message withheld: it can repeat the call's data)")
      // Assert stack frames are present, but stack header containing the parameters is excluded
      expect(loggedMeta.stack).toBeDefined()
      expect(loggedMeta.stack).toMatch(/^\s+at\s/)
      expect(loggedMeta.stack).not.toContain(recipientName)
      expect(loggedMeta.stack).not.toContain(recipientPhone)
    })

    it('logs type only and never content when thrown value is a non-Error string with phone (Clause 4, 6)', async () => {
      const customerPhone = '+306912345678'
      await expect(runInterceptor(customerPhone)).rejects.toBe(customerPhone)

      expect(loggerErrorSpy).toHaveBeenCalledTimes(1)
      const [loggedMessage, loggedMeta] = loggerErrorSpy.mock.calls[0]
      const combinedLog = `${loggedMessage} ${JSON.stringify(loggedMeta)}`

      expect(combinedLog).not.toContain(customerPhone)
      expect(loggedMessage).toContain('A value that is not an Error was thrown (string)')
      expect(loggedMeta.stack).toBeUndefined()
    })

    it('logs type only and never content when thrown value is a non-Error object with customer data (Clause 4, 6)', async () => {
      const customerData = { name: 'Maria Papadopoulou', phone: '+306912345678' }
      await expect(runInterceptor(customerData)).rejects.toBe(customerData)

      expect(loggerErrorSpy).toHaveBeenCalledTimes(1)
      const [loggedMessage, loggedMeta] = loggerErrorSpy.mock.calls[0]
      const combinedLog = `${loggedMessage} ${JSON.stringify(loggedMeta)}`

      expect(combinedLog).not.toContain('Maria Papadopoulou')
      expect(combinedLog).not.toContain('+306912345678')
      expect(loggedMessage).toContain('A value that is not an Error was thrown (object)')
      expect(loggedMeta.stack).toBeUndefined()
    })
  })

  describe('PersonalDataWarningException (row 82 review)', () => {
    let loggerInfoSpy: jest.SpyInstance

    beforeEach(() => {
      loggerInfoSpy = jest.spyOn(interceptor.logger, 'info').mockImplementation(() => interceptor.logger)
    })

    afterEach(() => {
      loggerInfoSpy.mockRestore()
    })

    it('logs one logger.info with the route pattern and no stack, and NO logger.error or logger.warn', async () => {
      const err = new PersonalDataWarningException('Notes describe the place, never the person.')
      const context = makeMockContext('http', {
        method: 'POST',
        route: { path: '/api/courier/v1/location-notes' },
        url: '/api/courier/v1/location-notes',
      })

      await expect(runInterceptor(err, context)).rejects.toThrow(err)

      expect(loggerErrorSpy).not.toHaveBeenCalled()
      expect(loggerWarnSpy).not.toHaveBeenCalled()
      expect(loggerInfoSpy).toHaveBeenCalledTimes(1)
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        'Address note personal data warning: POST /api/courier/v1/location-notes'
      )
    })

    it('does not leak note text in the info log', async () => {
      const err = new PersonalDataWarningException('Notes describe the place, never the person.')
      const context = makeMockContext('http', {
        method: 'POST',
        route: { path: '/api/courier/v1/location-notes' },
        url: '/api/courier/v1/location-notes',
      })

      await expect(runInterceptor(err, context)).rejects.toThrow(err)

      const infoMessage = loggerInfoSpy.mock.calls[0][0]
      expect(infoMessage).not.toContain('6941234567')
      expect(infoMessage).not.toContain('Notes describe')
    })
  })
})
