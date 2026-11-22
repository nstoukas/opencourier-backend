import { Injectable } from '@nestjs/common'
import { DeliveryRemovalRequest, EnumRemovalRequestStatus, Prisma, RemovalReason } from '@prisma/types'
import { isUniqueConstraintError } from 'src/prisma.util'
import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'
import { REMOVAL_REASON_SETTING_KEY, writeSettingChange } from './setting-change.repository'

// What the Dispatch board reads besides the request: the rider's name and the delivery (spec 0035, AC-6).
// `satisfies` checks the object against Prisma's type without widening it.
const BOARD_INCLUDE = {
  courier: { select: { firstName: true, lastName: true } },
  delivery: {
    select: {
      status: true,
      courierId: true,
      orderReference: true,
      pickupBusinessName: true,
      dropoffName: true,
      dropoffBusinessName: true,
    },
  },
} satisfies Prisma.DeliveryRemovalRequestInclude

export type OpenRemovalRequest = Prisma.DeliveryRemovalRequestGetPayload<{ include: typeof BOARD_INCLUDE }>

// What the admin's delivery page reads besides the request: the rider and who decided (AC-24).
const ADMIN_INCLUDE = {
  courier: { select: { firstName: true, lastName: true } },
  decidedBy: { select: { id: true, email: true, username: true } },
} satisfies Prisma.DeliveryRemovalRequestInclude

export type RemovalRequestForAdmin = Prisma.DeliveryRemovalRequestGetPayload<{ include: typeof ADMIN_INCLUDE }>

export type RemovalReasonInput = {
  label: string
  // Spec 0054 (AC-7): the Greek label; null clears it.
  labelEl?: string | null
  paidToRider?: boolean
  chargedToRestaurant?: boolean
  needsNote?: boolean
  position?: number
}

export type CreateRemovalRequestInput = {
  deliveryId: string
  courierId: string
  reasonId: string
  label: string
  // Spec 0054 (cross check 10): the reason's Greek label, copied with `label` (null or left out: none).
  labelEl?: string | null
  paidToRider: boolean
  chargedToRestaurant: boolean
  note: string | null
}

const ACTIVE_REASON = { removedAt: null } satisfies Prisma.RemovalReasonWhereInput

// What the settings record keeps of a reason (spec 0038, AC-12): the fields that decide what a rider
// sees and is paid. Its order and its note rule are left out, so editing only those records nothing.
// Spec 0054: the Greek label is what riders reading Greek see, so it is recorded too (`labelEl?` lets this
// compile before the generated client has the column).
function recordedReason(
  reason: Pick<RemovalReason, 'label' | 'paidToRider' | 'chargedToRestaurant'> & { labelEl?: string | null }
) {
  return {
    label: reason.label,
    labelEl: reason.labelEl ?? null,
    paidToRider: reason.paidToRider,
    chargedToRestaurant: reason.chargedToRestaurant,
  }
}

// Spec 0035: the co-op's reasons, and riders' requests to come off a delivery. Every status change
// is a conditional write on the status read, so a rider's withdraw, a second admin and the sweep
// can race safely: exactly one of them wins.
@Injectable()
export class RemovalRequestRepository extends EntityRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  // --- Reasons ------------------------------------------------------------------------------

  async findActiveReasons(): Promise<RemovalReason[]> {
    return this.prisma.removalReason.findMany({
      where: ACTIVE_REASON,
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    })
  }

  async findReasonById(id: string): Promise<RemovalReason | null> {
    return this.prisma.removalReason.findUnique({ where: { id } })
  }

  async countActiveReasons(): Promise<number> {
    return this.prisma.removalReason.count({ where: ACTIVE_REASON })
  }

  // A new reason goes last: the highest position plus one. The reason and its SettingChange row are
  // written in one transaction (spec 0038, AC-12); `changedByUserId` is the admin.
  async createReason(input: RemovalReasonInput, changedByUserId: string | null = null): Promise<RemovalReason> {
    return this.prisma.$transaction(async (tx) => {
      const highest = await tx.removalReason.aggregate({ _max: { position: true } })
      const reason = await tx.removalReason.create({
        data: { ...input, position: input.position ?? (highest._max.position ?? 0) + 1 },
      })
      await writeSettingChange(tx, {
        key: REMOVAL_REASON_SETTING_KEY,
        subject: reason.id,
        oldValue: null,
        newValue: recordedReason(reason),
        changedByUserId,
      })
      return reason
    })
  }

  // Only an active reason can be edited. Null when the reason is unknown or already removed. A
  // SettingChange is written, in the same transaction, only when the label or a pay flag moved.
  async updateActiveReason(
    id: string,
    input: Partial<RemovalReasonInput>,
    changedByUserId: string | null = null
  ): Promise<RemovalReason | null> {
    return this.prisma.$transaction(async (tx) => {
      const read = await tx.removalReason.findFirst({ where: { id, ...ACTIVE_REASON } })
      if (!read) return null
      // Conditional on the fields read, so a second admin's edit in between cannot leave a wrong "before".
      const updated = await tx.removalReason.updateMany({
        where: { id, ...ACTIVE_REASON, ...recordedReason(read) },
        data: input,
      })
      if (updated.count !== 1) return null
      const reason = await tx.removalReason.findUniqueOrThrow({ where: { id } })
      const before = recordedReason(read)
      const after = recordedReason(reason)
      if (
        before.label !== after.label ||
        before.labelEl !== after.labelEl ||
        before.paidToRider !== after.paidToRider ||
        before.chargedToRestaurant !== after.chargedToRestaurant
      ) {
        await writeSettingChange(tx, {
          key: REMOVAL_REASON_SETTING_KEY,
          subject: id,
          oldValue: before,
          newValue: after,
          changedByUserId,
        })
      }
      return reason
    })
  }

  // Soft delete: requests that used this reason keep their own copy of it.
  async removeActiveReason(id: string, changedByUserId: string | null = null): Promise<RemovalReason | null> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.removalReason.updateMany({
        where: { id, ...ACTIVE_REASON },
        data: { removedAt: new Date() },
      })
      if (updated.count !== 1) return null
      const reason = await tx.removalReason.findUniqueOrThrow({ where: { id } })
      await writeSettingChange(tx, {
        key: REMOVAL_REASON_SETTING_KEY,
        subject: id,
        oldValue: recordedReason(reason),
        newValue: null,
        changedByUserId,
      })
      return reason
    })
  }

  // --- Requests -----------------------------------------------------------------------------

  // Null when an open request already exists for the delivery (the unique `openFor` key).
  async createOpen(input: CreateRemovalRequestInput): Promise<DeliveryRemovalRequest | null> {
    try {
      return await this.prisma.deliveryRemovalRequest.create({
        data: { ...input, status: EnumRemovalRequestStatus.OPEN, openFor: input.deliveryId },
      })
    } catch (error) {
      if (error instanceof Error && isUniqueConstraintError(error)) return null
      throw error
    }
  }

  async findById(id: string): Promise<DeliveryRemovalRequest | null> {
    return this.prisma.deliveryRemovalRequest.findUnique({ where: { id } })
  }

  async findOpenForDelivery(deliveryId: string): Promise<DeliveryRemovalRequest | null> {
    return this.prisma.deliveryRemovalRequest.findUnique({ where: { openFor: deliveryId } })
  }

  // The approval that decides this rider's cancellation pay on this delivery, if any (AC-14). Only an
  // approval after pickup: an older approval by the same rider before pickup must not change it.
  async findApprovedAfterPickup(deliveryId: string, courierId: string): Promise<DeliveryRemovalRequest | null> {
    return this.prisma.deliveryRemovalRequest.findFirst({
      where: { deliveryId, courierId, status: EnumRemovalRequestStatus.APPROVED, afterPickup: true },
      orderBy: { decidedAt: 'desc' },
    })
  }

  // Each status change below is one write, conditional on the status it starts from. Each returns
  // whether THIS call made the change.
  async updateIfOpen(id: string, data: Prisma.DeliveryRemovalRequestUncheckedUpdateManyInput): Promise<boolean> {
    const updated = await this.prisma.deliveryRemovalRequest.updateMany({
      where: { id, status: EnumRemovalRequestStatus.OPEN },
      data,
    })
    return updated.count === 1
  }

  async updateIfApproved(id: string, data: Prisma.DeliveryRemovalRequestUncheckedUpdateManyInput): Promise<boolean> {
    const updated = await this.prisma.deliveryRemovalRequest.updateMany({
      where: { id, status: EnumRemovalRequestStatus.APPROVED },
      data,
    })
    return updated.count === 1
  }

  async closeIfOpen(id: string): Promise<boolean> {
    return this.updateIfOpen(id, { status: EnumRemovalRequestStatus.CLOSED, openFor: null })
  }

  // AC-12: whatever took the rider off or ended the delivery closes its open request, if any.
  async closeOpenForDelivery(deliveryId: string): Promise<void> {
    await this.prisma.deliveryRemovalRequest.updateMany({
      where: { openFor: deliveryId, status: EnumRemovalRequestStatus.OPEN },
      data: { status: EnumRemovalRequestStatus.CLOSED, openFor: null },
    })
  }

  // Set once: the award or its skip, and any charge, are done (AC-14).
  async markSettled(id: string): Promise<void> {
    await this.prisma.deliveryRemovalRequest.updateMany({
      where: { id, settledAt: null },
      data: { settledAt: new Date() },
    })
  }

  // Every open request, whatever the delivery's status, for the Dispatch board (AC-6).
  async findOpenForBoard(): Promise<OpenRemovalRequest[]> {
    return this.prisma.deliveryRemovalRequest.findMany({
      where: { status: EnumRemovalRequestStatus.OPEN },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: BOARD_INCLUDE,
    })
  }

  // Newest first, for the admin's delivery page (AC-24). Never summed or grouped by rider (AC-22).
  async findForDelivery(deliveryId: string): Promise<RemovalRequestForAdmin[]> {
    return this.prisma.deliveryRemovalRequest.findMany({
      where: { deliveryId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: ADMIN_INCLUDE,
    })
  }

  // This rider's requests on these deliveries, newest first: the job list keeps the newest of each.
  async findNewestByCourierForDeliveries(courierId: string, deliveryIds: string[]): Promise<DeliveryRemovalRequest[]> {
    if (deliveryIds.length === 0) return []
    return this.prisma.deliveryRemovalRequest.findMany({
      where: { courierId, deliveryId: { in: deliveryIds } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
  }

  // Approved but not settled, for the minute sweep (AC-18). Oldest first, so a backlog is worked in order.
  async findApprovedUnsettled(from: Date, to: Date): Promise<DeliveryRemovalRequest[]> {
    return this.prisma.deliveryRemovalRequest.findMany({
      where: { status: EnumRemovalRequestStatus.APPROVED, settledAt: null, decidedAt: { gte: from, lte: to } },
      orderBy: { decidedAt: 'asc' },
      take: 200,
    })
  }
}
