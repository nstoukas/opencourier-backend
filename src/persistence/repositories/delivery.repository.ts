import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import {
  Delivery,
  EnumCancelledBy,
  EnumCourierCompensationReason,
  EnumDeliveryEventType,
  EnumFoodOutcome,
  EnumPartnerChargeReason,
  EnumDeliveryStatus,
  Location,
  Prisma,
  EnumRemovalRequestStatus,
} from '@prisma/types'

import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'
import { createPaginator } from '../../rest-api/Paginator'
import { IDeliveryRepository } from 'src/domains/delivery/interfaces/IDeliveryRepository'
import { DeliveryWhereArgs } from 'src/domains/delivery/types/delivery-where-args.type'
import { DeliveryWhereUniqueArgs } from 'src/domains/delivery/types/delivery-where-unique-args.type'
import { IDeliveryUpdate } from 'src/domains/delivery/interfaces/IDeliveryUpdate'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { IDeliveryCreateRow } from 'src/domains/delivery/interfaces/IDeliveryCreate'
import { heldBoxCountSql, heldBoxUnitsSql, liveDeliveryCountSql, siblingLegHeldSql } from './courier.repository'
import { MAX_DELIVERIES_HELD, StackStop, pairStillTogether } from 'src/domains/delivery/stack'
import { DELIVERY_ONGOING_STATUSES } from 'src/shared-types/stateMachine'
import { haversineDistanceInMetres } from 'src/core/utils/distance'
import { GeoPosition } from 'src/shared-types'
import { OrderLeg } from 'src/domains/delivery/legs'
import { wouldOverfillBox } from 'src/domains/delivery/box'
import { DeliveryWithLocationsEntity } from 'src/domains/delivery/entities/delivery-with-locations.entity'
import { HAND_OVER_EVENTS } from 'src/domains/partner/wait-record'
import { DeliveryQuoteEntity } from 'src/domains/delivery-quote/entities/delivery-quote.entity'

export type PrismaDeliveryWithLocations = Delivery & {
  pickupLocation: Location | null
  dropoffLocation: Location | null
}

// What a locked claim came to. TWO_HELD (spec 0048): the rider already holds two deliveries. JOB_CHANGED
// (row 81): an add on's claim found the rider's job no longer the one job they hold.
export type ClaimOutcome = 'CLAIMED' | 'NOT_WAITING' | 'BOX_FULL' | 'DEACTIVATED' | 'SIBLING_LEG' | 'TWO_HELD' | 'JOB_CHANGED'

// Spec 0048: one half of a stacked offer's claim, the delivery and what its offer writes.
export interface StackClaimPart {
  deliveryId: string
  data: IDeliveryUpdate
}

// Thrown inside a transaction only to roll it back (a stack claim or a group take that found only one
// of its two deliveries still waiting); never leaves this file.
class RollBack extends Error {}

@Injectable()
export class DeliveryRepository extends EntityRepository implements IDeliveryRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  async create(input: IDeliveryCreateRow) {
    const delivery = await this.prisma.delivery.create({
      data: input,
    })

    return this.toDomain(delivery)
  }

  async update(deliveryId: string, input: IDeliveryUpdate) {
    const delivery = await this.prisma.delivery.update({
      where: {
        id: deliveryId,
      },
      data: input,
    })

    return this.toDomain(delivery)
  }

  // A conditional write (spec 0002, "the race rule"): changes the delivery only if it still
  // matches `where` at the moment of writing, and says whether it did. Two paths racing for the
  // same offer (an accept and the expiry job, say) can then never both win: the database runs
  // the check and the write as one step, so exactly one of them gets 1 back.
  async updateIfMatches(
    deliveryId: string,
    where: Prisma.DeliveryWhereInput,
    data: IDeliveryUpdate
  ): Promise<boolean> {
    const result = await this.prisma.delivery.updateMany({
      where: { ...where, id: deliveryId },
      data,
    })

    return result.count === 1
  }

  // Spec 0043 (AC-5, cross check 2): an automatic offer's claim, kept within the rider's box. One
  // transaction: the rider's Courier row is locked first (as changeStatus does), so two claims for the
  // same rider run one after the other; then the units they hold are summed, and only if this
  // delivery still fits is the conditional write made. Two deliveries offered to one rider in the same
  // instant can therefore never overfill the box. 'NOT_WAITING': the delivery changed first.
  async claimOfferWithinBox(
    deliveryId: string,
    courierId: string,
    where: Prisma.DeliveryWhereInput,
    data: IDeliveryUpdate
  ): Promise<ClaimOutcome> {
    const claim = await this.claimForRiderWithinBox(deliveryId, courierId, where, data, false)
    return claim.outcome
  }

  // Row 81 (AC-6, AC-11): an add on offer's claim, the same locked claim as a single offer (deactivation,
  // legs, the limit of two, the box) plus one check under the same lock: the rider still holds `jobId`, and
  // nothing else. A job dropped off, handed back or moved between the plan and this write would leave the
  // offer naming a job the rider no longer has, so it answers JOB_CHANGED and writes nothing. `jobStatuses`
  // (review fix): the statuses the co-op's add on moment allows, so a job picked up between the plan and
  // this write also answers JOB_CHANGED under BEFORE_PICKUP or SAME_RESTAURANT.
  async claimAddOnWithinBox(
    deliveryId: string,
    courierId: string,
    jobId: string,
    jobStatuses: EnumDeliveryStatus[],
    where: Prisma.DeliveryWhereInput,
    data: IDeliveryUpdate
  ): Promise<ClaimOutcome> {
    const claim = await this.claimForRiderWithinBox(deliveryId, courierId, where, data, false, { jobId, jobStatuses })
    return claim.outcome
  }

  // The locked claim itself, shared by the automatic offer and the admin's hand offer (review fix:
  // the admin's check was a read before a separate write, so it could race a claim for the same
  // rider). `allowOverCapacity`: the admin confirmed going past a full box; the write then goes ahead
  // whatever the sum. Returns what the rider held and what the delivery takes, both measured under
  // the lock, so a confirmed override records the numbers that were true at the write. The write is
  // also conditional on the units read (review fix): a size change landing between the read and the
  // write makes it miss, instead of claiming a bigger order than the one checked.
  async claimForRiderWithinBox(
    deliveryId: string,
    courierId: string,
    where: Prisma.DeliveryWhereInput,
    data: IDeliveryUpdate,
    allowOverCapacity: boolean,
    // Row 81: set by an add on's claim only (claimAddOnWithinBox): the job and the statuses it may be in.
    addOnTo?: { jobId: string; jobStatuses: EnumDeliveryStatus[] }
  ): Promise<{
    outcome: ClaimOutcome
    heldUnits: number
    deliveryUnits: number
  }> {
    return this.prisma.$transaction(async (tx) => {
      // Spec 0051 (cross check 5 and 7): under the same lock a deactivation takes, so no offer or hand
      // offer reaches a rider whose account was deactivated, whichever matcher chose them (Static too).
      const locked = await tx.$queryRaw<Array<{ deactivated: boolean }>>`
        SELECT ("deactivatedAt" IS NOT NULL) AS "deactivated" FROM "Courier" WHERE "id" = ${courierId} FOR UPDATE
      `
      if (locked[0]?.deactivated) return { outcome: 'DEACTIVATED', heldUnits: 0, deliveryUnits: 0 }
      // Spec 0046 (AC-4, cross check 3): never two legs of one order to one rider at once, under the same
      // lock, so two legs offered to one rider in the same instant cannot both land. An admin's
      // confirmOverCapacity never bypasses it: one rider carrying the whole order is what legs exist to stop.
      const sibling = await tx.$queryRaw<Array<{ exists: boolean }>>(
        siblingLegHeldSql(Prisma.sql`${courierId}`, deliveryId)
      )
      if (sibling[0]?.exists) return { outcome: 'SIBLING_LEG', heldUnits: 0, deliveryUnits: 0 }
      // Spec 0048 (cross check 10): never a third delivery for one rider, under the same lock, and no confirm
      // passes it (a stack is the only way to two, and two is the most). This delivery itself is left out, so
      // re-offering it to a rider who already has its offer is not counted twice. Counted with the matchers'
      // own busy rule (review of row 80), so a rider the automatic matchers choose (busy with nothing) is never
      // refused here; only a rider named by hand or by the Static matcher can be.
      const count = await tx.$queryRaw<Array<{ held: number }>>(
        Prisma.sql`SELECT (${liveDeliveryCountSql(Prisma.sql`${courierId}`, deliveryId)}) AS "held"`
      )
      if ((count[0]?.held ?? 0) >= MAX_DELIVERIES_HELD) return { outcome: 'TWO_HELD', heldUnits: 0, deliveryUnits: 0 }
      if (addOnTo !== undefined) {
        // The one live delivery counted above must be this job, still the rider's and at a moment the co-op
        // allows (never past its drop off).
        const job = await tx.delivery.count({
          where: { id: addOnTo.jobId, courierId, status: { in: addOnTo.jobStatuses } },
        })
        if (job !== 1 || (count[0]?.held ?? 0) !== 1) return { outcome: 'JOB_CHANGED', heldUnits: 0, deliveryUnits: 0 }
      }
      const delivery = await tx.delivery.findUnique({ where: { id: deliveryId }, select: { boxUnits: true } })
      if (!delivery) return { outcome: 'NOT_WAITING', heldUnits: 0, deliveryUnits: 0 }
      const rows = await tx.$queryRaw<Array<{ held: number }>>(
        Prisma.sql`SELECT (${heldBoxUnitsSql(Prisma.sql`${courierId}`)}) AS "held"`
      )
      const heldUnits = rows[0]?.held ?? 0
      const deliveryUnits = delivery.boxUnits
      if (!allowOverCapacity && wouldOverfillBox(heldUnits, deliveryUnits)) {
        return { outcome: 'BOX_FULL', heldUnits, deliveryUnits }
      }
      const result = await tx.delivery.updateMany({
        where: { ...where, id: deliveryId, boxUnits: deliveryUnits },
        data,
      })
      return { outcome: result.count === 1 ? 'CLAIMED' : 'NOT_WAITING', heldUnits, deliveryUnits }
    })
  }

  // Spec 0048 (AC-4, AC-2): a stacked offer's claim, both deliveries or neither, in one transaction under the
  // rider's row lock (the same lock every claim takes). Checked under the lock: the rider is not
  // deactivated, holds no other delivery (a stack goes to a free rider, so the pair makes two at most), holds
  // no other leg of either order, and has room in the box for both. Then each delivery is written only if it
  // is still waiting with nobody offered and its size is the one read; if either write misses, both are
  // rolled back and the answer is NOT_WAITING.
  async claimStackWithinBox(courierId: string, first: StackClaimPart, second: StackClaimPart): Promise<ClaimOutcome> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ deactivated: boolean }>>`
          SELECT ("deactivatedAt" IS NOT NULL) AS "deactivated" FROM "Courier" WHERE "id" = ${courierId} FOR UPDATE
        `
        if (locked[0]?.deactivated) return 'DEACTIVATED'
        for (const part of [first, second]) {
          const sibling = await tx.$queryRaw<Array<{ exists: boolean }>>(
            siblingLegHeldSql(Prisma.sql`${courierId}`, part.deliveryId)
          )
          if (sibling[0]?.exists) return 'SIBLING_LEG'
        }
        const count = await tx.$queryRaw<Array<{ held: number }>>(
          Prisma.sql`SELECT (${heldBoxCountSql(Prisma.sql`${courierId}`)}) AS "held"`
        )
        if ((count[0]?.held ?? 0) + 2 > MAX_DELIVERIES_HELD) return 'TWO_HELD'
        const sizes = await tx.delivery.findMany({
          where: { id: { in: [first.deliveryId, second.deliveryId] } },
          select: { id: true, boxUnits: true },
        })
        const unitsOf = new Map(sizes.map((row) => [row.id, row.boxUnits]))
        const firstUnits = unitsOf.get(first.deliveryId)
        const secondUnits = unitsOf.get(second.deliveryId)
        if (firstUnits === undefined || secondUnits === undefined) return 'NOT_WAITING'
        const held = await tx.$queryRaw<Array<{ held: number }>>(
          Prisma.sql`SELECT (${heldBoxUnitsSql(Prisma.sql`${courierId}`)}) AS "held"`
        )
        if (wouldOverfillBox(held[0]?.held ?? 0, firstUnits + secondUnits)) return 'BOX_FULL'
        // `as const` keeps each pair typed as [part, units] (not a loose array of either), so the loop can unpack it.
        for (const [part, units] of [
          [first, firstUnits],
          [second, secondUnits],
        ] as const) {
          const written = await tx.delivery.updateMany({
            where: {
              id: part.deliveryId,
              status: EnumDeliveryStatus.ASSIGNING_COURIER,
              matchedCourierId: null,
              courierId: null,
              boxUnits: units,
            },
            data: part.data,
          })
          if (written.count !== 1) throw new RollBack()
        }
        return 'CLAIMED'
      })
    } catch (error) {
      if (error instanceof RollBack) return 'NOT_WAITING'
      throw error
    }
  }

  // Spec 0048 (AC-5, cross check 8): a rider's accept of a stack takes both deliveries in one conditional
  // write: still waiting for a rider, offered to this rider by this very offer, nobody has taken them. Only
  // if exactly two rows match is it kept; otherwise it is rolled back and false says nothing changed. Like
  // the single accept's take, it writes the rider and ends the deadline; the ACCEPTED events come after.
  async takeOfferGroup(groupId: string, courierId: string, offeredAt: Date | null): Promise<boolean> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const taken = await tx.delivery.updateMany({
          where: {
            offerGroupId: groupId,
            matchedCourierId: courierId,
            offeredAt,
            courierId: null,
            status: EnumDeliveryStatus.ASSIGNING_COURIER,
          },
          data: { courierId, offerExpiresAt: null },
        })
        if (taken.count !== MAX_DELIVERIES_HELD) throw new RollBack()
        return true
      })
    } catch (error) {
      if (error instanceof RollBack) return false
      throw error
    }
  }

  // Row 81 (AC-10): an add on was accepted. From here the two jobs are a pair like an accepted stack: one new
  // offerGroupId on both and the stop list on both, so the job screens, the route and the admin pages show
  // them together, and the stack rule (pairStillTogether) clears the list once they part. Only if the job is
  // still the rider's before its drop off; otherwise the added order goes on alone (its list cleared). A
  // fresh id rather than the job's old one: a job left over from an earlier stack may still carry that
  // pair's id (cross check 7), and three deliveries under one id would never count as a pair.
  // Row 146 review: answers the job's status as the transaction saw it (for the job's ADD_ON_JOINED record), or null
  // when the join rolled back. `EnumDeliveryStatus | null` reads "a status, or nothing".
  async joinAcceptedAddOn(
    addOnId: string,
    jobId: string,
    courierId: string,
    stops: StackStop[]
  ): Promise<EnumDeliveryStatus | null> {
    const groupId = randomUUID()
    // Copied into plain objects, the shape a Json column takes.
    const stopSequence = stops.map((stop) => ({ deliveryId: stop.deliveryId, stop: stop.stop }))
    try {
      return await this.prisma.$transaction(async (tx) => {
        const job = await tx.delivery.updateMany({
          where: { id: jobId, courierId, status: { in: DELIVERY_ONGOING_STATUSES } },
          data: { offerGroupId: groupId, stopSequence },
        })
        if (job.count !== 1) throw new RollBack()
        // agy review of row 146: the added order must still be ongoing too, like the job above. An add on cancelled
        // in the moment between its accept and this join keeps its courierId (spec 0015's pay reads it), so without
        // the status it would be grouped with the job, and the job would record ADD_ON_JOINED for a cancelled order.
        const addOn = await tx.delivery.updateMany({
          where: { id: addOnId, courierId, status: { in: DELIVERY_ONGOING_STATUSES } },
          data: { offerGroupId: groupId, stopSequence },
        })
        // agy review: the added order is no longer this rider's (moved by an admin in the moment since the
        // accept). Throwing inside an interactive transaction undoes every write it made, so the job does not
        // keep a group id that no other delivery shares, nor a stop list naming an order its rider lost.
        if (addOn.count !== 1) throw new RollBack()
        const joinedJob = await tx.delivery.findUniqueOrThrow({ where: { id: jobId }, select: { status: true } })
        return joinedJob.status
      })
    } catch (error) {
      if (!(error instanceof RollBack)) throw error
      // Not joined: the added order goes on alone, without the stop list that names the job.
      await this.prisma.delivery.updateMany({ where: { id: addOnId }, data: { stopSequence: Prisma.DbNull } })
      return null
    }
  }

  // Spec 0048: the deliveries of a stack still open for this rider by this offer (nobody has taken them),
  // the earlier created first, which is the order they are matched again in after a decline (cross check 9).
  async findOpenGroupMembers(groupId: string, courierId: string, offeredAt: Date | null): Promise<DeliveryEntity[]> {
    const rows = await this.prisma.delivery.findMany({
      where: {
        offerGroupId: groupId,
        matchedCourierId: courierId,
        offeredAt,
        courierId: null,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    return this.toDomainMany(rows)
  }

  // Row 128 (decision 128.6): the deliveries of a stack this rider has just taken by this offer
  // (takeOfferGroup wrote the rider on them) and that still wait for their ACCEPTED event. Read after the
  // take, so they are exactly the rows the take wrote, not the ones some earlier read happened to see.
  async findTakenGroupMembers(groupId: string, courierId: string, offeredAt: Date | null): Promise<DeliveryEntity[]> {
    const rows = await this.prisma.delivery.findMany({
      where: {
        offerGroupId: groupId,
        matchedCourierId: courierId,
        offeredAt,
        courierId,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    return this.toDomainMany(rows)
  }

  // Spec 0048 (AC-5): one delivery of an open stack left it some other way than the rider's answer (it was
  // cancelled, an admin moved or accepted it): the other keeps its offer as a single one, so the rider can
  // still take it alone. Only open, untaken offers are touched, so a group accept in progress (both taken)
  // is never split. Returns how many were released.
  async releaseOpenGroupPartners(groupId: string, exceptDeliveryId: string): Promise<number> {
    const released = await this.prisma.delivery.updateMany({
      where: {
        offerGroupId: groupId,
        id: { not: exceptDeliveryId },
        courierId: null,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
      },
      // Spec 0048 (cross check 6): alone now, so no stop sequence either.
      data: { offerGroupId: null, stopSequence: Prisma.DbNull },
    })
    return released.count
  }

  // Spec 0048 (cross check 6): the stop sequence of a stack holds only while both deliveries are with one
  // rider (pairStillTogether). Once they are not, it is cleared on every delivery of the group, so the
  // survivor goes on alone and no screen draws a stop the rider no longer has. Returns how many were
  // cleared (0 while the pair holds). `Prisma.DbNull` is how Prisma writes SQL NULL into a Json column:
  // a plain `null` there would be ambiguous with the JSON value null, so Prisma refuses it.
  async settleStopSequence(groupId: string): Promise<number> {
    const members = await this.prisma.delivery.findMany({
      where: { offerGroupId: groupId },
      select: { status: true, matchedCourierId: true, courierId: true },
    })
    if (pairStillTogether(members)) return 0
    const cleared = await this.prisma.delivery.updateMany({
      where: { offerGroupId: groupId, NOT: { stopSequence: { equals: Prisma.DbNull } } },
      data: { stopSequence: Prisma.DbNull },
    })
    return cleared.count
  }

  // Spec 0048 (AC-4, AC-2, cross check 4): deliveries that could be stacked with `delivery`: waiting for a
  // rider with nobody offered, with room for both in one box, not another leg of the same order, and either
  // from the same restaurant and pickup point, or (slice 2) marked ready while `delivery` is marked ready
  // too. With `near`, only those whose pickup is within the co-op's maxAssignmentDistance of the rider (the
  // second order's own distance filter, cross check 4), measured in a straight line as the matcher's
  // filter is. The one waiting longest first (its latest NO_COURIER_AVAILABLE, else its creation, as
  // findIdsWaitingForCourierOldestFirst counts). At most `limit`: each one costs a road table.
  async findStackPartnerCandidates(
    delivery: DeliveryEntity,
    maxUnits: number,
    limit: number,
    near?: { rider: GeoPosition; maxMetres: number | null }
  ): Promise<DeliveryEntity[]> {
    const places: Prisma.DeliveryWhereInput[] = []
    if (delivery.partnerId) places.push({ partnerId: delivery.partnerId, pickupLocationId: delivery.pickupLocationId })
    if (delivery.foodReadyAt !== null) places.push({ foodReadyAt: { not: null } })
    if (places.length === 0) return []
    const found = await this.prisma.delivery.findMany({
      where: {
        id: { not: delivery.id },
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: null,
        courierId: null,
        OR: places,
        boxUnits: { lte: maxUnits },
        // Never two legs of one order (spec 0046): the same restaurant and orderReference, as siblingLegHeldSql
        // compares them. A single delivery, or another restaurant's order with the same reference, is fine.
        ...(delivery.legCount !== null && delivery.orderReference && delivery.partnerId
          ? { NOT: { partnerId: delivery.partnerId, orderReference: delivery.orderReference, legCount: { not: null } } }
          : {}),
      },
      include: { pickupLocation: { select: { latitude: true, longitude: true } } },
    })
    // The pickup point is read only for the distance filter; the rest of the row is a plain delivery. The
    // distance is filtered here in JavaScript over every waiting row that matched: a handful at this co-op's
    // size. A city with hundreds waiting at once would move it into the SQL (PostGIS) instead.
    const rows = found
      .filter(({ pickupLocation }) => {
        if (!near || near.maxMetres === null) return true
        if (!pickupLocation) return false
        return (
          haversineDistanceInMetres(near.rider.latitude, near.rider.longitude, pickupLocation.latitude, pickupLocation.longitude) <=
          near.maxMetres
        )
      })
      .map(({ pickupLocation: _pickupLocation, ...row }) => row)
    if (rows.length === 0) return []
    const since = await this.findLatestNoCourierAvailableAt(rows.map((row) => row.id))
    return this.toDomainMany(rows)
      .map((row) => ({ row, since: since.get(row.id) ?? row.createdAt }))
      .sort((a, b) => a.since.getTime() - b.since.getTime())
      .slice(0, limit)
      .map(({ row }) => row)
  }

  // Spec 0048 (cross check 8): stack deliveries the rider took (courierId written by the group take) whose
  // ACCEPTED never landed, older than `before`, for the minute sweep to complete. Only offers still
  // standing (matchedCourierId is the taker), so an offer given back is never accepted by the sweep.
  async findTakenGroupMembersNotAccepted(before: Date): Promise<DeliveryEntity[]> {
    const rows = await this.prisma.delivery.findMany({
      where: {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        offerGroupId: { not: null },
        courierId: { not: null },
        updatedAt: { lt: before },
      },
      orderBy: { updatedAt: 'asc' },
      take: 50,
    })
    return this.toDomainMany(rows).filter((row) => row.matchedCourierId === row.courierId)
  }

  // Spec 0015, AC-10: cancellations from an ongoing status, cancelled between `from` and `to`, still
  // missing a piece of their settlement: the rider's award, its event, or a restaurant's charge.
  // Keyed on cancelledAt, not on status: a cancelled delivery can still move to FAILED.
  async findCancellationsToSettle(from: Date, to: Date, ongoing: EnumDeliveryStatus[]): Promise<string[]> {
    const rows = await this.prisma.delivery.findMany({
      where: {
        cancelledAt: { gte: from, lte: to },
        cancelledFromStatus: { in: ongoing },
        OR: [
          {
            courierId: { not: null },
            courierCompensations: { none: { reason: EnumCourierCompensationReason.CANCELLATION } },
          },
          {
            courierId: { not: null },
            deliveryEvent: { none: { type: EnumDeliveryEventType.COURIER_PAID_FOR_CANCELLATION } },
          },
          { cancelledBy: EnumCancelledBy.RESTAURANT, partnerId: { not: null }, partnerCharges: { none: { reason: EnumPartnerChargeReason.CANCELLATION } } },
        ],
      },
      select: { id: true },
      // Oldest first, so a backlog is worked through in order (row 32 review).
      orderBy: { cancelledAt: 'asc' },
      take: 200,
    })
    return rows.map((row) => row.id)
  }

  // Spec 0015: this rider's jobs cancelled since `since` from an ongoing status, newest first, with
  // the restaurant's location and the cancellation award (null until it is written). Any status
  // since (a cancelled delivery can still become FAILED).
  // `deliveryId` narrows it to one job, so a job older than the newest 20 is still found (agy review).
  async findCancelledJobsForCourier(
    courierId: string,
    since: Date,
    ongoing: EnumDeliveryStatus[],
    deliveryId?: string
  ) {
    return this.prisma.delivery.findMany({
      where: {
        courierId,
        cancelledAt: { gte: since },
        cancelledFromStatus: { in: ongoing },
        ...(deliveryId ? { id: deliveryId } : {}),
      },
      orderBy: { cancelledAt: 'desc' },
      take: 20,
      include: {
        pickupLocation: true,
        courierCompensations: { where: { reason: EnumCourierCompensationReason.CANCELLATION, courierId } },
        // Spec 0035 (decision 24.5): an approval after pickup for an unpaid reason, so no award will ever come.
        removalRequests: {
          where: { status: EnumRemovalRequestStatus.APPROVED, afterPickup: true, paidToRider: false, courierId },
          select: { id: true },
        },
      },
    })
  }

  // Spec 0033: deliveries with a wait still being paid. settleWaitPay clears waitPayOwedAt once every
  // piece is written, so a row here is one the sweep must finish.
  async findWaitPayToSettle(from: Date, to: Date): Promise<string[]> {
    const rows = await this.prisma.delivery.findMany({
      where: { waitPayOwedAt: { gte: from, lte: to } },
      select: { id: true },
      orderBy: { waitPayOwedAt: 'asc' },
      take: 200,
    })
    return rows.map((row) => row.id)
  }

  // Spec 0035 (AC-18): food returned between `from` and `to` still missing the trip's pay or its
  // event. A delivery whose computed amount is 0 stays listed, and the settle step does nothing.
  async findReturnTripsToSettle(from: Date, to: Date): Promise<string[]> {
    const rows = await this.prisma.delivery.findMany({
      where: {
        foodOutcome: EnumFoodOutcome.RETURNED,
        foodOutcomeAt: { gte: from, lte: to },
        OR: [
          { courierCompensations: { none: { reason: EnumCourierCompensationReason.RETURN_TRIP } } },
          { deliveryEvent: { none: { type: EnumDeliveryEventType.COURIER_PAID_FOR_RETURN_TRIP } } },
        ],
      },
      select: { id: true },
      orderBy: { foodOutcomeAt: 'asc' },
      take: 200,
    })
    return rows.map((row) => row.id)
  }

  // Spec 0046 (AC-4): the same question as the claim's, without the lock, for an admin path to answer
  // 409 before it writes anything (reassign, the hand offer's early check).
  async holdsSiblingLeg(courierId: string, deliveryId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ exists: boolean }>>(
      siblingLegHeldSql(Prisma.sql`${courierId}`, deliveryId)
    )
    return rows[0]?.exists === true
  }

  // Spec 0046 (AC-6, key invariants): every leg of one order, the legs sharing the restaurant and the
  // orderReference with legCount set, by leg number, with its status and rider.
  async findOrderLegs(partnerId: string, orderReference: string): Promise<OrderLeg[]> {
    const rows = await this.prisma.delivery.findMany({
      where: { partnerId, orderReference, legCount: { not: null } },
      select: {
        id: true,
        legNumber: true,
        legCount: true,
        status: true,
        courierId: true,
        courier: { select: { firstName: true, lastName: true } },
      },
      orderBy: { legNumber: 'asc' },
    })
    return rows.map((row) => ({
      id: row.id,
      legNumber: row.legNumber ?? 0,
      legCount: row.legCount ?? 0,
      status: row.status,
      courierId: row.courierId,
      courierName: row.courier ? `${row.courier.firstName} ${row.courier.lastName}`.trim() : null,
    }))
  }

  // Spec 0033: what the restaurant was charged for keeping riders waiting, oldest first.
  async findWaitCharges(deliveryId: string) {
    return this.prisma.partnerCharge.findMany({
      where: { deliveryId, reason: EnumPartnerChargeReason.WAITING },
      select: { amount: true, currencyCode: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
  }

  // Spec 0015: the restaurant's charge for this delivery's cancellation, or null.
  async findPartnerCharge(deliveryId: string) {
    return this.prisma.partnerCharge.findUnique({
      where: { cancellationOf: deliveryId },
      select: { amount: true, currencyCode: true, createdAt: true },
    })
  }

  // Every offer this rider currently holds: still looking for a rider, offered to them, and not
  // yet taken. Automatic and admin offers alike.
  async findOpenOffersForCourier(courierId: string): Promise<DeliveryEntity[]> {
    const deliveries = await this.prisma.delivery.findMany({
      where: {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        courierId: null,
      },
    })

    return this.toDomainMany(deliveries)
  }

  // Spec 0014. Every open offer (offered to a rider, not yet answered), and every delivery a rider
  // holds that is not yet picked up. A dispatch stop ends the first and returns the second.
  private static readonly OPEN_OFFER: Prisma.DeliveryWhereInput = {
    status: EnumDeliveryStatus.ASSIGNING_COURIER,
    matchedCourierId: { not: null },
    courierId: null,
  }
  private static readonly HELD_BEFORE_PICKUP: Prisma.DeliveryWhereInput = {
    status: {
      in: [
        EnumDeliveryStatus.ACCEPTED,
        EnumDeliveryStatus.DISPATCHED,
        EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
      ],
    },
    courierId: { not: null },
  }

  async findAllOpenOffers(): Promise<DeliveryEntity[]> {
    return this.toDomainMany(await this.prisma.delivery.findMany({ where: DeliveryRepository.OPEN_OFFER }))
  }

  async findAllHeldBeforePickup(): Promise<DeliveryEntity[]> {
    return this.toDomainMany(await this.prisma.delivery.findMany({ where: DeliveryRepository.HELD_BEFORE_PICKUP }))
  }

  // Two delivery counts, for the admin's preview before a stop (never a count per rider).
  async countOpenOffersAndHeldBeforePickup(): Promise<{ offersToEnd: number; deliveriesToReturn: number }> {
    const [offersToEnd, deliveriesToReturn] = await Promise.all([
      this.prisma.delivery.count({ where: DeliveryRepository.OPEN_OFFER }),
      this.prisma.delivery.count({ where: DeliveryRepository.HELD_BEFORE_PICKUP }),
    ])
    return { offersToEnd, deliveriesToReturn }
  }

  // Deliveries waiting for a rider with nobody offered, the longest waiting first. "Waiting since"
  // is the latest NO_COURIER_AVAILABLE event, which starts the current waiting spell; a delivery
  // with none (it was waiting before spec 0002 shipped) counts from when it was created.
  async findIdsWaitingForCourierOldestFirst(): Promise<string[]> {
    const waiting = await this.prisma.delivery.findMany({
      where: {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: null,
        courierId: null,
      },
      select: { id: true, createdAt: true },
    })
    if (waiting.length === 0) return []

    const waitingSince = await this.findLatestNoCourierAvailableAt(waiting.map((d) => d.id))

    return waiting
      .map((d) => ({ id: d.id, since: waitingSince.get(d.id) ?? d.createdAt }))
      .sort((a, b) => a.since.getTime() - b.since.getTime())
      .map((d) => d.id)
  }

  // deliveryId -> createdAt of that delivery's latest NO_COURIER_AVAILABLE event. Grouped by
  // delivery, never by rider: NO_COURIER_AVAILABLE names no rider (binding value 5).
  async findLatestNoCourierAvailableAt(deliveryIds: string[]): Promise<Map<string, Date>> {
    if (deliveryIds.length === 0) return new Map()

    const rows = await this.prisma.deliveryEvent.groupBy({
      by: ['deliveryId'],
      where: {
        deliveryId: { in: deliveryIds },
        type: EnumDeliveryEventType.NO_COURIER_AVAILABLE,
      },
      _max: { createdAt: true },
    })

    const result = new Map<string, Date>()
    for (const row of rows) {
      if (row._max.createdAt) result.set(row.deliveryId, row._max.createdAt)
    }
    return result
  }

  // Spec 0030: this restaurant's deliveries in the period that reached pickup and have a ready time,
  // with only the events the wait record reads. No courierId is selected, so no rider can leak.
  async findForWaitRecord(partnerId: string, since: Date) {
    const deliveries = await this.prisma.delivery.findMany({
      where: {
        partnerId,
        createdAt: { gte: since },
        readyAt: { not: null },
        deliveryEvent: { some: { type: EnumDeliveryEventType.PICKED_UP, transitionSuccessful: true } },
      },
      select: {
        id: true,
        createdAt: true,
        readyAt: true,
        foodReadyAt: true,
        deliveryEvent: {
          where: {
            transitionSuccessful: true,
            type: {
              in: [
                EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
                EnumDeliveryEventType.PICKED_UP,
                EnumDeliveryEventType.READY_DELAYED,
                ...HAND_OVER_EVENTS,
              ],
            },
          },
          select: { type: true, occurredAt: true },
        },
      },
    })
    return deliveries.map(({ deliveryEvent, ...delivery }) => ({ ...delivery, events: deliveryEvent }))
  }

  async findById(deliveryId: string, otherFilters?: DeliveryWhereArgs) {
    const delivery = await this.prisma.delivery.findUnique({
      where: {
        id: deliveryId,
        ...otherFilters,
      } as DeliveryWhereUniqueArgs,
    })

    return delivery ? this.toDomain(delivery) : null
  }

  async findByDeliveryQuoteId(deliveryQuoteId: string) {
    const delivery = await this.prisma.delivery.findUnique({
      where: {
        deliveryQuoteId: deliveryQuoteId,
      },
    })

    return delivery ? this.toDomain(delivery) : null
  }

  async findByIdOrThrow(deliveryId: string, otherFilters?: DeliveryWhereArgs) {
    const delivery = await this.prisma.delivery.findUniqueOrThrow({
      where: {
        id: deliveryId,
        ...otherFilters,
      } as DeliveryWhereUniqueArgs,
    })

    return this.toDomain(delivery)
  }

  // The delivery plus the quote it was priced from, for the admin price breakdown (spec 0001).
  async findByIdOrThrowWithQuote(deliveryId: string) {
    const delivery = await this.prisma.delivery.findUniqueOrThrow({
      where: { id: deliveryId },
      // The schema names the Delivery -> DeliveryQuote relation `delivery`; it is the quote.
      include: { delivery: true },
    })

    // Split the included quote off, so the delivery entity gets only its own columns.
    const { delivery: quote, ...deliveryFields } = delivery

    return { delivery: this.toDomain(deliveryFields), quote: new DeliveryQuoteEntity(quote) }
  }

  // What the offer card and its push are built from (spec 0003): the delivery, its drop off
  // location and its quote. Only buildOfferCardPayload reads this, and it reads only allowed fields.
  async findOfferCardSourceOrThrow(deliveryId: string) {
    const delivery = await this.prisma.delivery.findUniqueOrThrow({
      where: { id: deliveryId },
      // `delivery` is the schema's name for the Delivery -> DeliveryQuote relation; it is the quote.
      include: { pickupLocation: true, dropoffLocation: true, delivery: true },
    })

    return {
      delivery,
      pickupLocation: delivery.pickupLocation,
      dropoffLocation: delivery.dropoffLocation,
      quote: delivery.delivery,
    }
  }

  async findByIdOrThrowWithLocations(deliveryId: string, otherFilters?: DeliveryWhereArgs) {
    const delivery = await this.prisma.delivery.findUniqueOrThrow({
      where: {
        id: deliveryId,
        ...otherFilters,
      } as DeliveryWhereUniqueArgs,
      include: {
        pickupLocation: true,
        dropoffLocation: true,
      },
    })

    return new DeliveryWithLocationsEntity(delivery)
  }

  async findManyPaginated(args: DeliveryWhereArgs, page?: number, perPage?: number) {
    const paginator = createPaginator<Delivery, Prisma.DeliveryFindManyArgs, Prisma.DeliveryDelegate>()

    const result = await paginator(
      this.prisma.delivery,
      {
        where: {
          ...args,
        },
        orderBy: { createdAt: 'desc' },
        include: {
          pickupLocation: true,
          dropoffLocation: true,
        },
      },
      { page, perPage }
    )

    return {
      ...result,
      data: result.data.map((d) => new DeliveryWithLocationsEntity(d as PrismaDeliveryWithLocations)),
    }
  }

  private toDomain(data: Delivery) {
    return new DeliveryEntity(data)
  }

  private toDomainMany(data: Delivery[]) {
    return data.map((d) => this.toDomain(d))
  }
}
