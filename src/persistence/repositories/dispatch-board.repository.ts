import { Injectable } from '@nestjs/common'
import { EnumCourierStatus, EnumDeliveryStatus, Prisma } from '@prisma/types'
import { DISPATCH_MAP_POSITION_MAX_AGE_MINUTES } from 'src/constants'
import { DELIVERY_ONGOING_STATUSES } from 'src/shared-types'
import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'
import { busyCourierDeliverySubQuery } from './courier.repository'

// Every field the board reads from a live delivery, and no more. `satisfies` checks the object
// against Prisma's type without widening it, so Prisma still knows exactly which fields come back.
const LIVE_DELIVERY_SELECT = {
  id: true,
  status: true,
  courierId: true,
  matchedCourierId: true,
  offeredAt: true,
  offerExpiresAt: true,
  orderReference: true,
  pickupBusinessName: true,
  dropoffName: true,
  dropoffBusinessName: true,
  createdAt: true,
  readyAt: true,
  foodReadyAt: true,
  promisedReadyAt: true,
  undispatchedAt: true,
  pickupLocation: { select: { latitude: true, longitude: true } },
  courier: { select: { firstName: true, lastName: true } },
} satisfies Prisma.DeliverySelect

export type LiveDelivery = Prisma.DeliveryGetPayload<{ select: typeof LIVE_DELIVERY_SELECT }>

// A rider who is working: ONLINE or LAST_CALL. latitude and longitude are null when the position is
// missing or too old for the map (spec 0034, AC-12); the age itself stays in this query.
export type WorkingCourier = {
  id: string
  name: string
  status: EnumCourierStatus
  busy: boolean
  latitude: number | null
  longitude: number | null
}

export type DeliveredToday = { deliveryId: string; occurredAt: Date; createdAt: Date }

// The reads behind the admin Dispatch board (spec 0034). Nothing here logs a position.
@Injectable()
export class DispatchBoardRepository extends EntityRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  // Everything still looking for a rider or being carried.
  async findLiveDeliveries(): Promise<LiveDelivery[]> {
    return this.prisma.delivery.findMany({
      where: { status: { in: [EnumDeliveryStatus.ASSIGNING_COURIER, ...DELIVERY_ONGOING_STATUSES] } },
      select: LIVE_DELIVERY_SELECT,
    })
  }

  // One query for the card and the map, using the matcher's own busy rule (AC-2). The time is
  // compared in the database, where it was written, so an age never has to leave this statement.
  async findWorkingCouriers(): Promise<WorkingCourier[]> {
    const fresh = Prisma.sql`"currentLocation" IS NOT NULL
      AND "currentLocationAt" >= (NOW() AT TIME ZONE 'UTC') - make_interval(mins => ${DISPATCH_MAP_POSITION_MAX_AGE_MINUTES}::int)`
    return this.prisma.$queryRaw<WorkingCourier[]>(Prisma.sql`
      SELECT
        "Courier"."id",
        "Courier"."firstName" || ' ' || "Courier"."lastName" AS "name",
        "Courier"."status"::text AS "status",
        EXISTS (${busyCourierDeliverySubQuery()}) AS "busy",
        CASE WHEN ${fresh} THEN ST_Y("currentLocation") END AS "latitude",
        CASE WHEN ${fresh} THEN ST_X("currentLocation") END AS "longitude"
      FROM "Courier"
      WHERE "Courier"."status"::text IN (${EnumCourierStatus.ONLINE}, ${EnumCourierStatus.LAST_CALL})
    `)
  }

  // Deliveries whose DROPPED_OFF happened in this period, one row each (AC-2).
  async findDroppedOffBetween(start: Date, end: Date): Promise<DeliveredToday[]> {
    const events = await this.prisma.deliveryEvent.findMany({
      where: {
        newStatus: EnumDeliveryStatus.DROPPED_OFF,
        transitionSuccessful: true,
        occurredAt: { gte: start, lt: end },
      },
      distinct: ['deliveryId'],
      select: { deliveryId: true, occurredAt: true, delivery: { select: { createdAt: true } } },
    })
    return events.map((event) => ({
      deliveryId: event.deliveryId,
      occurredAt: event.occurredAt,
      createdAt: event.delivery.createdAt,
    }))
  }
}
