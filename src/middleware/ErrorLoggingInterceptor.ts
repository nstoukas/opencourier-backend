import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common'
import { Observable, throwError } from 'rxjs'
import { catchError } from 'rxjs/operators'
import { getLogger } from '../services/logger'
import { ApiException } from '../errors'
import { isRecordNotFoundError } from '../prisma.util'
import winston from 'winston'

// Without this interceptor a lot of logs do not end up in GCP Logging.
// The downside is that we need to filter out errors that aren't important, like retuning 404
// when there is no cart.
@Injectable()
export class ErrorLoggingInterceptor implements NestInterceptor {
  // Not injecting logger here using Nest because it injects logger without transports,
  // no idea why.
  logger: winston.Logger
  constructor() {
    this.logger = getLogger(ErrorLoggingInterceptor.name)
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      catchError((err) => {
        // An expected 404 (an id the caller sent that does not exist) is not an error to log with a stack:
        // any ApiException answering 404, not only NotFoundException (row 121). A Prisma "no such row"
        // also answers 404, but it may be a bug deeper down, so it leaves one warning line, no stack.
        if (err instanceof ApiException && err.getStatus() === 404) {
          return throwError(() => err)
        }
        if (err instanceof Error && isRecordNotFoundError(err)) {
          this.logger.warn(`Endpoint answered 404 for a missing row: ${err.message}`)
          return throwError(() => err)
        }
        this.logger.error('Endpoint returned error', err)
        return throwError(() => err)
      })
    )
  }
}
