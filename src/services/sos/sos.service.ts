import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { EnumSosOutcome, SosIncident } from '@prisma/types'
import { INSTANCE_TIMEZONE } from 'src/constants'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { SOS_SENTENCES, sosPointRecordedAt } from 'src/domains/sos/sos-incident-state'
import { NotFoundException, SosClosedException, SosNotActiveException } from 'src/errors'
import { BullMQService } from 'src/integrations/bullMQ/bullMQ.service'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import {
  SosIncidentRepository,
  SosIncidentWithPeople,
} from 'src/persistence/repositories/sos-incident.repository'
import { TaskBusService } from 'src/services/taskBus/taskBus.service'

const RETENTION_JOB_NAME = 'sos-location-retention'
// Every day at 04:00 Volos time, like the saved customer retention job (spec 0022, AC-11).
const RETENTION_JOB_PATTERN = '0 4 * * *'
const DAY_MS = 24 * 60 * 60 * 1000
// The largest accuracy kept as sent; anything larger (or negative) is stored as unknown.
const MAX_ACCURACY_METRES = 100000

// A phone's accuracy estimate, or null when it is missing or makes no sense (row 73 review).
const usableAccuracy = (value: number | null | undefined): number | null =>
  typeof value === 'number' && value >= 0 && value <= MAX_ACCURACY_METRES ? value : null

export type SosPointInput = {
  latitude: number
  longitude: number
  accuracyMetres?: number | null
  // How long before sending the phone took this fix, in milliseconds.
  ageMs: number
}

// Spec 0022: a rider's SOS, from the 3 s hold to the admin's close, and the positions the phone
// shares only while it is active. Nothing in here changes a delivery, an assignment or pay (the busy
// rule lives in the matchers and the admin paths). No log line here names a coordinate (AC-13): only
// ids and counts.
// `implements OnModuleInit` promises Nest an onModuleInit() method, which Nest calls once at startup.
@Injectable()
export class SosService implements OnModuleInit {
  private readonly logger = new Logger(SosService.name)

  constructor(
    private readonly sosIncidentRepository: SosIncidentRepository,
    private readonly deliveryRepository: DeliveryRepository,
    private readonly configDomainService: ConfigDomainService,
    private readonly bullMQService: BullMQService,
    private readonly taskBusService: TaskBusService
  ) {
    // When the daily job comes due, BullMQProcessor hands it to the task bus by name, which calls this.
    this.taskBusService.registerTaskHandler(RETENTION_JOB_NAME, async () => {
      await this.deleteOldPoints(new Date())
    })
  }

  // Not awaited: with Redis down, startup must not wait for it (as the saved customer job does).
  onModuleInit(): void {
    void this.scheduleRetention()
  }

  // A fixed job id (the job's name), so every backend start adds the same one schedule.
  async scheduleRetention(): Promise<void> {
    try {
      await this.bullMQService.addRepeatableJob(RETENTION_JOB_NAME, {}, RETENTION_JOB_PATTERN, INSTANCE_TIMEZONE)
    } catch (error) {
      this.logger.error(`Could not schedule the SOS location retention job: ${error}`)
    }
  }

  // ---- The rider ----

  // AC-4: starts the rider's SOS, or returns it if this start (same clientId) or another active one
  // already exists. `startedAt` is the hold's time, from its age on the phone, never after arrival.
  async start(
    courierId: string,
    input: { clientId: string; deliveryId?: string; tapAgeMs?: number },
    receivedAt: Date
  ): Promise<SosIncident> {
    let deliveryId: string | null = null
    if (input.deliveryId !== undefined) {
      const delivery = await this.deliveryRepository.findById(input.deliveryId)
      // Another rider's job, or no such job: the same 404, so ids cannot be probed.
      if (!delivery || delivery.courierId !== courierId) {
        throw new NotFoundException(SOS_SENTENCES.deliveryNotYours)
      }
      deliveryId = delivery.id
    }
    const startedAt = new Date(receivedAt.getTime() - (input.tapAgeMs ?? 0))
    const { incident, created } = await this.sosIncidentRepository.startOrReturn({
      courierId,
      clientId: input.clientId,
      deliveryId,
      startedAt,
    })
    if (created) {
      this.logger.warn(`SOS ${incident.id} started by courier ${courierId}`)
    }
    return incident
  }

  async findActive(courierId: string): Promise<SosIncident | null> {
    return this.sosIncidentRepository.findActiveForCourier(courierId)
  }

  // AC-5, AC-6: stores the points of an active incident. 404 when it is not this rider's, 409
  // (SOS_NOT_ACTIVE) once it is no longer active: the phone then stops sharing.
  async addPoints(
    courierId: string,
    incidentId: string,
    points: SosPointInput[],
    receivedAt: Date
  ): Promise<{ accepted: number }> {
    const incident = await this.findOwnOrThrow(courierId, incidentId)
    const rows = points.map((point) => ({
      latitude: point.latitude,
      longitude: point.longitude,
      accuracyMetres: usableAccuracy(point.accuracyMetres),
      recordedAt: sosPointRecordedAt({ receivedAt, ageMs: point.ageMs, startedAt: incident.startedAt }),
    }))
    const accepted = await this.sosIncidentRepository.addPointsIfActive(incident.id, rows)
    if (accepted === null) {
      throw new SosNotActiveException()
    }
    return { accepted }
  }

  // AC-6: "I'm safe" or "False alarm". A repeat (or the other one after the first) answers the
  // incident as it is; a closed incident answers 409 (SOS_CLOSED). The time is the tap's, never
  // before the start and never after arrival.
  async endByRider(
    courierId: string,
    incidentId: string,
    how: 'safe' | 'falseAlarm',
    tapAgeMs: number | undefined,
    receivedAt: Date
  ): Promise<SosIncident> {
    const incident = await this.findOwnOrThrow(courierId, incidentId)
    if (incident.closedAt) {
      throw new SosClosedException()
    }
    if (incident.safeAt || incident.falseAlarmAt) {
      return incident
    }
    const at = sosPointRecordedAt({ receivedAt, ageMs: tapAgeMs ?? 0, startedAt: incident.startedAt })
    const field = how === 'safe' ? 'safeAt' : 'falseAlarmAt'
    const ended = await this.sosIncidentRepository.endByRiderIfActive(incident.id, field, at)
    const after = await this.sosIncidentRepository.findById(incident.id)
    if (!after) {
      throw new NotFoundException(SOS_SENTENCES.notFound)
    }
    // Lost a race with an admin's close: the close stands.
    if (!ended && after.closedAt) {
      throw new SosClosedException()
    }
    if (ended) {
      this.logger.log(`SOS ${incident.id}: courier ${courierId} said ${how === 'safe' ? 'safe' : 'false alarm'}`)
    }
    return after
  }

  // ---- Admins ----

  async listCurrent(): Promise<SosIncidentWithPeople[]> {
    return this.sosIncidentRepository.findCurrentWithPeople()
  }

  async listClosed(page: number, limit: number): Promise<{ data: SosIncidentWithPeople[]; total: number }> {
    return this.sosIncidentRepository.findClosedPageWithPeople(page, limit)
  }

  async findForAdmin(incidentId: string) {
    const incident = await this.sosIncidentRepository.findByIdWithPeople(incidentId)
    if (!incident) {
      throw new NotFoundException(SOS_SENTENCES.notFound)
    }
    const points = await this.sosIncidentRepository.findPoints(incident.id)
    return { incident, points }
  }

  // AC-10: closes an active or awaiting close incident with an outcome. Records who and when; if it
  // was still active the phone's next points answer 409 and it stops. Closed already: 409.
  async close(
    incidentId: string,
    adminUserId: string,
    input: { outcome: EnumSosOutcome; note?: string | null },
    now: Date
  ): Promise<SosIncidentWithPeople> {
    const existing = await this.sosIncidentRepository.findById(incidentId)
    if (!existing) {
      throw new NotFoundException(SOS_SENTENCES.notFound)
    }
    const note = input.note?.trim() ? input.note.trim() : null
    const closed = await this.sosIncidentRepository.closeIfOpen(incidentId, {
      closedAt: now,
      closedByUserId: adminUserId,
      outcome: input.outcome,
      note,
    })
    if (!closed) {
      throw new SosClosedException()
    }
    this.logger.log(`SOS ${incidentId} closed by user ${adminUserId}: ${input.outcome}`)
    const after = await this.sosIncidentRepository.findByIdWithPeople(incidentId)
    if (!after) {
      throw new NotFoundException(SOS_SENTENCES.notFound)
    }
    return after
  }

  // ---- Retention (AC-11) ----

  async deleteOldPoints(now: Date): Promise<number> {
    const days = await this.configDomainService.instanceConfig.getSosLocationRetentionDays()
    const cutoff = new Date(now.getTime() - days * DAY_MS)
    const count = await this.sosIncidentRepository.deleteOldPoints(cutoff, now)
    this.logger.log(`SOS location retention (${days} days): deleted the points of ${count} incident(s)`)
    return count
  }

  // A rider reaches only their own incidents: anyone else's is the same 404 as none at all.
  private async findOwnOrThrow(courierId: string, incidentId: string): Promise<SosIncident> {
    const incident = await this.sosIncidentRepository.findById(incidentId)
    if (!incident || incident.courierId !== courierId) {
      throw new NotFoundException(SOS_SENTENCES.notFound)
    }
    return incident
  }
}
