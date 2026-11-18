import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { TaskBusService } from './taskBus.service'
import { EmptyResultDto } from '../../rest-api/common/dtos/empty.result.dto'
import { Public } from '../../decorators/public.decorator'
import { TaskName } from './models/TaskBusScheduler'
import { TaskRunnerSecretGuard } from './task-runner-secret.guard'

interface TaskExecuteInput {
  taskName: TaskName
  payload: any
}

@swagger.ApiExcludeController()
@common.Controller(`api/tasks/v1`)
export class TaskBusController {
  constructor(private readonly service: TaskBusService) {}

  // No login: the task runner has none. `@UseGuards` adds the shared secret check instead (row 94), so
  // the route is never open to anyone who can reach the backend.
  @Public()
  @common.UseGuards(TaskRunnerSecretGuard)
  @common.Post('execute')
  async execute(@common.Body() data: TaskExecuteInput): Promise<EmptyResultDto> {
    await this.service.executeTask(data.taskName, data.payload)
    return new EmptyResultDto()
  }
}
