import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { timingSafeEqual } from 'crypto'
import { TASK_RUNNER_SECRET } from '../../constants'
import { UnauthorizedException } from '../../errors'

// The header an outside task runner (Google Cloud Tasks, `integrations/gcpTask`) sends with each call.
export const TASK_RUNNER_SECRET_HEADER = 'x-task-secret'
export const TASK_RUNNER_REFUSAL = 'Only the task runner may call this'

// Row 94: `POST api/tasks/v1/execute` runs any registered job handler by name (offer expiry, matching
// retries), so only the task runner may call it. It proves itself with a shared secret from the
// environment. No secret set means nobody may call it: closed by default, which is the co-op's case,
// since its jobs run in process through BullMQ and never come through this route.
// A guard is a class NestJS asks "may this request go on?" before the route runs (`canActivate`).
@Injectable()
export class TaskRunnerSecretGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.configService.get<string>(TASK_RUNNER_SECRET) ?? ''
    const request = context.switchToHttp().getRequest()
    const sent = request.headers?.[TASK_RUNNER_SECRET_HEADER]?.toString() ?? ''

    if (expected === '' || !sameSecret(sent, expected)) {
      throw new UnauthorizedException(TASK_RUNNER_REFUSAL)
    }
    return true
  }
}

// Compares in constant time, so the answer's timing never tells a caller how much of a guess was right.
function sameSecret(sent: string, expected: string): boolean {
  const a = Buffer.from(sent)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
