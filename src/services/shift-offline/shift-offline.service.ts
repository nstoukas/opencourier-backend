import { ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common'
import { EnumCourierStatusChangeCause } from '@prisma/types'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import {
  FOLLOWED_UP_SHOWN_DAYS,
  OFFLINE_SWEEP_LOOKBACK_HOURS,
  offlineCountsMidShift,
} from 'src/domains/shift/shift-offline'
import { BullMQService } from 'src/integrations/bullMQ/bullMQ.service'
import { OfflineEventForAdmin, ShiftBookingRepository } from 'src/persistence/repositories/shift-booking.repository'
import { TaskBusService } from 'src/services/taskBus/taskBus.service'

// Every minute: record the Offline changes whose break limit has just passed (spec 0049, cross check 1).
// A repeatable job, like the dispatch stop tick: a one off job whose handler fails is never retried here,
// and a sweep finds every change, whichever of the five status writers made it.
const SHIFT_OFFLINE_SWEEP_JOB = 'shift-offline-sweep'
const EVERY_MINUTE = '* * * * *'

export const OFFLINE_EVENT_SENTENCES = {
  missing: 'This item is not on the list.',
  already: 'This item was already followed up.',
}

// Spec 0049 (row 79): going Offline during a booked shift. The record is for the rider and for an admin
// to check in with them in person. Nothing here counts, ranks or penalises it, and nothing that matches
// riders or pays them reads it (AC-7, value 5).
// `implements OnModuleInit` promises Nest an onModuleInit() method, which Nest calls once at startup.
@Injectable()
export class ShiftOfflineService implements OnModuleInit {
  private readonly logger = new Logger(ShiftOfflineService.name)

  constructor(
    private readonly bookings: ShiftBookingRepository,
    private readonly configDomainService: ConfigDomainService,
    private readonly bullMQService: BullMQService,
    private readonly taskBusService: TaskBusService
  ) {
    // When the tick comes due, BullMQProcessor hands it to the task bus by name, which calls this.
    this.taskBusService.registerTaskHandler(SHIFT_OFFLINE_SWEEP_JOB, async () => {
      await this.sweep(new Date())
    })
  }

  // Not awaited: with Redis down, startup must not wait for it.
  onModuleInit(): void {
    void this.schedule()
  }

  async schedule(): Promise<void> {
    try {
      await this.bullMQService.addRepeatableJob(SHIFT_OFFLINE_SWEEP_JOB, {}, EVERY_MINUTE)
    } catch (error) {
      this.logger.error(`Could not schedule the shift offline sweep: ${error}`)
    }
  }

  // Cross check 1: for each Offline change whose break limit has passed, an event if the rider is still
  // Offline then, a BOOKED booking covered the moment, and it was not in the shift's last 10 minutes.
  // Returns how many events it wrote (for tests and the log only; never stored).
  async sweep(now: Date): Promise<number> {
    const config = this.configDomainService.instanceConfig
    if (!(await config.getShiftsEnabled())) return 0
    const breakMs = (await config.getShiftBreakMinutes()) * 60_000
    const upTo = new Date(now.getTime() - breakMs)
    const from = new Date(upTo.getTime() - OFFLINE_SWEEP_LOOKBACK_HOURS * 3_600_000)
    let written = 0
    for (const change of await this.bookings.offlineChangesWithoutEvent(from, upTo)) {
      try {
        const breakEnds = new Date(change.createdAt.getTime() + breakMs)
        const [cameBackWithinBreak, booking] = await Promise.all([
          this.bookings.leftOfflineBetween(change.courierId, change.createdAt, breakEnds),
          this.bookings.bookedCovering(change.courierId, change.createdAt),
        ])
        if (!offlineCountsMidShift({ offlineAt: change.createdAt, booking, cameBackWithinBreak })) continue
        // Cross check 2: an admin's own change is already followed up by that admin; every other cause,
        // a cut off included, is open.
        const byAdmin = change.cause === EnumCourierStatusChangeCause.ADMIN && change.adminUserId !== null
        const created = await this.bookings.createOfflineEvent({
          shiftBookingId: (booking as { id: string }).id,
          courierId: change.courierId,
          courierStatusChangeId: change.id,
          cause: change.cause,
          offlineAt: change.createdAt,
          followedUpAt: byAdmin ? now : null,
          followedUpByUserId: byAdmin ? change.adminUserId : null,
        })
        if (created) written += 1
      } catch (error) {
        // One change failing must not stop the others; the next tick tries it again.
        this.logger.error(`Could not check status change ${change.id} for a shift offline record: ${error}`)
      }
    }
    return written
  }

  // AC-6, cross check 3: the open items, and the followed up ones for 7 days after their follow up.
  async adminList(now: Date): Promise<OfflineEventForAdmin[]> {
    const keepSince = new Date(now.getTime() - FOLLOWED_UP_SHOWN_DAYS * 86_400_000)
    return this.bookings.offlineEventsForAdmin(keepSince)
  }

  // AC-6: records the admin and the time; once only.
  async followUp(id: string, adminUserId: string, now: Date): Promise<void> {
    const outcome = await this.bookings.markFollowedUp(id, adminUserId, now)
    if (outcome === 'missing') throw new NotFoundException(OFFLINE_EVENT_SENTENCES.missing)
    if (outcome === 'already') throw new ConflictException(OFFLINE_EVENT_SENTENCES.already)
  }
}
