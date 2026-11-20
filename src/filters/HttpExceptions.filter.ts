import { ArgumentsHost, Catch } from '@nestjs/common'
import { BaseExceptionFilter } from '@nestjs/core'
import { Response } from 'express'
import { ApiException, ErrorCode } from '../errors'
import { isRecordNotFoundError, isUniqueConstraintError } from '../prisma.util'
// The generated client's own error class (prisma/client), not the one in `@prisma/client/runtime/library`:
// the client ships its own copy of the runtime, so a class imported from the package never matches a real
// error and `@Catch` let every Prisma error through to Nest's default 500 (row 121). Prisma 5's
// `NotFoundError`, thrown by every `...OrThrow` read, is a subclass of it, so it is caught too.
import { Prisma } from '@prisma/types'

// `@Catch(...)` tells Nest which thrown classes this filter answers; anything else goes to Nest's default.
@Catch(ApiException, Prisma.PrismaClientKnownRequestError)
export class HttpExceptionFilter extends BaseExceptionFilter {
  catch(exception: ApiException | Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    if (exception instanceof ApiException) {
      response.status(exception.getStatus()).json({
        code: exception.code,
        message: exception.message,
        statusCode: exception.statusCode,
      })
    } else if (isRecordNotFoundError(exception)) {
      response.status(404).json({
        code: ErrorCode.NOT_FOUND,
        message: 'Not found',
        statusCode: 404,
      })
    } else if (isUniqueConstraintError(exception)) {
      response.status(400).json({
        code: ErrorCode.UNIQUE_CONSTRAINT,
        message: 'Unique constraint',
        statusCode: 400,
      })
    } else {
      // Only an unexpected database error is printed here; ErrorLoggingInterceptor logs errors from the
      // handlers, so printing every exception (404s included) only doubled the noise (row 121).
      console.log(exception)
      response.status(500).json({
        code: ErrorCode.UNKNOWN,
        message: 'Internal server error',
        statusCode: 500,
      })
    }
  }
}
