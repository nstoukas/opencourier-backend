import { CallHandler, ExecutionContext } from '@nestjs/common'
import { throwError, lastValueFrom } from 'rxjs'
import { ErrorLoggingInterceptor } from './ErrorLoggingInterceptor'
import {
  ApiException,
  DeliveryNotFoundException,
  ErrorCode,
  ForbiddenException,
  NotFoundException,
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

  describe('Other errors are logged with logger.error (AC-4)', () => {
    it('logs non-404 ApiException with logger.error (e.g. 400)', async () => {
      const err = new VerificationCodeException('Verification code is invalid')
      await expect(runInterceptor(err)).rejects.toThrow(err)

      expect(loggerWarnSpy).not.toHaveBeenCalled()
      expect(loggerErrorSpy).toHaveBeenCalledTimes(1)
      expect(loggerErrorSpy).toHaveBeenCalledWith('Endpoint returned error', err)
    })

    it('logs 403 ForbiddenException with logger.error', async () => {
      const err = new ForbiddenException('Forbidden')
      await expect(runInterceptor(err)).rejects.toThrow(err)

      expect(loggerWarnSpy).not.toHaveBeenCalled()
      expect(loggerErrorSpy).toHaveBeenCalledTimes(1)
      expect(loggerErrorSpy).toHaveBeenCalledWith('Endpoint returned error', err)
    })

    it('logs Prisma unique constraint error (P2002) with logger.error', async () => {
      const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed on (phone)', {
        code: 'P2002',
        clientVersion: '5.3.1',
      })
      await expect(runInterceptor(err)).rejects.toThrow(err)

      expect(loggerWarnSpy).not.toHaveBeenCalled()
      expect(loggerErrorSpy).toHaveBeenCalledTimes(1)
      expect(loggerErrorSpy).toHaveBeenCalledWith('Endpoint returned error', err)
    })

    it('logs generic Error with logger.error', async () => {
      const err = new Error('Database connection failed')
      await expect(runInterceptor(err)).rejects.toThrow(err)

      expect(loggerWarnSpy).not.toHaveBeenCalled()
      expect(loggerErrorSpy).toHaveBeenCalledTimes(1)
      expect(loggerErrorSpy).toHaveBeenCalledWith('Endpoint returned error', err)
    })
  })
})
