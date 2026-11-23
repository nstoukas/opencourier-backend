import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common'
import { Response } from 'express'
import winston from 'winston'
import { getLogger } from '../services/logger'
import { describeErrorForLog } from '../utils/errorForLog'

// An error from the http-errors package (the one Express uses) carries its own status and a safe message;
// Nest's default handler answers with them, so this filter does too.
function httpErrorOf(error: unknown): { statusCode: number; message: string } | null {
  if (typeof error !== 'object' || error === null) {
    return null
  }
  const { statusCode, message } = error as { statusCode?: unknown; message?: unknown }
  return typeof statusCode === 'number' && typeof message === 'string' ? { statusCode, message } : null
}

// Row 132 (review blocker): every error HttpExceptionFilter does not catch (a Prisma validation error, an
// unknown request error, a plain Error from a guard) used to go to Nest's default handler, which logs the
// error's message and stack: for a Prisma validation error, the call's data, a recipient's name and phone
// among it. This filter answers exactly as that handler does and logs through describeErrorForLog instead.
// `@Catch()` with nothing inside means "every thrown value". It is registered before HttpExceptionFilter in
// main.ts: Nest tries global filters from the last registered to the first and uses the first that
// matches, so HttpExceptionFilter keeps everything it catches today and this one gets only the rest.
@Catch()
export class UnknownErrorsFilter implements ExceptionFilter {
  // Same reason as ErrorLoggingInterceptor: a logger made here, with its transports.
  private readonly logger: winston.Logger = getLogger('ExceptionsHandler')

  catch(exception: unknown, host: ArgumentsHost) {
    const { summary, stack } = describeErrorForLog(exception)
    this.logger.error(`Unhandled error: ${summary}`, { stack })
    // Outside HTTP (none today) there is no response to send.
    if (host.getType() !== 'http') {
      return
    }
    const response = host.switchToHttp().getResponse<Response>()
    const httpError = httpErrorOf(exception)
    const body = httpError ?? { statusCode: 500, message: 'Internal server error' }
    if (response.headersSent) {
      response.end()
      return
    }
    response.status(body.statusCode).json(body)
  }
}
