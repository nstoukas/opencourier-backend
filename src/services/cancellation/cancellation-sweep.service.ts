import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { BullMQService } from 'src/integrations/bullMQ/bullMQ.service'
import { TaskBusService } from 'src/services/taskBus/taskBus.service'
import { DELIVERY_ONGOING_STATUSES } from 'src/shared-types/index'
import { RemovalRequestRepository } from 'src/persistence/repositories/removal-request.repository'
import { RemovalRequestService } from 'src/services/removal-request/removal-request.service'

// Spec 0015, AC-10. Every minute, completes the settlement of any cancellation still missing a piece
// (the rider's award, its event, a restaurant's charge): a write that failed when the job was
// cancelled is retried here until it exists. A repeatable job of its own, not a step in the dispatch
// stop tick, so neither can stop the other.
const CANCELLATION_SWEEP_JOB = 'cancellation-award-sweep'
const EVERY_MINUTE = '* * * * *'
const ONE_DAY_MS = 24 * 60 * 60 * 1000
// The inline settlement right after a cancel takes milliseconds; leaving the newest minute alone keeps
// the sweep from racing it to write the same event.
const LEAVE_THE_INLINE_STEP_MS = 60 * 1000

@Injectable()
export class CancellationSweepService implements OnModuleInit {
  private readonly logger = new Logger(CancellationSweepService.name)

  constructor(
    private readonly deliveryRepository: DeliveryRepository,
    private readonly deliveryEventService: DeliveryEventService,
    private readonly bullMQService: BullMQService,
    private readonly taskBusService: TaskBusService,
    // Spec 0035: the same minute job completes removals and return trips.
    private readonly removalRequestRepository: RemovalRequestRepository,
    private readonly removalRequestService: RemovalRequestService
  ) {
    this.taskBusService.registerTaskHandler(CANCELLATION_SWEEP_JOB, async () => {
      await this.sweep(new Date())
    })
  }

  // Not awaited: with Redis down, startup must not wait for it.
  onModuleInit(): void {
    void this.schedule()
  }

  async schedule(): Promise<void> {
    try {
      await this.bullMQService.addRepeatableJob(CANCELLATION_SWEEP_JOB, {}, EVERY_MINUTE)
    } catch (error) {
      this.logger.error(`Could not schedule the cancellation sweep: ${error}`)
    }
  }

  async sweep(now: Date): Promise<void> {
    await this.settleCancellations(now)
    await this.settleWaits(now)
    await this.settleRemovals(now)
    await this.settleReturnTrips(now)
  }

  // Spec 0035 (AC-18): an approval whose money is not all written, or an interrupted one.
  private async settleRemovals(now: Date): Promise<void> {
    let requests: Awaited<ReturnType<RemovalRequestRepository['findApprovedUnsettled']>>
    try {
      requests = await this.removalRequestRepository.findApprovedUnsettled(
        new Date(now.getTime() - ONE_DAY_MS),
        new Date(now.getTime() - LEAVE_THE_INLINE_STEP_MS)
      )
    } catch (error) {
      this.logger.error(`The removal sweep could not read: ${error}`)
      return
    }
    for (const request of requests) {
      try {
        await this.removalRequestService.sweepApprovedUnsettled(request, now)
      } catch (error) {
        this.logger.error(`The removal sweep failed on request ${request.id}: ${error}`)
      }
    }
  }

  // Spec 0035 (AC-16, AC-18): food brought back whose trip is not fully paid. settleReturnTrip never
  // throws, so one bad delivery cannot stop the others.
  private async settleReturnTrips(now: Date): Promise<void> {
    let ids: string[]
    try {
      ids = await this.deliveryRepository.findReturnTripsToSettle(
        new Date(now.getTime() - ONE_DAY_MS),
        new Date(now.getTime() - LEAVE_THE_INLINE_STEP_MS)
      )
    } catch (error) {
      this.logger.error(`The return trip sweep could not read: ${error}`)
      return
    }
    for (const id of ids) {
      await this.deliveryEventService.settleReturnTrip(id)
    }
  }

  // Spec 0033: the same retry for restaurant delay pay, on the same minute job.
  private async settleWaits(now: Date): Promise<void> {
    let ids: string[]
    try {
      ids = await this.deliveryRepository.findWaitPayToSettle(
        new Date(now.getTime() - ONE_DAY_MS),
        new Date(now.getTime() - LEAVE_THE_INLINE_STEP_MS)
      )
    } catch (error) {
      this.logger.error(`The wait pay sweep could not read: ${error}`)
      return
    }
    // settleWaitPay never throws, so one bad delivery cannot stop the others.
    for (const id of ids) {
      await this.deliveryEventService.settleWaitPay(id)
    }
  }

  private async settleCancellations(now: Date): Promise<void> {
    let ids: string[]
    try {
      ids = await this.deliveryRepository.findCancellationsToSettle(
        new Date(now.getTime() - ONE_DAY_MS),
        new Date(now.getTime() - LEAVE_THE_INLINE_STEP_MS),
        DELIVERY_ONGOING_STATUSES
      )
    } catch (error) {
      this.logger.error(`The cancellation sweep could not read: ${error}`)
      return
    }
    // One at a time, each on its own: settleCancellation never throws, and one bad delivery must not
    // stop the others.
    for (const id of ids) {
      try {
        await this.deliveryEventService.settleCancellation(id)
      } catch (error) {
        this.logger.error(`The cancellation sweep failed on delivery ${id}: ${error}`)
      }
    }
  }
}
