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

  const makeMockContext = (): ExecutionContext =>
    ({
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({}),
        getResponse: () => ({}),
      }),
    } as unknown as ExecutionContext)

  const makeMockCallHandler = (err: any): CallHandler => ({
    handle: () => throwError(() => err),
  })

  const runInterceptor = async (err: any) => {
    const context = makeMockContext()
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

    it('does not call logger.error for any other ApiException answering 404', async () => {
      const err = new ApiException(ErrorCode.DELIVERY_CANT_BE_ACCEPTED, 'Offer has ended', 404)
      await expect(runInterceptor(err)).rejects.toThrow(err)

      expect(loggerErrorSpy).not.toHaveBeenCalled()
      expect(loggerWarnSpy).not.toHaveBeenCalled()
    })
  })

  describe('Prisma missing row errors log one warning and no error (AC-4)', () => {
    it('logs one logger.warn and NO logger.error for Prisma.NotFoundError', async () => {
      const err = new Prisma.NotFoundError('No Delivery found', '5.3.1')
      await expect(runInterceptor(err)).rejects.toThrow(err)

      expect(loggerErrorSpy).not.toHaveBeenCalled()
      expect(loggerWarnSpy).toHaveBeenCalledTimes(1)
      expect(loggerWarnSpy).toHaveBeenCalledWith('Endpoint answered 404 for a missing row: No Delivery found')
    })

    it('logs one logger.warn and NO logger.error for PrismaClientKnownRequestError with P2025', async () => {
      const err = new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
        code: 'P2025',
        clientVersion: '5.3.1',
      })
      await expect(runInterceptor(err)).rejects.toThrow(err)

      expect(loggerErrorSpy).not.toHaveBeenCalled()
      expect(loggerWarnSpy).toHaveBeenCalledTimes(1)
      expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Endpoint answered 404 for a missing row:'))
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
