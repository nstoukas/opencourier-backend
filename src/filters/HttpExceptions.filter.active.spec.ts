import 'reflect-metadata'
import { ArgumentsHost, Controller, Get, INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { HttpAdapterHost } from '@nestjs/core'
import { Response } from 'express'
import request from 'supertest'
import { HttpExceptionFilter } from './HttpExceptions.filter'
import { ApiException, DeliveryNotFoundException, ErrorCode, NotFoundException } from '../errors'
import { Prisma } from '@prisma/types'

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

    it('registers ApiException and the generated client PrismaClientKnownRequestError in @Catch metadata', () => {
      expect(Array.isArray(caughtExceptions)).toBe(true)
      expect(caughtExceptions).toContain(ApiException)
      expect(caughtExceptions).toContain(Prisma.PrismaClientKnownRequestError)
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

    it('answers 500 and console.logs unexpected database errors', () => {
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
      expect(consoleLogSpy).toHaveBeenCalledWith(error)
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
