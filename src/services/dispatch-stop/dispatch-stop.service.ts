import { ConflictException, Injectable, Logger, OnModuleInit } from '@nestjs/common'
import {
  DispatchStop,
  EnumCourierCompensationReason,
  EnumDispatchStopReason,
  EnumEventActor,
} from '@prisma/types'
import * as errors from 'src/errors'
import { DISPATCH_STOP_LOOKAHEAD_HOURS } from 'src/constants'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { resolveReassignmentPayout } from 'src/domains/delivery/utils/reassignment-payout.util'
import {
  LocalDateTime,
  athensToUtc,
  reasonWords,
  restaurantNextMessage,
  restaurantStoppedMessage,
  riderNextMessage,
  riderStoppedMessage,
} from 'src/domains/dispatch-stop/dispatch-stop-time'
import { BullMQService } from 'src/integrations/bullMQ/bullMQ.service'
import { CourierCompensationRepository } from 'src/persistence/repositories/courier-compensation.repository'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { DispatchStopRepository } from 'src/persistence/repositories/dispatch-stop.repository'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { TaskBusService } from 'src/services/taskBus/taskBus.service'

// Every minute: start the stops whose start passed, finish the ones whose end passed (spec 0014,
// AC-11). A repeatable job, because a one off job whose handler fails is never retried here.
const DISPATCH_STOP_TICK_JOB = 'dispatch-stop-tick'
const EVERY_MINUTE = '* * * * *'

// What a rider or a restaurant reads about a stop: never who created it (spec 0014, AC-10).
export type DispatchStopView = { reason: EnumDispatchStopReason; startsAt: Date; endsAt: Date | null; message: string }
export type DispatchState = { current: DispatchStopView | null; next: DispatchStopView | null }

// Stopping all dispatch for heat or a storm (spec 0014): creating, ending and cancelling stops, what
// riders and restaurants are told, and the work at a stop's start and end.
// `implements OnModuleInit` promises Nest an onModuleInit() method, which Nest calls once at startup.
@Injectable()
export class DispatchStopService implements OnModuleInit {
  private readonly logger = new Logger(DispatchStopService.name)

  constructor(
    private readonly dispatchStopRepository: DispatchStopRepository,
    private readonly deliveryRepository: DeliveryRepository,
    private readonly deliveryEventService: DeliveryEventService,
    private readonly courierCompensationRepository: CourierCompensationRepository,
    private readonly configDomainService: ConfigDomainService,
    private readonly bullMQService: BullMQService,
    private readonly taskBusService: TaskBusService
  ) {
    // When the tick comes due, BullMQProcessor hands it to the task bus by name, which calls this.
    this.taskBusService.registerTaskHandler(DISPATCH_STOP_TICK_JOB, async () => {
      await this.tick(new Date())
    })
  }

  // Not awaited, as the retention job: with Redis down, startup must not wait for it.
  onModuleInit(): void {
    void this.schedule()
  }

  async schedule(): Promise<void> {
    try {
      await this.bullMQService.addRepeatableJob(DISPATCH_STOP_TICK_JOB, {}, EVERY_MINUTE)
    } catch (error) {
      this.logger.error(`Could not schedule the dispatch stop tick: ${error}`)
    }
  }

  // Stop now (no start) or schedule (a start and an end), in Athens time (spec 0014, AC-1, AC-2).
  // Stop now runs the start work before answering.
  async create(
    input: { reason: EnumDispatchStopReason; startsOn?: LocalDateTime; endsOn?: LocalDateTime },
    adminUserId: string
  ): Promise<DispatchStop> {
    const now = new Date()
    const startsAt = input.startsOn ? this.toUtcOrRefuse(input.startsOn, 'start') : now
    const endsAt = input.endsOn ? this.toUtcOrRefuse(input.endsOn, 'end') : null

    if (input.startsOn) {
      if (startsAt <= now) throw new errors.BadRequestException('A scheduled stop must start in the future.')
      if (!endsAt) throw new errors.BadRequestException('A scheduled stop needs an end time.')
    }
    if (endsAt && endsAt <= startsAt) throw new errors.BadRequestException('The end must come after the start.')

    const stop = await this.dispatchStopRepository.createIfNoOverlap({
      reason: input.reason,
      startsAt,
      endsAt,
      createdByUserId: adminUserId,
    })
    if (!stop) {
      throw new ConflictException('Another dispatch stop already covers part of that time.')
    }
    this.logger.log(`Admin ${adminUserId} ${input.startsOn ? 'scheduled' : 'started'} dispatch stop ${stop.id}`)

    if (!input.startsOn) await this.startWork(stop, EnumEventActor.ADMIN)
    return (await this.dispatchStopRepository.findById(stop.id)) ?? stop
  }

  // Restart (a stop that is on) or cancel (one that has not started). A restart runs the end work
  // before answering (spec 0014, AC-3).
  async endOrCancel(id: string, adminUserId: string): Promise<DispatchStop> {
    const existing = await this.dispatchStopRepository.findById(id)
    if (!existing) throw new errors.NotFoundException('Dispatch stop not found')
    const stop = await this.dispatchStopRepository.endOrCancel(id, new Date(), adminUserId)
    if (!stop) throw new ConflictException('This dispatch stop has already ended or been cancelled.')
    this.logger.log(`Admin ${adminUserId} ${stop.cancelledAt ? 'cancelled' : 'ended'} dispatch stop ${id}`)
    if (stop.endedAt) await this.endWork(stop)
    // Read again, so the answer shows the end work as done.
    return (await this.dispatchStopRepository.findById(id)) ?? stop
  }

  // For the admin screen: the stop on, the scheduled ones, the record.
  async adminOverview(now: Date) {
    const [current, scheduled, history] = await Promise.all([
      this.dispatchStopRepository.findOn(now),
      this.dispatchStopRepository.findScheduled(now),
      this.dispatchStopRepository.findHistory(50),
    ])
    return { current, scheduled, history }
  }

  // The two delivery counts an admin sees before Stop now (never a count per rider).
  async preview() {
    return this.deliveryRepository.countOpenOffersAndHeldBeforePickup()
  }

  // What a rider or a restaurant is told: the stop on now, and the next one when it starts within
  // the lookahead (even while one is on).
  async state(audience: 'courier' | 'partner', now: Date): Promise<DispatchState> {
    const current = await this.dispatchStopRepository.findOn(now)
    const limit = new Date(now.getTime() + DISPATCH_STOP_LOOKAHEAD_HOURS * 3600 * 1000)
    const next = (await this.dispatchStopRepository.findScheduled(now)).find((stop) => stop.startsAt <= limit) ?? null
    const stopped = audience === 'courier' ? riderStoppedMessage : restaurantStoppedMessage
    const upcoming = audience === 'courier' ? riderNextMessage : restaurantNextMessage
    return {
      current: current ? this.view(current, stopped(current, now)) : null,
      next: next ? this.view(next, upcoming(next, now)) : null,
    }
  }

  // The minute tick: start work for stops whose start passed, end work for stops whose end passed.
  // Each runs once (`startedAt`, `endWorkDoneAt`), so a second tick or a server restart is harmless.
  async tick(now: Date): Promise<void> {
    try {
      for (const stop of await this.dispatchStopRepository.findDueToStart(now)) {
        await this.startWork(stop, EnumEventActor.SYSTEM)
      }
      for (const stop of await this.dispatchStopRepository.findDueToEnd(now)) {
        await this.endWork(stop)
      }
    } catch (error) {
      this.logger.error(`The dispatch stop tick failed: ${error}`, (error as Error).stack)
    }
  }

  // Start work (spec 0014, AC-5): first every open offer ends, then every delivery held before
  // pickup is read (after the offers ended, so an accept that landed meanwhile is included) and
  // returned to waiting, its rider paid by the co-op's reassignment setting.
  // The work runs first and is marked after, so a crash halfway is redone by the next tick; every
  // step is safe to run twice (row 29 review).
  async startWork(stop: DispatchStop, actor: EnumEventActor): Promise<void> {
    if (stop.startedAt) return
    const why = reasonWords(stop.reason)
    const ended = await this.deliveryEventService.endAllOpenOffersForDispatchStop(`Ended: dispatch stopped (${why})`)

    let returned = 0
    const held = await this.deliveryRepository.findAllHeldBeforePickup()
    for (const delivery of held) {
      if (await this.returnToWaiting(delivery.id, delivery.courierId, why, actor)) returned += 1
    }
    await this.dispatchStopRepository.markStarted(stop.id, new Date())
    this.logger.log(`Dispatch stop ${stop.id} started: ${ended} offers ended, ${returned} deliveries returned to waiting`)
  }

  // End work (spec 0014, AC-4): every waiting delivery gets an offer or a recorded "nobody free".
  async endWork(stop: DispatchStop): Promise<void> {
    if (stop.endWorkDoneAt) return
    // A stop ending while another starts right away: nothing to match yet (the other's end will).
    if (!(await this.dispatchStopRepository.findOn(new Date()))) {
      await this.deliveryEventService.matchAllWaitingDeliveriesAfterStop()
    }
    await this.dispatchStopRepository.markEndWorkDone(stop.id, new Date())
    this.logger.log(`Dispatch stop ${stop.id} ended: waiting deliveries matched again`)
  }

  // Returns one delivery to waiting, then pays its rider (decision 29.5: after, so a pickup that
  // wins the race is never paid as a return). Never throws; returns whether it was returned.
  private async returnToWaiting(
    deliveryId: string,
    courierId: string | null,
    why: string,
    actor: EnumEventActor
  ): Promise<boolean> {
    if (!courierId) return false
    let outcome: Awaited<ReturnType<DeliveryEventService['returnToWaitingForDispatchStop']>>
    try {
      outcome = await this.deliveryEventService.returnToWaitingForDispatchStop(
        deliveryId,
        courierId,
        actor,
        `Dispatch stopped (${why})`
      )
    } catch (error) {
      this.logger.error(`Returning delivery ${deliveryId} to waiting failed: ${error}`)
      return false
    }
    // Paid only when THIS call's write returned it: a second run, or a pickup that won, pays nothing.
    if (!outcome.returned) return false

    const logContext = { deliveryId, droppedCourierId: courierId }
    try {
      const menu = await this.configDomainService.instanceConfig.getReassignmentPayoutPolicies()
      const defaultPolicy = await this.configDomainService.instanceConfig.getReassignmentPayoutDefaultPolicy()
      const { policy, amount } = resolveReassignmentPayout(menu, defaultPolicy, undefined, outcome.totalCompensation)
      await this.courierCompensationRepository.create({
        amount,
        currencyCode: outcome.currencyCode,
        reason: EnumCourierCompensationReason.REASSIGNMENT,
        policy,
        message: `Dispatch stopped (${why}): delivery returned to waiting`,
        courierId,
        deliveryId,
      })
    } catch (error) {
      // Logged with what is needed to pay the rider by hand; the return itself stands.
      this.logger.error(
        `DISPATCH_STOP_PAYOUT_FAILED ${JSON.stringify(logContext)}: ${error}`,
        (error as Error).stack
      )
    }
    return true
  }

  private toUtcOrRefuse(local: LocalDateTime, which: 'start' | 'end'): Date {
    const utc = athensToUtc(local)
    if (!utc) throw new errors.BadRequestException(`The ${which} time does not exist in Athens time.`)
    return utc
  }

  private view(stop: DispatchStop, message: string): DispatchStopView {
    return { reason: stop.reason, startsAt: stop.startsAt, endsAt: stop.endedAt ?? stop.endsAt, message }
  }
}
