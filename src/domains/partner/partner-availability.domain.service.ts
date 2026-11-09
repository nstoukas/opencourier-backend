import { ConflictException, Injectable } from '@nestjs/common'
import { EnumPartnerAvailabilityAction, EnumUserRole } from '@prisma/types'
import { PartnerAvailabilityChangeRepository } from 'src/persistence/repositories/partner-availability-change.repository'
import { PartnerEntity } from './entities/partner.entity'
import { disabledSentence, pauseInForce } from './partner-availability'

const CHANGES_SHOWN = 50

// Who made a change: a restaurant's own sign in, or an admin.
export type AvailabilityActor = { role: EnumUserRole; userId: string }

// Spec 0029. Every method that changes something writes one record row through `applyChange`; a call
// that changes nothing answers the partner as it is and records nothing.
@Injectable()
export class PartnerAvailabilityDomainService {
  constructor(private readonly changeRepository: PartnerAvailabilityChangeRepository) {}

  // AC-1. Refused for a disabled restaurant (AC-6).
  async setBusy(partner: PartnerEntity, actor: AvailabilityActor, extraMinutes: number): Promise<PartnerEntity> {
    this.refuseIfDisabled(partner)
    if (partner.busyExtraMinutes === extraMinutes) return partner
    return this.changeRepository.applyChange(
      partner.id,
      { busyExtraMinutes: extraMinutes },
      { action: EnumPartnerAvailabilityAction.BUSY_ON, actorRole: actor.role, actorUserId: actor.userId, extraMinutes }
    )
  }

  async clearBusy(partner: PartnerEntity, actor: AvailabilityActor): Promise<PartnerEntity> {
    this.refuseIfDisabled(partner)
    if (partner.busyExtraMinutes === null) return partner
    return this.changeRepository.applyChange(
      partner.id,
      { busyExtraMinutes: null },
      { action: EnumPartnerAvailabilityAction.BUSY_OFF, actorRole: actor.role, actorUserId: actor.userId }
    )
  }

  // AC-3. Pausing again always resets the end and records a row.
  async pause(partner: PartnerEntity, actor: AvailabilityActor, minutes: number, now: Date): Promise<PartnerEntity> {
    this.refuseIfDisabled(partner)
    const pausedUntil = new Date(now.getTime() + minutes * 60_000)
    return this.changeRepository.applyChange(
      partner.id,
      { pausedUntil },
      { action: EnumPartnerAvailabilityAction.PAUSED, actorRole: actor.role, actorUserId: actor.userId, pausedUntil }
    )
  }

  async resume(partner: PartnerEntity, actor: AvailabilityActor, now: Date): Promise<PartnerEntity> {
    this.refuseIfDisabled(partner)
    if (!pauseInForce(partner.pausedUntil, now)) return partner
    return this.changeRepository.applyChange(
      partner.id,
      { pausedUntil: null },
      { action: EnumPartnerAvailabilityAction.RESUMED, actorRole: actor.role, actorUserId: actor.userId }
    )
  }

  // AC-5. An admin's act, with no check on the restaurant's state beyond "already so".
  async disable(partner: PartnerEntity, actor: AvailabilityActor, reason: string, now: Date): Promise<PartnerEntity> {
    if (partner.disabledAt) return partner
    return this.changeRepository.applyChange(
      partner.id,
      { disabledAt: now, disabledReason: reason },
      { action: EnumPartnerAvailabilityAction.DISABLED, actorRole: actor.role, actorUserId: actor.userId, reason }
    )
  }

  // Leaves any busy mode or pause as it was.
  async enable(partner: PartnerEntity, actor: AvailabilityActor): Promise<PartnerEntity> {
    if (!partner.disabledAt) return partner
    return this.changeRepository.applyChange(
      partner.id,
      { disabledAt: null, disabledReason: null },
      { action: EnumPartnerAvailabilityAction.ENABLED, actorRole: actor.role, actorUserId: actor.userId }
    )
  }

  async getChanges(partnerId: string) {
    return this.changeRepository.findLatest(partnerId, CHANGES_SHOWN)
  }

  private refuseIfDisabled(partner: PartnerEntity): void {
    if (partner.disabledAt) throw new ConflictException(disabledSentence(partner.disabledReason))
  }
}
