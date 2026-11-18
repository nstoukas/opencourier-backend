import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash, timingSafeEqual } from 'crypto'
import { TASK_RUNNER_SECRET } from '../../constants'
import { UnauthorizedException } from '../../errors'

// The header an outside task runner (Google Cloud Tasks, `integrations/gcpTask`) sends with each call.
export const TASK_RUNNER_SECRET_HEADER = 'x-task-secret'
export const TASK_RUNNER_REFUSAL = 'Only the task runner may call this'
// A shorter configured secret counts as unset (closed), so a placeholder like "x" is never a working credential.
export const TASK_RUNNER_SECRET_MIN_LENGTH = 32

// The configured secret as the guard uses it: trimmed (a header never carries surrounding spaces), and ''
// (closed) when unset or shorter than the minimum. Shared with the scheduler and the startup check.
export function usableTaskRunnerSecret(configured: string | undefined): string {
  const value = (configured ?? '').trim()
  return value.length < TASK_RUNNER_SECRET_MIN_LENGTH ? '' : value
}

// Says once, at startup, when a secret is set but too short, so the closed route is never a surprise.
export function warnIfTaskRunnerSecretTooShort(configured: string | undefined, logger: Logger): void {
  const value = (configured ?? '').trim()
  if (value !== '' && value.length < TASK_RUNNER_SECRET_MIN_LENGTH) {
    logger.warn(`${TASK_RUNNER_SECRET} is shorter than ${TASK_RUNNER_SECRET_MIN_LENGTH} characters: the tasks endpoint stays closed`)
  }
}

// Row 94: `POST api/tasks/v1/execute` runs any registered job handler by name (offer expiry, matching
// retries), so only the task runner may call it. It proves itself with a shared secret from the
// environment. No secret set means nobody may call it: closed by default, which is the co-op's case,
// since its jobs run in process through BullMQ and never come through this route.
// A guard is a class NestJS asks "may this request go on?" before the route runs (`canActivate`).
@Injectable()
export class TaskRunnerSecretGuard implements CanActivate {
  private readonly logger = new Logger(TaskRunnerSecretGuard.name)
  private warnedTooShort = false

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.configuredSecret()
    const request = context.switchToHttp().getRequest()
    const sent = request.headers?.[TASK_RUNNER_SECRET_HEADER]?.toString() ?? ''

    if (expected === '' || !sameSecret(sent, expected)) {
      throw new UnauthorizedException(TASK_RUNNER_REFUSAL)
    }
    return true
  }

  // The secret as configured, trimmed (a header value never carries surrounding spaces, so an untrimmed
  // one could never match). Too short counts as unset, with one warning that says so, never the value.
  private configuredSecret(): string {
    const value = (this.configService.get<string>(TASK_RUNNER_SECRET) ?? '').trim()
    if (value !== '' && value.length < TASK_RUNNER_SECRET_MIN_LENGTH) {
      if (!this.warnedTooShort) {
        this.logger.warn(
          `${TASK_RUNNER_SECRET} is shorter than ${TASK_RUNNER_SECRET_MIN_LENGTH} characters: the tasks endpoint stays closed`
        )
        this.warnedTooShort = true
      }
      return ''
    }
    return value
  }
}

// Compares in constant time, so the answer's timing never tells a caller how much of a guess was right,
// nor how long the secret is: both sides become SHA-256 digests of the same length first (review nit).
function sameSecret(sent: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(sent), digest(expected))
}
