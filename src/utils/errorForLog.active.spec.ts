import fs from 'fs'
import path from 'path'
import { describeErrorForLog, errorForConsole } from './errorForLog'
import { Prisma } from '@prisma/types'
import { ApiException, ErrorCode } from '../errors'

describe('errorForLog (Row 132, Clauses 1-5)', () => {
  const recipientName = 'Maria Papadopoulou'
  const recipientPhone = '+306912345678'

  describe('Clause 1: The three logging sites use errorForLog helpers', () => {
    it('exports describeErrorForLog and errorForConsole', () => {
      expect(typeof describeErrorForLog).toBe('function')
      expect(typeof errorForConsole).toBe('function')
    })

    it('pins that ErrorLoggingInterceptor, HttpExceptions.filter, and main.ts import and call the helper', () => {
      const interceptorSource = fs.readFileSync(
        path.resolve(__dirname, '../middleware/ErrorLoggingInterceptor.ts'),
        'utf8'
      )
      expect(interceptorSource).toMatch(/import\s*\{\s*describeErrorForLog\s*\}\s*from\s*'\.\.\/utils\/errorForLog'/)
      expect(interceptorSource).toContain('describeErrorForLog(err)')

      const filterSource = fs.readFileSync(path.resolve(__dirname, '../filters/HttpExceptions.filter.ts'), 'utf8')
      expect(filterSource).toMatch(/import\s*\{\s*errorForConsole\s*\}\s*from\s*'\.\.\/utils\/errorForLog'/)
      expect(filterSource).toContain('errorForConsole(exception)')

      const mainSource = fs.readFileSync(path.resolve(__dirname, '../main.ts'), 'utf8')
      expect(mainSource).toMatch(
        /import\s*\{[^}]*describeErrorForLog[^}]*errorForConsole[^}]*\}\s*from\s*'\.\/utils\/errorForLog'/
      )
      expect(mainSource).toContain('describeErrorForLog(reason)')
      expect(mainSource).toContain('errorForConsole(reason)')
    })
  })

  describe('Clause 2: Prisma errors log name and code, NEVER message or stack header', () => {
    it('withholds message and stack header for real Prisma.PrismaClientValidationError carrying recipient name and phone', () => {
      const validationMessage = `Invalid \`prisma.delivery.create()\` invocation:\n{\n  recipientName: "${recipientName}",\n  phone: "${recipientPhone}"\n}`
      const prismaValidationError = new Prisma.PrismaClientValidationError(validationMessage, {
        clientVersion: '5.3.1',
      })

      // The raw error's message and stack header repeat the call's parameters
      expect(prismaValidationError.message).toContain(recipientName)
      expect(prismaValidationError.message).toContain(recipientPhone)
      expect(prismaValidationError.stack).toContain(recipientName)

      const logged = describeErrorForLog(prismaValidationError)

      // Summary carries name, never message or customer details
      expect(logged.summary).toBe("PrismaClientValidationError (message withheld: it can repeat the call's data)")
      expect(logged.summary).not.toContain(recipientName)
      expect(logged.summary).not.toContain(recipientPhone)
      expect(logged.summary).not.toContain('prisma.delivery.create')

      // Stack contains only the "    at ..." frames, never the first header line
      expect(logged.stack).toBeDefined()
      expect(logged.stack).not.toContain(recipientName)
      expect(logged.stack).not.toContain(recipientPhone)
      expect(logged.stack).not.toContain('PrismaClientValidationError: Invalid')
      const stackLines = (logged.stack ?? '').split('\n')
      expect(stackLines.length).toBeGreaterThan(0)
      stackLines.forEach((line) => {
        expect(line).toMatch(/^\s+at\s/)
      })

      // errorForConsole joins summary and frames without leaking customer data
      const consoleOutput = errorForConsole(prismaValidationError)
      expect(consoleOutput).not.toContain(recipientName)
      expect(consoleOutput).not.toContain(recipientPhone)
      expect(consoleOutput).toContain("PrismaClientValidationError (message withheld: it can repeat the call's data)")
    })

    it('withholds message and carries code for real Prisma.PrismaClientKnownRequestError with P2002', () => {
      const rawMessage = `Unique constraint failed on (phone) for ${recipientName} (${recipientPhone})`
      const prismaKnownError = new Prisma.PrismaClientKnownRequestError(rawMessage, {
        code: 'P2002',
        clientVersion: '5.3.1',
      })

      const logged = describeErrorForLog(prismaKnownError)

      expect(logged.summary).toBe(
        "PrismaClientKnownRequestError P2002 (message withheld: it can repeat the call's data)"
      )
      expect(logged.summary).not.toContain(recipientName)
      expect(logged.summary).not.toContain(recipientPhone)
      expect(logged.summary).not.toContain('Unique constraint')

      expect(logged.stack).toBeDefined()
      expect(logged.stack).not.toContain(recipientName)
      expect(logged.stack).not.toContain(recipientPhone)
      expect(logged.stack).not.toContain('Unique constraint')

      const consoleOutput = errorForConsole(prismaKnownError)
      expect(consoleOutput).not.toContain(recipientName)
      expect(consoleOutput).not.toContain(recipientPhone)
      expect(consoleOutput).toContain(
        "PrismaClientKnownRequestError P2002 (message withheld: it can repeat the call's data)"
      )
    })

    it('withholds message and carries code for real Prisma.PrismaClientKnownRequestError with P2010 (raw query error)', () => {
      const rawMessage = `Raw query failed: Key (phone)=(${recipientPhone}) for recipient ${recipientName} already exists`
      const prismaKnownError = new Prisma.PrismaClientKnownRequestError(rawMessage, {
        code: 'P2010',
        clientVersion: '5.3.1',
      })

      const logged = describeErrorForLog(prismaKnownError)

      expect(logged.summary).toBe(
        "PrismaClientKnownRequestError P2010 (message withheld: it can repeat the call's data)"
      )
      expect(logged.summary).not.toContain(recipientName)
      expect(logged.summary).not.toContain(recipientPhone)

      expect(logged.stack).toBeDefined()
      expect(logged.stack).not.toContain(recipientName)
      expect(logged.stack).not.toContain(recipientPhone)

      const consoleOutput = errorForConsole(prismaKnownError)
      expect(consoleOutput).not.toContain(recipientName)
      expect(consoleOutput).not.toContain(recipientPhone)
      expect(consoleOutput).toContain(
        "PrismaClientKnownRequestError P2010 (message withheld: it can repeat the call's data)"
      )
    })

    it('withholds message for Prisma.NotFoundError', () => {
      const notFoundError = new Prisma.NotFoundError(
        `No Delivery found for ${recipientName} ${recipientPhone}`,
        '5.3.1'
      )

      const logged = describeErrorForLog(notFoundError)

      expect(logged.summary).toBe("NotFoundError P2025 (message withheld: it can repeat the call's data)")
      expect(logged.summary).not.toContain(recipientName)
      expect(logged.summary).not.toContain(recipientPhone)
      expect(logged.stack).not.toContain(recipientName)
      expect(logged.stack).not.toContain(recipientPhone)
    })
  })

  describe('Clause 3: Non-Prisma errors keep name, code, message and stack frames', () => {
    it('keeps name, ApiException code, message, and frames for ApiException', () => {
      const apiException = new ApiException(ErrorCode.BAD_REQUEST, 'Invalid request parameter', 400)
      const logged = describeErrorForLog(apiException)

      expect(logged.summary).toBe('ApiException BAD_REQUEST: Invalid request parameter')
      expect(logged.stack).toBeDefined()
      // Stack has frames but not the header repeating the message
      expect(logged.stack).not.toContain('ApiException: Invalid request parameter')
      const frames = (logged.stack ?? '').split('\n')
      expect(frames.length).toBeGreaterThan(0)
      frames.forEach((frame) => {
        expect(frame).toMatch(/^\s+at\s/)
      })

      const consoleOutput = errorForConsole(apiException)
      expect(consoleOutput).toContain('ApiException BAD_REQUEST: Invalid request parameter')
      expect(consoleOutput).toContain('\n    at ')
    })

    it('keeps name, message, and frames for standard Error', () => {
      const stdError = new Error('Database connection failed')
      const logged = describeErrorForLog(stdError)

      expect(logged.summary).toBe('Error: Database connection failed')
      expect(logged.stack).toBeDefined()
      const frames = (logged.stack ?? '').split('\n')
      expect(frames.length).toBeGreaterThan(0)
      frames.forEach((frame) => {
        expect(frame).toMatch(/^\s+at\s/)
      })
    })

    it('keeps custom string code on non-ApiException Error', () => {
      const customError = Object.assign(new Error('Gateway timeout from external service'), {
        name: 'GatewayError',
        code: 'GATEWAY_TIMEOUT',
      })
      const logged = describeErrorForLog(customError)

      expect(logged.summary).toBe('GatewayError GATEWAY_TIMEOUT: Gateway timeout from external service')
    })

    it('keeps numeric code on non-ApiException Error', () => {
      const customNumericError = Object.assign(new Error('System connection fault'), {
        name: 'SystemError',
        code: 504,
      })
      const logged = describeErrorForLog(customNumericError)

      expect(logged.summary).toBe('SystemError 504: System connection fault')
    })

    it('handles Error with undefined or empty stack gracefully', () => {
      const noStack = new Error('No stack available')
      delete noStack.stack
      const logged = describeErrorForLog(noStack)

      expect(logged.summary).toBe('Error: No stack available')
      expect(logged.stack).toBeUndefined()
      expect(errorForConsole(noStack)).toBe('Error: No stack available')
    })

    it('handles Error whose stack contains no frames (only header)', () => {
      const headerOnly = new Error('Header only')
      headerOnly.stack = 'Error: Header only'
      const logged = describeErrorForLog(headerOnly)

      expect(logged.summary).toBe('Error: Header only')
      expect(logged.stack).toBeUndefined()
    })
  })

  describe('Clause 4: Thrown non-Error values log type only, never content', () => {
    it('logs string type only for a thrown string containing a phone number', () => {
      const thrownString = '+306912345678'
      const logged = describeErrorForLog(thrownString)

      expect(logged.summary).toBe('A value that is not an Error was thrown (string)')
      expect(logged.summary).not.toContain(thrownString)
      expect(logged.stack).toBeUndefined()
      expect(errorForConsole(thrownString)).toBe('A value that is not an Error was thrown (string)')
    })

    it('logs object type only for a thrown object containing recipient details', () => {
      const thrownObject = { recipient: 'Maria Papadopoulou', phone: '+306912345678' }
      const logged = describeErrorForLog(thrownObject)

      expect(logged.summary).toBe('A value that is not an Error was thrown (object)')
      expect(logged.summary).not.toContain('Maria')
      expect(logged.summary).not.toContain('+306912345678')
      expect(logged.stack).toBeUndefined()
      expect(errorForConsole(thrownObject)).toBe('A value that is not an Error was thrown (object)')
    })

    it('logs "null" plainly for thrown null', () => {
      const logged = describeErrorForLog(null)

      expect(logged.summary).toBe('A value that is not an Error was thrown (null)')
      expect(logged.stack).toBeUndefined()
    })

    it('logs "undefined" for thrown undefined', () => {
      const logged = describeErrorForLog(undefined)

      expect(logged.summary).toBe('A value that is not an Error was thrown (undefined)')
      expect(logged.stack).toBeUndefined()
    })

    it('logs "number" for thrown number', () => {
      const logged = describeErrorForLog(404)

      expect(logged.summary).toBe('A value that is not an Error was thrown (number)')
      expect(logged.stack).toBeUndefined()
    })

    it('logs "boolean" for thrown boolean', () => {
      const logged = describeErrorForLog(false)

      expect(logged.summary).toBe('A value that is not an Error was thrown (boolean)')
      expect(logged.stack).toBeUndefined()
    })
  })

  describe('Clause 5: main.ts no longer prints rejected promise (p) and logs through helper', () => {
    // main.ts registers global process handlers at import and starts the server via main().
    // Directly importing main.ts in a test would attempt server boot and socket binding,
    // so we pin main.ts source structure and verify handler behavior through the helper.
    const mainPath = path.resolve(__dirname, '../main.ts')
    const mainContent = fs.readFileSync(mainPath, 'utf8')

    it('unhandledRejection handler takes only reason and no second promise parameter (p)', () => {
      // Must be (reason) => or reason =>, not (reason, p) =>
      expect(mainContent).toMatch(/\.on\('unhandledRejection',\s*\((reason)\)\s*=>/)
      expect(mainContent).not.toMatch(/\.on\('unhandledRejection',\s*\([^)]*,/)
    })

    it('unhandledRejection handler does not print p to console.error or panicLogger', () => {
      expect(mainContent).not.toContain("'Unhandled Rejection at Promise', p")
      expect(mainContent).not.toContain("Promise', p")
    })

    it('unhandledRejection logs through errorForConsole and describeErrorForLog', () => {
      expect(mainContent).toContain('console.error(`Unhandled Rejection at Promise: ${errorForConsole(reason)}`)')
      expect(mainContent).toContain('const { summary, stack } = describeErrorForLog(reason)')
      expect(mainContent).toContain('panicLogger.error(`Unhandled Rejection at Promise: ${summary}`, { stack })')
    })

    it('uncaughtException logs through errorForConsole and describeErrorForLog', () => {
      expect(mainContent).toContain('console.error(`Uncaught Exception thrown: ${errorForConsole(err)}`)')
      expect(mainContent).toContain('const { summary, stack } = describeErrorForLog(err)')
      expect(mainContent).toContain('panicLogger.error(`Uncaught Exception thrown: ${summary}`, { stack })')
    })

    it('main().catch logs startup failure through errorForConsole', () => {
      expect(mainContent).toMatch(
        /main\(\)\.catch\(\(error\)\s*=>\s*console\.error\(`The server did not start: \$\{errorForConsole\(error\)\}`\)\)/
      )
    })
  })

  describe('Row 132 Review Fixes (Decision 132.2)', () => {
    describe('codeOf reads errorCode when code is absent (PrismaClientInitializationError)', () => {
      it('reads errorCode for PrismaClientInitializationError (P1001)', () => {
        const initError = new Prisma.PrismaClientInitializationError(
          "Can't reach database server at localhost:5432",
          '5.3.1',
          'P1001'
        )
        const logged = describeErrorForLog(initError)
        expect(logged.summary).toBe(
          "PrismaClientInitializationError P1001 (message withheld: it can repeat the call's data)"
        )
        expect(logged.summary).not.toContain('localhost:5432')
      })

      it('reads errorCode when code is undefined on custom Error', () => {
        const customError = Object.assign(new Error('Init failure'), {
          name: 'InitError',
          errorCode: 'P1001',
        })
        const logged = describeErrorForLog(customError)
        expect(logged.summary).toBe('InitError P1001: Init failure')
      })

      it('prefers code when both code and errorCode are present', () => {
        const customError = Object.assign(new Error('Dual code error'), {
          name: 'CustomError',
          code: 'PRIMARY_CODE',
          errorCode: 'FALLBACK_CODE',
        })
        const logged = describeErrorForLog(customError)
        expect(logged.summary).toBe('CustomError PRIMARY_CODE: Dual code error')
      })
    })

    describe('Prisma error meta allow-list (modelName and target only)', () => {
      it('includes modelName and string target in Prisma error summary', () => {
        const prismaKnownError = new Prisma.PrismaClientKnownRequestError('Constraint violation', {
          code: 'P2002',
          clientVersion: '5.3.1',
          meta: { modelName: 'Delivery', target: 'id' },
        })
        const logged = describeErrorForLog(prismaKnownError)
        expect(logged.summary).toBe(
          "PrismaClientKnownRequestError P2002 [model Delivery; target id] (message withheld: it can repeat the call's data)"
        )
      })

      it('includes modelName and string array target in Prisma error summary', () => {
        const prismaKnownError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.3.1',
          meta: { modelName: 'User', target: ['email', 'role'] },
        })
        const logged = describeErrorForLog(prismaKnownError)
        expect(logged.summary).toBe(
          "PrismaClientKnownRequestError P2002 [model User; target email, role] (message withheld: it can repeat the call's data)"
        )
      })

      it('includes only modelName when target is absent', () => {
        const prismaKnownError = new Prisma.PrismaClientKnownRequestError('Error on model', {
          code: 'P2025',
          clientVersion: '5.3.1',
          meta: { modelName: 'Delivery' },
        })
        const logged = describeErrorForLog(prismaKnownError)
        expect(logged.summary).toBe(
          "PrismaClientKnownRequestError P2025 [model Delivery] (message withheld: it can repeat the call's data)"
        )
      })

      it('includes only target when modelName is absent', () => {
        const prismaKnownError = new Prisma.PrismaClientKnownRequestError('Error on target', {
          code: 'P2002',
          clientVersion: '5.3.1',
          meta: { target: 'phone' },
        })
        const logged = describeErrorForLog(prismaKnownError)
        expect(logged.summary).toBe(
          "PrismaClientKnownRequestError P2002 [target phone] (message withheld: it can repeat the call's data)"
        )
      })

      it('never includes other meta fields (e.g. phone, customer name) in summary', () => {
        const phone = '+306912345678'
        const customerName = 'Maria Papadopoulou'
        const prismaKnownError = new Prisma.PrismaClientKnownRequestError('Violation', {
          code: 'P2002',
          clientVersion: '5.3.1',
          meta: {
            modelName: 'Delivery',
            target: 'phone',
            phone,
            customerName,
            queryData: { secret: 'hidden' },
          },
        })
        const logged = describeErrorForLog(prismaKnownError)
        expect(logged.summary).toBe(
          "PrismaClientKnownRequestError P2002 [model Delivery; target phone] (message withheld: it can repeat the call's data)"
        )
        expect(logged.summary).not.toContain(phone)
        expect(logged.summary).not.toContain(customerName)
        expect(logged.summary).not.toContain('secret')
        expect(logged.summary).not.toContain('hidden')
      })

      it('ignores non-string or non-string-array targets and non-string modelName without throwing', () => {
        const prismaKnownError = new Prisma.PrismaClientKnownRequestError('Odd meta', {
          code: 'P2002',
          clientVersion: '5.3.1',
          meta: {
            modelName: 12345,
            target: { complex: true },
          },
        })
        const logged = describeErrorForLog(prismaKnownError)
        expect(logged.summary).toBe(
          "PrismaClientKnownRequestError P2002 (message withheld: it can repeat the call's data)"
        )
      })
    })

    describe('Thrown Error whose name is not a string does not throw and is logged as "Error"', () => {
      it('handles Error with number name without throwing and logs as Error', () => {
        const err = new Error('Something broke')
        Object.defineProperty(err, 'name', { value: 42 })
        const logged = describeErrorForLog(err)
        expect(logged.summary).toBe('Error: Something broke')
      })

      it('handles Error with object name without throwing and logs as Error', () => {
        const err = new Error('Custom object name failure')
        Object.defineProperty(err, 'name', { value: { custom: true } })
        const logged = describeErrorForLog(err)
        expect(logged.summary).toBe('Error: Custom object name failure')
      })

      it('handles Error with undefined name without throwing and logs as Error', () => {
        const err = new Error('No name failure')
        Object.defineProperty(err, 'name', { value: undefined })
        const logged = describeErrorForLog(err)
        expect(logged.summary).toBe('Error: No name failure')
      })

      it('preserves code when name is not a string', () => {
        const err = Object.assign(new Error('Failure with code'), {
          code: 'FAIL_CODE',
        })
        Object.defineProperty(err, 'name', { value: 123 })
        const logged = describeErrorForLog(err)
        expect(logged.summary).toBe('Error FAIL_CODE: Failure with code')
      })
    })
  })
})
