import { ArgumentsHost, Catch, HttpException } from '@nestjs/common'
import { BaseExceptionFilter } from '@nestjs/core'
import { Response } from 'express'
import { ApiException, ErrorCode } from '../errors'
import { isRecordNotFoundError, isUniqueConstraintError } from '../prisma.util'
import { codeForSentence } from '../localization/error-sentences'
import { errorForConsole } from '../utils/errorForLog'
// The generated client's own error class (prisma/client), not the one in `@prisma/client/runtime/library`:
// the client ships its own copy of the runtime, so a class imported from the package never matches a real
// error and `@Catch` let every Prisma error through to Nest's default 500 (row 121). Prisma 5's
// `NotFoundError`, thrown by every `...OrThrow` read, is a subclass of it, so it is caught too.
import { Prisma } from '@prisma/types'

// Spec 0054 (AC-6): the specific codes this filter sends (from error-sentences.ts, or a coded sentence's
// own) are plain strings, keys of `server.error` in src/localization/en.ts, not members of the ErrorCode
// enum, so the Swagger type of `code` lists only the general ones.
// Codes too general to tell a person anything. When such a refusal carries one of the
// fixed sentences, its specific code replaces it. UNAUTHORIZED and FORBIDDEN are never replaced: the apps
// sign out on them.
const GENERIC_CODES: ReadonlySet<string> = new Set([
  ErrorCode.BAD_REQUEST,
  ErrorCode.NOT_FOUND,
  ErrorCode.NOT_ALLOWED,
  ErrorCode.UNKNOWN,
])

// `@Catch(...)` tells Nest which thrown classes this filter answers; anything else goes to Nest's default.
@Catch(ApiException, Prisma.PrismaClientKnownRequestError, HttpException)
export class HttpExceptionFilter extends BaseExceptionFilter {
  catch(exception: ApiException | Prisma.PrismaClientKnownRequestError | HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    if (exception instanceof ApiException) {
      // A sentence with values names its own code (DispatchStoppedError); a fixed sentence is looked up.
      const specific =
        exception.sentenceCode ?? (GENERIC_CODES.has(exception.code) ? codeForSentence(exception.message) : null)
      response.status(exception.getStatus()).json({
        code: specific ?? exception.code,
        message: exception.message,
        statusCode: exception.statusCode,
        ...(exception.params ? { params: exception.params } : {}),
      })
    } else if (exception instanceof HttpException && host.getType() !== 'http') {
      // Outside HTTP (none today), Nest's own handling, as before spec 0054 added HttpException here.
      super.catch(exception, host)
    } else if (exception instanceof HttpException) {
      // Nest's own exceptions (ConflictException('...') and the like): the same body Nest's default handler
      // sends, plus the specific code when the sentence is a known one (spec 0054, AC-6). A body that
      // already has a code (BoxOverCapacityException) keeps it.
      const status = exception.getStatus()
      const raw = exception.getResponse()
      const body: Record<string, unknown> = typeof raw === 'string' ? { statusCode: status, message: raw } : { ...raw }
      const code = body.code === undefined ? codeForSentence(body.message) : null
      response.status(status).json(code ? { ...body, code } : body)
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
      // Row 132: its name, code and frames, never the whole error (its message can repeat the call's data).
      console.log(`Unexpected database error: ${errorForConsole(exception)}`)
      response.status(500).json({
        code: ErrorCode.UNKNOWN,
        message: 'Internal server error',
        statusCode: 500,
      })
    }
  }
}
