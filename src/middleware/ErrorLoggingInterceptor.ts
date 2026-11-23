import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common'
import { Observable, throwError } from 'rxjs'
import { catchError } from 'rxjs/operators'
import { getLogger } from '../services/logger'
import { ApiException, PersonalDataWarningException } from '../errors'
import { isRecordNotFoundError } from '../prisma.util'
import { describeErrorForLog } from '../utils/errorForLog'
import winston from 'winston'

// The method and the route pattern (`/deliveries/:deliveryId`, never the URL with its ids), so a 404
// warning says where it came from without writing an id into the log (review of row 121).
function routeOf(context: ExecutionContext): string {
  if (context.getType() !== 'http') {
    return context.getType()
  }
  const request = context.switchToHttp().getRequest<{ method?: string; route?: { path?: string } }>()
  return `${request.method ?? ''} ${request.route?.path ?? '(no route)'}`
}

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
        // Spec 0053 (row 82 review): the personal data warning is an expected answer (the app then asks
        // Edit or Save anyway), not a fault. One info line with the route; the message is never the note.
        if (err instanceof PersonalDataWarningException) {
          this.logger.info(`Address note personal data warning: ${routeOf(context)}`)
          return throwError(() => err)
        }
        if (err instanceof Error && isRecordNotFoundError(err)) {
          this.logger.warn(`Endpoint answered 404 for a missing row: ${routeOf(context)} ${err.message}`)
          return throwError(() => err)
        }
        // Row 132: never the whole error, whose fields (a Prisma call's data) can name a customer.
        const { summary, stack } = describeErrorForLog(err)
        this.logger.error(`Endpoint returned error: ${routeOf(context)} ${summary}`, { stack })
        return throwError(() => err)
      })
    )
  }
}
