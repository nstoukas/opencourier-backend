import fs from 'fs'
import path from 'path'
import { ArgumentsHost, Controller, Get, INestApplication, Module, NotFoundException } from '@nestjs/common'
import { HttpAdapterHost, NestFactory } from '@nestjs/core'
import { Response } from 'express'
import request from 'supertest'
import { Prisma } from '@prisma/types'
import winston from 'winston'
import { UnknownErrorsFilter } from './UnknownErrors.filter'
import { HttpExceptionFilter } from './HttpExceptions.filter'

// Test controller throwing Prisma and HTTP exceptions for the integration test
@Controller('test-unknown-errors')
class TestUnknownErrorsController {
  @Get('prisma-validation')
  throwPrismaValidation() {
    throw new Prisma.PrismaClientValidationError(
      'Invalid `prisma.delivery.create()` invocation:\n{\n  recipientName: "Maria Papadopoulou",\n  phone: "+306912345678"\n}',
      { clientVersion: '5.3.1' }
    )
  }

  @Get('http-not-found')
  throwNotFound() {
    throw new NotFoundException('Delivery not found')
  }
}

@Module({
  controllers: [TestUnknownErrorsController],
})
class TestUnknownErrorsModule {}

describe('UnknownErrorsFilter (Row 132, Review blocker and decision 132.2)', () => {
  let filter: UnknownErrorsFilter
  let loggerErrorSpy: jest.SpyInstance

  beforeEach(() => {
    filter = new UnknownErrorsFilter()
    // Spy on the filter instance's winston logger
    loggerErrorSpy = jest.spyOn((filter as any).logger, 'error').mockImplementation(() => (filter as any).logger)
  })

  afterEach(() => {
    loggerErrorSpy.mockRestore()
  })

  const makeMockHttpHost = (resOverrides: Partial<Response> = {}): { host: ArgumentsHost; res: any } => {
    const res: any = {
      headersSent: false,
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      end: jest.fn().mockReturnThis(),
      ...resOverrides,
    }
    const host = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({}),
        getResponse: () => res,
        getNext: () => ({}),
      }),
      getArgs: () => [],
      getArgByIndex: () => undefined,
      switchToRpc: () => ({}),
      switchToWs: () => ({}),
    } as unknown as ArgumentsHost
    return { host, res }
  }

  describe('Unit tests: catch() exception logging and response formatting', () => {
    it('logs ONE line through describeErrorForLog with "Unhandled error: <summary>" and { stack }', () => {
      const err = new Error('Unexpected catastrophic failure')
      const { host, res } = makeMockHttpHost()

      filter.catch(err, host)

      expect(loggerErrorSpy).toHaveBeenCalledTimes(1)
      expect(loggerErrorSpy).toHaveBeenCalledWith('Unhandled error: Error: Unexpected catastrophic failure', {
        stack: expect.stringMatching(/^\s+at\s/),
      })
      expect(res.status).toHaveBeenCalledWith(500)
      expect(res.json).toHaveBeenCalledWith({
        statusCode: 500,
        message: 'Internal server error',
      })
    })

    it('answers 500 {"statusCode":500,"message":"Internal server error"} by default', () => {
      const { host, res } = makeMockHttpHost()
      filter.catch('some random non-error', host)

      expect(res.status).toHaveBeenCalledWith(500)
      expect(res.json).toHaveBeenCalledWith({
        statusCode: 500,
        message: 'Internal server error',
      })
    })

    it('answers with status and message for an http-errors style object (numeric statusCode and string message)', () => {
      const httpError = {
        statusCode: 418,
        message: "I'm a teapot",
        expose: true,
      }
      const { host, res } = makeMockHttpHost()

      filter.catch(httpError, host)

      expect(res.status).toHaveBeenCalledWith(418)
      expect(res.json).toHaveBeenCalledWith({
        statusCode: 418,
        message: "I'm a teapot",
      })
    })

    it('falls back to 500 when http-errors object has non-numeric statusCode or non-string message', () => {
      const invalidHttpError = {
        statusCode: '400', // string, not number
        message: 'Bad request',
      }
      const { host, res } = makeMockHttpHost()

      filter.catch(invalidHttpError, host)

      expect(res.status).toHaveBeenCalledWith(500)
      expect(res.json).toHaveBeenCalledWith({
        statusCode: 500,
        message: 'Internal server error',
      })
    })

    it('ends response without calling status or json if headers were already sent', () => {
      const { host, res } = makeMockHttpHost({ headersSent: true })
      const err = new Error('Late failure after headers sent')

      filter.catch(err, host)

      expect(loggerErrorSpy).toHaveBeenCalledTimes(1)
      expect(res.end).toHaveBeenCalledTimes(1)
      expect(res.status).not.toHaveBeenCalled()
      expect(res.json).not.toHaveBeenCalled()
    })

    it('outside HTTP (e.g. ws, rpc) only logs through describeErrorForLog and does not send response', () => {
      const err = new Error('RPC worker crash')
      const wsHost = {
        getType: () => 'ws',
        switchToHttp: jest.fn(),
        getArgs: () => [],
        getArgByIndex: () => undefined,
        switchToRpc: () => ({}),
        switchToWs: () => ({}),
      } as unknown as ArgumentsHost

      filter.catch(err, wsHost)

      expect(loggerErrorSpy).toHaveBeenCalledTimes(1)
      expect(loggerErrorSpy).toHaveBeenCalledWith('Unhandled error: Error: RPC worker crash', {
        stack: expect.stringMatching(/^\s+at\s/),
      })
      expect(wsHost.switchToHttp).not.toHaveBeenCalled()
    })

    it('ensures PrismaClientValidationError carrying name and phone never reaches logger or response body', () => {
      const recipientName = 'Maria Papadopoulou'
      const recipientPhone = '+306912345678'
      const validationError = new Prisma.PrismaClientValidationError(
        `Invalid \`prisma.delivery.create()\` invocation:\n{\n  recipientName: "${recipientName}",\n  phone: "${recipientPhone}"\n}`,
        { clientVersion: '5.3.1' }
      )
      const { host, res } = makeMockHttpHost()

      filter.catch(validationError, host)

      expect(loggerErrorSpy).toHaveBeenCalledTimes(1)
      const [loggedMsg, loggedMeta] = loggerErrorSpy.mock.calls[0]
      const combinedLog = `${loggedMsg} ${JSON.stringify(loggedMeta)}`

      // Neither recipient name nor phone appears in message or any meta field
      expect(combinedLog).not.toContain(recipientName)
      expect(combinedLog).not.toContain(recipientPhone)
      expect(loggedMsg).toContain("PrismaClientValidationError (message withheld: it can repeat the call's data)")

      // Response body contains standard 500 and neither recipient detail
      expect(res.status).toHaveBeenCalledWith(500)
      const resBody = res.json.mock.calls[0][0]
      expect(resBody).toEqual({ statusCode: 500, message: 'Internal server error' })
      expect(JSON.stringify(resBody)).not.toContain(recipientName)
      expect(JSON.stringify(resBody)).not.toContain(recipientPhone)
    })
  })

  describe('Integration with Nest application and main.ts global filter ordering', () => {
    it('pins that main.ts registers UnknownErrorsFilter before HttpExceptionFilter', () => {
      const mainPath = path.resolve(__dirname, '../main.ts')
      const mainContent = fs.readFileSync(mainPath, 'utf8')

      // Nest reverses global filters, so registering [UnknownErrorsFilter, HttpExceptionFilter]
      // ensures HttpExceptionFilter is tried first and UnknownErrorsFilter acts as catch-all.
      expect(mainContent).toMatch(
        /app\.useGlobalFilters\(\s*new UnknownErrorsFilter\(\),\s*new HttpExceptionFilter\(httpAdapter\)\s*\)/
      )
    })

    describe('Real Nest app filter behavior (NestFactory)', () => {
      let app: INestApplication
      let unknownErrorsFilter: UnknownErrorsFilter
      let filterLoggerSpy: jest.SpyInstance
      let consoleErrorSpy: jest.SpyInstance

      beforeAll(async () => {
        unknownErrorsFilter = new UnknownErrorsFilter()
        filterLoggerSpy = jest
          .spyOn((unknownErrorsFilter as any).logger, 'error')
          .mockImplementation(() => (unknownErrorsFilter as any).logger)
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

        const testApp = await NestFactory.create(TestUnknownErrorsModule, { logger: false })
        const { httpAdapter } = testApp.get(HttpAdapterHost)
        // Register filters in the exact order main.ts does
        testApp.useGlobalFilters(unknownErrorsFilter, new HttpExceptionFilter(httpAdapter))
        await testApp.init()
        app = testApp
      })

      afterAll(async () => {
        filterLoggerSpy.mockRestore()
        consoleErrorSpy.mockRestore()
        if (app) {
          await app.close()
        }
      })

      it('answers 500 and neither recipient name nor phone reaches any log call on uncaught PrismaClientValidationError', async () => {
        const recipientName = 'Maria Papadopoulou'
        const recipientPhone = '+306912345678'
        filterLoggerSpy.mockClear()
        consoleErrorSpy.mockClear()

        const res = await request(app.getHttpServer()).get('/test-unknown-errors/prisma-validation')

        expect(res.status).toBe(500)
        expect(res.body).toEqual({
          statusCode: 500,
          message: 'Internal server error',
        })
        expect(JSON.stringify(res.body)).not.toContain(recipientName)
        expect(JSON.stringify(res.body)).not.toContain(recipientPhone)

        // Verify that UnknownErrorsFilter logged with sanitized summary
        expect(filterLoggerSpy).toHaveBeenCalledTimes(1)
        const [loggedMsg, loggedMeta] = filterLoggerSpy.mock.calls[0]
        const serializedLog = `${loggedMsg} ${JSON.stringify(loggedMeta)}`
        expect(serializedLog).not.toContain(recipientName)
        expect(serializedLog).not.toContain(recipientPhone)
        expect(serializedLog).toContain("PrismaClientValidationError (message withheld: it can repeat the call's data)")

        // Verify console.error was not called with customer details either
        for (const call of consoleErrorSpy.mock.calls) {
          const serializedConsole = `${call[0]} ${JSON.stringify(call.slice(1))}`
          expect(serializedConsole).not.toContain(recipientName)
          expect(serializedConsole).not.toContain(recipientPhone)
        }
      })

      it('HttpExceptionFilter keeps its errors (e.g. 404) because it is evaluated before UnknownErrorsFilter', async () => {
        const res = await request(app.getHttpServer()).get('/test-unknown-errors/http-not-found')

        // HttpExceptionFilter handles NotFoundException and returns 404.
        // If UnknownErrorsFilter were evaluated first, it would catch everything and return 500.
        expect(res.status).toBe(404)
        expect(res.body.statusCode).toBe(404)
      })
    })
  })
})
