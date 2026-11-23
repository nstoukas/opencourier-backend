import { describeErrorForLog, errorSummaryForLog } from '../../utils/errorForLog'
import { CloudTasksClient, protos } from '@google-cloud/tasks'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { GCP_LOCATION, GCP_PROJECT_NAME, PUBLIC_API_URL, TASK_RUNNER_SECRET } from '../../constants'
import { TASK_RUNNER_SECRET_HEADER, usableTaskRunnerSecret } from '../../services/taskBus/task-runner-secret.guard'
import { TaskBusScheduler } from '../../services/taskBus/models/TaskBusScheduler'

export const WEBHOOK_PATH = 'api/tasks/v1'
export const WEBHOOK_NAME = 'execute'

@Injectable()
export class GcpTaskScheduler extends TaskBusScheduler {
  private readonly logger = new Logger(GcpTaskScheduler.name)
  private readonly cloudTasksClient: CloudTasksClient

  constructor(private readonly configService: ConfigService) {
    super()
    this.cloudTasksClient = new CloudTasksClient()
  }

  async scheduleTask<T>(taskName: string, scheduleAt: Date, payload: T) {
    const URL = this.configService.get(PUBLIC_API_URL)
    const project = this.configService.get(GCP_PROJECT_NAME)
    const location = this.configService.get(GCP_LOCATION)
    const url = `${URL}/${WEBHOOK_PATH}/${WEBHOOK_NAME}`
    const gcpPayload = Object.assign({}, payload, { taskName }) // Handling GCP tasks requires including task name in payload

    const task: protos.google.cloud.tasks.v2.ITask = {
      httpRequest: {
        headers: {
          'Content-Type': 'application/json', // Set content type to ensure compatibility your application's request parsing
          // Row 94: the execute route refuses any call without the shared secret.
          // Trimmed like the guard reads it, so a secret mounted with a trailing newline still matches (agy review).
          [TASK_RUNNER_SECRET_HEADER]: usableTaskRunnerSecret(this.configService.get<string>(TASK_RUNNER_SECRET)),
        },
        httpMethod: 'POST',
        url,
        body: Buffer.from(JSON.stringify(gcpPayload)).toString('base64'),
      },
      scheduleTime: {
        seconds: Math.floor(scheduleAt.getTime() / 1000),
      },
    }

    const parent = this.cloudTasksClient.queuePath(project, location, taskName)
    const request = { parent: parent, task: task }

    // Never log the request: its headers carry the task runner's secret (row 94), its body a payload.
    this.logger.log(`Submitting task ${taskName} for ${scheduleAt.toISOString()}`)
    try {
      await this.cloudTasksClient.createTask(request)
    } catch (error) {
      this.logger.error(
        `Failed to schedule task ${taskName} for ${scheduleAt.toISOString()}: ${errorSummaryForLog(error)}`,
        describeErrorForLog(error).stack
      )
      throw error
    }
  }

  /** TODO: Implement task cancelation for gcp tasks. */
  cancelPendingTasks<T>(_taskName: string, _payload: T): Promise<void[]> {
    return Promise.all([])
  }
}
