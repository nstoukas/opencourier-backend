import { TaskBusService } from './taskBus.service'
import { Global, Logger, Module, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TaskBusController } from './taskBus.controller'
import { TASK_RUNNER_SECRET } from '../../constants'
import { warnIfTaskRunnerSecretTooShort } from './task-runner-secret.guard'

@Global()
@Module({
  controllers: [TaskBusController],
  providers: [TaskBusService],
  exports: [TaskBusService],
})
// OnModuleInit: NestJS calls onModuleInit once when the app starts, after this module is built.
export class TaskBusModule implements OnModuleInit {
  private readonly logger = new Logger(TaskBusModule.name)

  constructor(private readonly configService: ConfigService) {}

  // Row 94 (agy review): a task runner secret set too short is said at startup, not at the first call.
  onModuleInit() {
    warnIfTaskRunnerSecretTooShort(this.configService.get<string>(TASK_RUNNER_SECRET), this.logger)
  }
}
