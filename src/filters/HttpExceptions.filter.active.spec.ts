import 'reflect-metadata'
import {
  ArgumentsHost,
  ConflictException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  INestApplication,
} from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { HttpAdapterHost } from '@nestjs/core'
import { Response } from 'express'
import request from 'supertest'
import { HttpExceptionFilter } from './HttpExceptions.filter'
import {
  ApiException,
  CantUpdateDeliveryStatusError,
  DeliveryNotFoundException,
  ErrorCode,
  NotFoundException,
  OFFER_HAS_ENDED_MESSAGE,
} from '../errors'
import { Prisma } from '@prisma/types'
import { refusalBody } from 'src/localization/coded-sentence'
import { PARTNER_EDIT_SENTENCES } from 'src/domains/delivery/partner-edit'

// Test controller throwing real errors to verify Nest exception filter pipeline end-to-end
@Controller('test-errors')
class TestFilterController {
  @Get('prisma-not-found')
  throwPrismaNotFound() {
    throw new Prisma.NotFoundError('No Delivery found', '5.3.1')
  }

  @Get('prisma-p2025')
  throwPrismaP2025() {
    throw new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
      code: 'P2025',
      clientVersion: '5.3.1',
    })
  }

  @Get('prisma-unique')
  throwPrismaUnique() {
    throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed on (phone)', {
      code: 'P2002',
      clientVersion: '5.3.1',
    })
  }

  @Get('api-not-found')
  throwApiNotFound() {
    throw new NotFoundException('User not found')
  }

  @Get('delivery-not-found')
  throwDeliveryNotFound() {
    throw new DeliveryNotFoundException('Delivery not found')
  }
}

describe('HttpExceptionFilter (Row 121, AC-1, AC-2, AC-5)', () => {
  let filter: HttpExceptionFilter
  let mockResponse: {
    status: jest.Mock
    json: jest.Mock
  }
  let mockHost: ArgumentsHost

  beforeEach(() => {
    filter = new HttpExceptionFilter()
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    }
    mockHost = {
      getType: () => 'http',
      switchToHttp: () => ({
        getResponse: () => mockResponse as unknown as Response,
        getRequest: () => ({}),
        getNext: () => ({}),
      }),
    } as unknown as ArgumentsHost
  })

  describe('AC-5 Guard: Catch metadata matches generated client Prisma errors', () => {
    // Reflect.getMetadata reads the array of classes registered by Nest's @Catch(...) decorator.
    // If the filter imports PrismaClientKnownRequestError from '@prisma/client/runtime/library'
    // instead of '@prisma/types', real errors thrown by the generated client are NOT instances
    // of the caught class, causing Nest to bypass this filter and answer 500.
    const caughtExceptions = Reflect.getMetadata('__filterCatchExceptions__', HttpExceptionFilter) as any[]

    it('registers ApiException, PrismaClientKnownRequestError and HttpException in @Catch metadata', () => {
      expect(Array.isArray(caughtExceptions)).toBe(true)
      expect(caughtExceptions).toContain(ApiException)
      expect(caughtExceptions).toContain(Prisma.PrismaClientKnownRequestError)
      expect(caughtExceptions).toContain(HttpException)
    })

    it('matches a real generated client Prisma.NotFoundError', () => {
      const realError = new Prisma.NotFoundError('No Delivery found', '5.3.1')
      const matches = caughtExceptions.some((cls) => realError instanceof cls)
      expect(matches).toBe(true)
    })

    it('matches a real generated client Prisma.PrismaClientKnownRequestError with P2025', () => {
      const realError = new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: '5.3.1',
      })
      const matches = caughtExceptions.some((cls) => realError instanceof cls)
      expect(matches).toBe(true)
    })

    it('matches a real generated client Prisma.PrismaClientKnownRequestError with P2002', () => {
      const realError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.3.1',
      })
      const matches = caughtExceptions.some((cls) => realError instanceof cls)
      expect(matches).toBe(true)
    })
  })

  describe('Unit tests: catch() status and body', () => {
    let consoleLogSpy: jest.SpyInstance

    beforeEach(() => {
      consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    })

    afterEach(() => {
      consoleLogSpy.mockRestore()
    })

    it('answers 404 for a real Prisma.NotFoundError and does not console.log (AC-1)', () => {
      const error = new Prisma.NotFoundError('No Delivery found', '5.3.1')
      filter.catch(error, mockHost)

      expect(mockResponse.status).toHaveBeenCalledWith(404)
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: ErrorCode.NOT_FOUND,
        message: 'Not found',
        statusCode: 404,
      })
      expect(consoleLogSpy).not.toHaveBeenCalled()
    })

    it('answers 404 for a real Prisma.PrismaClientKnownRequestError with P2025 (AC-1)', () => {
      const error = new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: '5.3.1',
      })
      filter.catch(error, mockHost)

      expect(mockResponse.status).toHaveBeenCalledWith(404)
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: ErrorCode.NOT_FOUND,
        message: 'Not found',
        statusCode: 404,
      })
      expect(consoleLogSpy).not.toHaveBeenCalled()
    })

    it('answers HTTP status 400 (not 404) for a unique constraint error (AC-2)', () => {
      const error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed on (phone)', {
        code: 'P2002',
        clientVersion: '5.3.1',
      })
      filter.catch(error, mockHost)

      // Must be HTTP status 400, not status 404 with a 400 body
      expect(mockResponse.status).toHaveBeenCalledWith(400)
      expect(mockResponse.status).not.toHaveBeenCalledWith(404)
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: ErrorCode.UNIQUE_CONSTRAINT,
        message: 'Unique constraint',
        statusCode: 400,
      })
      expect(consoleLogSpy).not.toHaveBeenCalled()
    })

    it('answers corresponding status for ApiException subclasses without console.log', () => {
      const error = new DeliveryNotFoundException('Delivery not found')
      filter.catch(error, mockHost)

      expect(mockResponse.status).toHaveBeenCalledWith(404)
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: ErrorCode.DELIVERY_NOT_FOUND,
        message: 'Delivery not found',
        statusCode: 404,
      })
      expect(consoleLogSpy).not.toHaveBeenCalled()
    })

    it('answers 500 and console.logs unexpected database errors with errorForConsole format (Row 132)', () => {
      const error = new Prisma.PrismaClientKnownRequestError('Raw query failed', {
        code: 'P2010',
        clientVersion: '5.3.1',
      })
      filter.catch(error, mockHost)

      expect(mockResponse.status).toHaveBeenCalledWith(500)
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: ErrorCode.UNKNOWN,
        message: 'Internal server error',
        statusCode: 500,
      })
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Unexpected database error: PrismaClientKnownRequestError P2010 (message withheld: it can repeat the call's data)"
        )
      )
    })

    describe('Row 132: Whole error objects in the error logs (AC-6)', () => {
      it('asserts recipient name or phone in unexpected database error never reaches console.log (Clause 6)', () => {
        const customerName = 'Maria Papadopoulou'
        const customerPhone = '+306912345678'
        const error = new Prisma.PrismaClientKnownRequestError(
          `Raw query failed for recipient ${customerName} with phone ${customerPhone}`,
          {
            code: 'P2010',
            clientVersion: '5.3.1',
          }
        )
        filter.catch(error, mockHost)

        expect(mockResponse.status).toHaveBeenCalledWith(500)
        expect(consoleLogSpy).toHaveBeenCalledTimes(1)
        const loggedOutput = consoleLogSpy.mock.calls[0].join(' ')

        // Neither recipient name nor phone appears anywhere in the console.log output
        expect(loggedOutput).not.toContain(customerName)
        expect(loggedOutput).not.toContain(customerPhone)
        expect(loggedOutput).toContain(
          "Unexpected database error: PrismaClientKnownRequestError P2010 (message withheld: it can repeat the call's data)"
        )
        // Stack frames are present, but header line with name and phone is absent
        expect(loggedOutput).toMatch(/\n\s+at\s/)
      })
    })

    describe('Spec 0054 AC-6: Refusals by code and params', () => {
      it('adds specific code for Nest HttpException carrying a known fixed sentence', () => {
        const error = new ConflictException(OFFER_HAS_ENDED_MESSAGE)
        filter.catch(error, mockHost)

        expect(mockResponse.status).toHaveBeenCalledWith(409)
        expect(mockResponse.json).toHaveBeenCalledWith({
          statusCode: 409,
          error: 'Conflict',
          message: OFFER_HAS_ENDED_MESSAGE,
          code: 'OFFER_HAS_ENDED',
        })
      })

      it('adds PARTNER_EDIT_ORDER_ENDED code for ConflictException with ended order sentence (Row 152, clause 1)', () => {
        const error = new ConflictException(PARTNER_EDIT_SENTENCES.ended)
        filter.catch(error, mockHost)

        expect(mockResponse.status).toHaveBeenCalledWith(409)
        expect(mockResponse.json).toHaveBeenCalledWith({
          statusCode: 409,
          error: 'Conflict',
          message: PARTNER_EDIT_SENTENCES.ended,
          code: 'PARTNER_EDIT_ORDER_ENDED',
        })
      })

      it('adds PARTNER_EDIT_POINT_HELD code for ConflictException with held point sentence (Row 152, clause 2)', () => {
        const error = new ConflictException(PARTNER_EDIT_SENTENCES.pointHeld)
        filter.catch(error, mockHost)

        expect(mockResponse.status).toHaveBeenCalledWith(409)
        expect(mockResponse.json).toHaveBeenCalledWith({
          statusCode: 409,
          error: 'Conflict',
          message: PARTNER_EDIT_SENTENCES.pointHeld,
          code: 'PARTNER_EDIT_POINT_HELD',
        })
      })

      it('adds PARTNER_EDIT_CHANGED code for ConflictException with changed order sentence (Row 161)', () => {
        const error = new ConflictException(PARTNER_EDIT_SENTENCES.changed)
        filter.catch(error, mockHost)

        expect(mockResponse.status).toHaveBeenCalledWith(409)
        expect(mockResponse.json).toHaveBeenCalledWith({
          statusCode: 409,
          error: 'Conflict',
          message: PARTNER_EDIT_SENTENCES.changed,
          code: 'PARTNER_EDIT_CHANGED',
        })
      })

      it('preserves code and params when Nest HttpException was thrown with refusalBody', () => {
        const body = refusalBody(HttpStatus.CONFLICT, {
          code: 'LEAVE_TOO_SOON',
          params: { minutes: 7 },
          message: 'Wait at least 7 min before leaving',
        })
        const error = new ConflictException(body)
        filter.catch(error, mockHost)

        expect(mockResponse.status).toHaveBeenCalledWith(409)
        expect(mockResponse.json).toHaveBeenCalledWith({
          statusCode: 409,
          code: 'LEAVE_TOO_SOON',
          params: { minutes: 7 },
          message: 'Wait at least 7 min before leaving',
        })
      })

      it('ApiException uses sentenceCode and passes params when provided', () => {
        const error = new CantUpdateDeliveryStatusError('Dispatch stopped (heat)')
        error.sentenceCode = 'DISPATCH_STOPPED'
        error.params = { reason: 'HEAT' }
        filter.catch(error, mockHost)

        expect(mockResponse.status).toHaveBeenCalledWith(409)
        expect(mockResponse.json).toHaveBeenCalledWith({
          code: 'DISPATCH_STOPPED',
          message: 'Dispatch stopped (heat)',
          statusCode: 409,
          params: { reason: 'HEAT' },
        })
      })

      it('ApiException replaces generic code with specific code for known refusal sentence', () => {
        const error = new ApiException(ErrorCode.BAD_REQUEST, OFFER_HAS_ENDED_MESSAGE, 400)
        filter.catch(error, mockHost)

        expect(mockResponse.status).toHaveBeenCalledWith(400)
        expect(mockResponse.json).toHaveBeenCalledWith({
          code: 'OFFER_HAS_ENDED',
          message: OFFER_HAS_ENDED_MESSAGE,
          statusCode: 400,
        })
      })

      it('leaves Nest HttpException body without code when sentence is not in the table', () => {
        const error = new HttpException({ statusCode: 400, message: 'Custom unknown failure' }, 400)
        filter.catch(error, mockHost)

        expect(mockResponse.status).toHaveBeenCalledWith(400)
        expect(mockResponse.json).toHaveBeenCalledWith({
          statusCode: 400,
          message: 'Custom unknown failure',
        })
      })
    })
  })

  describe('HTTP level tests with Nest application (AC-1, AC-2, AC-5)', () => {
    let app: INestApplication

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        controllers: [TestFilterController],
      }).compile()

      app = moduleRef.createNestApplication()
      const { httpAdapter } = app.get(HttpAdapterHost)
      app.useGlobalFilters(new HttpExceptionFilter(httpAdapter))
      await app.init()
    })

    afterAll(async () => {
      await app.close()
    })

    it('answers HTTP 404 through global filter when controller throws Prisma.NotFoundError', async () => {
      const res = await request(app.getHttpServer()).get('/test-errors/prisma-not-found')
      expect(res.status).toBe(404)
      expect(res.body).toEqual({
        code: 'NOT_FOUND',
        message: 'Not found',
        statusCode: 404,
      })
    })

    it('answers HTTP 404 through global filter when controller throws Prisma P2025', async () => {
      const res = await request(app.getHttpServer()).get('/test-errors/prisma-p2025')
      expect(res.status).toBe(404)
      expect(res.body).toEqual({
        code: 'NOT_FOUND',
        message: 'Not found',
        statusCode: 404,
      })
    })

    it('answers HTTP 400 (both response status and body statusCode) when controller throws Prisma P2002', async () => {
      const res = await request(app.getHttpServer()).get('/test-errors/prisma-unique')
      expect(res.status).toBe(400)
      expect(res.body).toEqual({
        code: 'UNIQUE_CONSTRAINT',
        message: 'Unique constraint',
        statusCode: 400,
      })
    })

    it('answers HTTP 404 for NotFoundException through global filter', async () => {
      const res = await request(app.getHttpServer()).get('/test-errors/api-not-found')
      expect(res.status).toBe(404)
      expect(res.body.statusCode).toBe(404)
    })

    it('answers HTTP 404 for DeliveryNotFoundException through global filter', async () => {
      const res = await request(app.getHttpServer()).get('/test-errors/delivery-not-found')
      expect(res.status).toBe(404)
      expect(res.body.statusCode).toBe(404)
      expect(res.body.code).toBe('DELIVERY_NOT_FOUND')
    })
  })
})
