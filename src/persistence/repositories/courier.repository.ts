import { Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'crypto'
import {
  Courier,
  CourierSetting,
  EnumCourierDeliverySetting,
  EnumCourierStatus,
  EnumCourierStatusChangeCause,
  EnumDeliveryStatus,
  EnumUserRole,
  Prisma,
} from '@prisma/types'
import * as errors from 'src/errors'

import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'
import { ICourierRepository } from '../../domains/courier/interfaces/ICourierRepository'
import { ICourierCreateWithLogin } from '../../domains/courier/interfaces/ICourierCreateWithLogin'
import { CourierEntity } from '../../domains/courier/entities/courier.entity'
import { ICourierCreate } from '../../domains/courier/interfaces/ICourierCreate'
import { Exact } from '../../types'
import { createPaginator } from '../../rest-api/Paginator'
import { ICourierUpdate } from '../../domains/courier/interfaces/ICourierUpdate'
import { ICourierStatusChangeResult } from '../../domains/courier/interfaces/ICourierStatusChangeResult'
import { CourierSettingEntity } from 'src/domains/courier-setting/entities/courier-setting.entity'
import { ICourierUpdateLocation } from 'src/domains/courier/interfaces/ICourierUpdateLocation'
import { ICourierFindNearestArgs } from 'src/domains/courier/interfaces/ICourierFindNearestArgs'
import { ICourierFindBySeniorityArgs } from 'src/domains/courier/interfaces/ICourierFindBySeniorityArgs'
import { DELIVERY_ONGOING_STATUSES, GeoPosition } from 'src/shared-types'
import { DELIVERY_PICKED_UP_STATUSES } from 'src/shared-types/stateMachine'
import { BOX_HELD_STATUSES, RIDER_BOX_UNITS } from 'src/domains/delivery/box'
import { ACTIVE_SOS_WHERE } from 'src/domains/sos/sos-incident-state'

// A rider is busy, and gets no new offer, while any delivery of theirs is in one of
// DELIVERY_ONGOING_STATUSES (accepted, dispatched, arrived at pickup, picked up, on the way,
// arrived at drop off), or while they hold an open offer they have not answered yet (a delivery
// still ASSIGNING_COURIER whose matchedCourierId is them; scope row 61, decision 62.2). One moped,
// one job: without the second half, a rider coming free was offered every waiting delivery at once.
// Both matchers below use this one subquery, so the busy rule lives in exactly one place (scope
// row 62). It is correlated with the outer "Courier" row, so it only works inside a query that
// selects FROM "Courier".
export function busyCourierDeliverySubQuery(): Prisma.Sql {
  return Prisma.sql`
      SELECT 1
      FROM "Delivery"
      WHERE ${liveDeliveriesWhere(Prisma.sql`"Courier"."id"`)}
    `
}

// The busy rule above as a condition on "Delivery", for any rider: a job of theirs up to the drop off, or an
// open offer to them not answered yet. `riderId` is the rider's id as SQL (the outer "Courier"."id" in a
// matcher query, or a bound value for one rider). Spec 0048 (review of row 80): the limit of two deliveries
// per rider counts exactly these (liveDeliveryCountSql), so a rider the matchers call free is never refused
// by the limit. Food being taken back after a cancellation is not here: it fills the box (heldBoxDeliveriesWhere)
// but is no delivery for a customer, and the matchers do not count it either.
export function liveDeliveriesWhere(riderId: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(
        "Delivery"."courierId" = ${riderId}
        AND "Delivery"."status"::text IN (${Prisma.join(DELIVERY_ONGOING_STATUSES, ',')})
      ) OR (
        "Delivery"."matchedCourierId" = ${riderId}
        AND "Delivery"."courierId" IS NULL
        AND "Delivery"."status"::text = ${EnumDeliveryStatus.ASSIGNING_COURIER}
      )`
}

// Spec 0043 (cross check 3): how long after a cancellation a rider may still be carrying the food back
// (the cancelled jobs screen offers "I took it back" for the same 24 h). Past it, an outcome never
// recorded stops counting against their box.
export const RETURN_TRIP_HELD_HOURS = 24

// Spec 0043 (AC-5, cross check 3): the deliveries whose food is in, or on its way into, the rider's
// box: held from accept until drop off, an open offer to them, and food they are taking back after a
// cancellation (picked up, no outcome recorded yet). `riderId` is the rider's id as SQL: the outer
// "Courier"."id" inside a matcher query, or a bound value for one rider. One predicate for both, so
// the matcher and the claim can never disagree about what a rider holds.
export function heldBoxDeliveriesWhere(riderId: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(
        "Delivery"."courierId" = ${riderId}
        AND "Delivery"."status"::text IN (${Prisma.join(BOX_HELD_STATUSES, ',')})
      ) OR (
        "Delivery"."matchedCourierId" = ${riderId}
        -- agy review: an accept writes courierId first, while the status is still ASSIGNING_COURIER,
        -- and the status moves a moment later; counted in that moment too, or the box looks emptier.
        AND ("Delivery"."courierId" IS NULL OR "Delivery"."courierId" = ${riderId})
        AND "Delivery"."status"::text = ${EnumDeliveryStatus.ASSIGNING_COURIER}
      ) OR (
        "Delivery"."courierId" = ${riderId}
        -- A cancelled delivery can still be marked FAILED later; the food is in the box either way (review fix).
        AND "Delivery"."status"::text IN (${EnumDeliveryStatus.CANCELED}, ${EnumDeliveryStatus.FAILED})
        AND "Delivery"."cancelledFromStatus"::text IN (${Prisma.join(DELIVERY_PICKED_UP_STATUSES, ',')})
        AND "Delivery"."foodOutcome" IS NULL
        -- ::int: a bound number arrives as bigint, and make_interval takes only int (found live on dev).
        AND "Delivery"."cancelledAt" > NOW() - make_interval(hours => ${RETURN_TRIP_HELD_HOURS}::int)
      )`
}

// Spec 0046 (AC-4, cross check 3): whether the rider holds another leg of the same order as `deliveryId`
// (same restaurant and orderReference, both legs labelled), in the box sense of heldBoxDeliveriesWhere: an
// open offer, a job up to the drop off, or food being taken back. False for a single delivery. Each leg
// goes to a different rider at the same time; a rider who finished leg 1 may later carry leg 2.
export function siblingLegHeldSql(riderId: Prisma.Sql, deliveryId: string): Prisma.Sql {
  return Prisma.sql`SELECT EXISTS (
        SELECT 1
        FROM "Delivery" AS "target"
        JOIN "Delivery"
          ON "Delivery"."partnerId" = "target"."partnerId"
          AND "Delivery"."orderReference" = "target"."orderReference"
          AND "Delivery"."id" <> "target"."id"
          AND "Delivery"."legCount" IS NOT NULL
        WHERE "target"."id" = ${deliveryId}
          AND "target"."legCount" IS NOT NULL
          AND (${heldBoxDeliveriesWhere(riderId)})
      )`
}

// Spec 0046 (row 10 review): inside a matcher query, leaves out riders who hold another leg of the order
// `deliveryId` belongs to (correlated with the outer "Courier" row). Without it, a rider carrying a cancelled
// sibling's food back (held, but not busy) could be chosen again and again, and refused at every claim.
export function siblingLegCondition(deliveryId: string | undefined): Prisma.Sql {
  if (!deliveryId) return Prisma.empty
  return Prisma.sql`-- Not a rider holding another leg of this order (spec 0046, AC-4)
      AND NOT (${siblingLegHeldSql(Prisma.sql`"Courier"."id"`, deliveryId)})`
}

// The box units a rider holds, summed over heldBoxDeliveriesWhere. A whole number (SUM gives bigint).
export function heldBoxUnitsSql(riderId: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`SELECT COALESCE(SUM("Delivery"."boxUnits"), 0)::int FROM "Delivery" WHERE ${heldBoxDeliveriesWhere(
    riderId
  )}`
}

// Spec 0048 (key invariants, cross check 10): the limit of two. How many deliveries the rider has under the
// busy rule (liveDeliveriesWhere: jobs up to the drop off and open offers), leaving out `exceptDeliveryId`
// (the delivery being given, which may already be offered to them). A whole number.
export function liveDeliveryCountSql(riderId: Prisma.Sql, exceptDeliveryId?: string): Prisma.Sql {
  return Prisma.sql`SELECT COUNT(*)::int FROM "Delivery" WHERE (${liveDeliveriesWhere(riderId)})${
    exceptDeliveryId ? Prisma.sql` AND "Delivery"."id" <> ${exceptDeliveryId}` : Prisma.empty
  }`
}

// Spec 0048 (AC-4): how many deliveries the rider holds in the box sense of heldBoxDeliveriesWhere (open
// offers, jobs up to the drop off, food being taken back), leaving out `exceptDeliveryId`. Only a stack asks
// this: two orders together go only to a rider whose box holds nothing else. A whole number.
export function heldBoxCountSql(riderId: Prisma.Sql, exceptDeliveryId?: string): Prisma.Sql {
  return Prisma.sql`SELECT COUNT(*)::int FROM "Delivery" WHERE (${heldBoxDeliveriesWhere(riderId)})${
    exceptDeliveryId ? Prisma.sql` AND "Delivery"."id" <> ${exceptDeliveryId}` : Prisma.empty
  }`
}

// Spec 0043 (AC-5): inside a matcher query, keeps only riders with room for `deliveryUnits` more.
// Correlated with the outer "Courier" row. Empty when the matcher was not told the delivery's units.
export function boxRoomCondition(deliveryUnits: number | undefined): Prisma.Sql {
  if (deliveryUnits === undefined) return Prisma.empty
  return Prisma.sql`-- Room left in the box (spec 0043, AC-5)
      AND (${heldBoxUnitsSql(Prisma.sql`"Courier"."id"`)}) + ${deliveryUnits} <= ${RIDER_BOX_UNITS}`
}

// A rider with an active SOS (spec 0022, AC-7) is busy too: no matcher offers them anything until
// they say they are safe, say it was a false alarm, or an admin closes it. Kept beside the delivery
// rule rather than inside it, so each reads on its own. "Active" here must match ACTIVE_SOS_WHERE
// (src/domains/sos/sos-incident-state.ts). Correlated with the outer "Courier" row, like the one above.
export function activeSosCourierSubQuery(): Prisma.Sql {
  return Prisma.sql`
      SELECT 1
      FROM "SosIncident"
      WHERE "SosIncident"."courierId" = "Courier"."id"
        AND "SosIncident"."closedAt" IS NULL
        AND "SosIncident"."safeAt" IS NULL
        AND "SosIncident"."falseAlarmAt" IS NULL
    `
}

@Injectable()
export class CourierRepository extends EntityRepository implements ICourierRepository {
  private readonly logger = new Logger(CourierRepository.name)

  constructor(prisma: PrismaService) {
    super(prisma)
  }

  async create(data: Exact<ICourierCreate>) {
    const result = await this.prisma.courier.create({
      data: {
        userId: data.userId,
        firstName: data.firstName,
        lastName: data.lastName,
      },
    })

    return this.toDomain(result)
  }

  // A rider issued by an admin (spec 0013). One nested write: Prisma creates the User and the
  // Courier in a single implicit transaction, so either both exist or neither does, as
  // partner.repository's createWithLogin does for restaurants. Every other courier field takes the
  // schema default a self signed up rider got (status OFFLINE, delivery setting MANUAL).
  async createWithLogin(data: ICourierCreateWithLogin) {
    const user = await this.prisma.user.create({
      data: {
        email: data.login.email,
        password: data.login.hashedPassword,
        role: [EnumUserRole.COURIER],
        courier: {
          create: {
            firstName: data.firstName,
            lastName: data.lastName,
            phoneNumber: data.phoneNumber,
          },
        },
      },
      include: { courier: true },
    })

    if (!user.courier) {
      throw new errors.InternalServerError('Failed to create courier record')
    }
    return this.toDomain(user.courier)
  }

  async findByPhoneNumber(phoneNumber: string) {
    const result = await this.prisma.courier.findUnique({ where: { phoneNumber } })
    return result ? this.toDomain(result) : null
  }

  async updateById(courierId: string, data: ICourierUpdate) {
    // Spec 0040 (AC-1): `status` is not in ICourierUpdate, but a class with more fields (an admin request
    // body) still passes the type check, so it is dropped here too. Only changeStatus writes a status.
    const { status: _status, ...fields } = data as ICourierUpdate & { status?: unknown }
    const result = await this.prisma.courier.update({
      where: {
        id: courierId,
      },
      data: {
        ...fields,
      },
    })

    return this.toDomain(result)
  }

  // Spec 0038 (AC-14): the position is stored only while the rider is not Offline, or holds an active
  // delivery (the busy rule: an ongoing job or an open offer). One conditional statement, so a fix sent
  // in the same instant as the rider's Offline switch can never land after it. Returns whether it was
  // stored; false means the rider is Offline with no job, and nothing was written.
  async updateCurrentLocationById(courierId: string, data: ICourierUpdateLocation): Promise<boolean> {
    const { latitude, longitude } = data

    const coord = `POINT(${longitude} ${latitude})`
    const updated = await this.prisma.$executeRaw`
      UPDATE "Courier"
      SET "currentLocation" = ST_GeomFromText(${coord}, 4326),
          "currentLocationAt" = NOW() AT TIME ZONE 'UTC'
      WHERE "id" = ${courierId}
        AND ("status"::text <> ${EnumCourierStatus.OFFLINE} OR EXISTS (${busyCourierDeliverySubQuery()}))
    `
    return updated === 1
  }

  // Spec 0038 (AC-15): erases the stored position of an Offline rider who holds no active delivery. With
  // a rider's id, that rider only; without, every such rider, which is how a job ending clears its
  // rider without having to know which rider it was (one statement, idempotent, cheap: it only touches
  // Offline riders who still have a position).
  async clearLocationIfOfflineAndFree(courierId?: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "Courier"
      SET "currentLocation" = NULL, "currentLocationAt" = NULL
      WHERE "status"::text = ${EnumCourierStatus.OFFLINE}
        AND "currentLocation" IS NOT NULL
        AND NOT EXISTS (${busyCourierDeliverySubQuery()})
        ${courierId ? Prisma.sql`AND "id" = ${courierId}` : Prisma.empty}
    `
  }

  async getCurrentLocation(courierId: string) {
    const queryRaw = Prisma.sql`
      SELECT ST_AsGeoJSON("currentLocation") AS "currentLocation"
      FROM "Courier"
      WHERE "id" = ${courierId}
      LIMIT 1
    `

    const results = await this.prisma.$queryRaw<Array<{ currentLocation: string }>>(queryRaw)

    // A rider who never sent a location has none stored: that is "unknown", not an error (row 100
    // review: the offer push asks for it on every offer).
    if (results.length === 0 || !results[0] || !results[0].currentLocation) {
      return null
    }

    try {
      const courierLocation = JSON.parse(results[0].currentLocation)
      const coordinates = courierLocation.coordinates

      return {
        latitude: coordinates[1],
        longitude: coordinates[0],
      }
    } catch (e) {
      this.logger.error(`Error parsing courier location: ${e}`)
      return null
    }
  }

  // Spec 0040 (AC-1): the only writer of a rider's status. One transaction locks the courier row, writes
  // the status and, when it changed, one CourierStatusChange row, so the record and the status can never
  // disagree: a status write that fails writes no row, and a row that fails rolls the status back.
  // Offline always goes through the statement that erases the stored position when the rider holds no
  // job (spec 0038, AC-15), even when they already read as Offline, so a position left from before is
  // cleared too; a request that leaves the status as it was writes no row.
  async changeStatus(
    courierId: string,
    toStatus: EnumCourierStatus,
    cause: EnumCourierStatusChangeCause,
    adminUserId?: string | null
  ): Promise<ICourierStatusChangeResult> {
    // `$transaction` with a function: every query on `tx` runs in one database transaction, committed
    // when the function returns and rolled back if it throws.
    return this.prisma.$transaction(async (tx) => {
      // FOR UPDATE holds the row until the transaction ends, so two changes for one rider run one after
      // the other and each reads the status the other left.
      const rows = await tx.$queryRaw<Array<{ status: EnumCourierStatus }>>`
        SELECT "status"::text AS "status" FROM "Courier" WHERE "id" = ${courierId} FOR UPDATE
      `
      const fromStatus = rows[0]?.status
      if (!fromStatus) throw new errors.NotFoundException('Courier not found')

      if (toStatus === EnumCourierStatus.OFFLINE) {
        await tx.$executeRaw`
          UPDATE "Courier"
          SET "status" = CAST(${EnumCourierStatus.OFFLINE} AS "EnumCourierStatus"),
              "updatedAt" = NOW() AT TIME ZONE 'UTC',
              "currentLocation" = CASE WHEN EXISTS (${busyCourierDeliverySubQuery()}) THEN "currentLocation" ELSE NULL END,
              "currentLocationAt" = CASE WHEN EXISTS (${busyCourierDeliverySubQuery()}) THEN "currentLocationAt" ELSE NULL END
          WHERE "id" = ${courierId}
        `
      } else if (fromStatus !== toStatus) {
        await tx.courier.update({ where: { id: courierId }, data: { status: toStatus } })
      }

      if (fromStatus === toStatus) return { changed: false, fromStatus }

      // The id is a random UUID here; seeds use a cuid and the migration's rows `csc_start_<id>`. Only
      // uniqueness matters, so the three shapes are harmless.
      // clock_timestamp() is the moment this statement runs, after the lock above (NOW() would be the
      // transaction's start, which can come before a change that held the lock first). In UTC, as Prisma
      // stores every DateTime.
      await tx.$executeRaw`
        INSERT INTO "CourierStatusChange" ("id", "courierId", "fromStatus", "toStatus", "cause", "adminUserId", "createdAt")
        VALUES (
          ${randomUUID()},
          ${courierId},
          CAST(${fromStatus} AS "EnumCourierStatus"),
          CAST(${toStatus} AS "EnumCourierStatus"),
          CAST(${cause} AS "EnumCourierStatusChangeCause"),
          ${adminUserId ?? null},
          clock_timestamp() AT TIME ZONE 'UTC'
        )
      `
      return { changed: true, fromStatus }
    })
  }

  async updateDeliverySetting(courierId: string, deliverySetting: EnumCourierDeliverySetting) {
    const courier = await this.prisma.courier.findUniqueOrThrow({
      where: {
        id: courierId,
      },
    })

    if (courier.deliverySetting === deliverySetting) {
      return
    }

    await this.prisma.courier.update({
      where: {
        id: courierId,
      },
      data: {
        deliverySetting,
      },
    })
  }

  // The available riders nearest to a point, closest first, at most `limit`. Shared by the single
  // nearest rider and the shortlist the travel time matcher compares (spec 0031).
  private async nearestAvailableRows(args: ICourierFindNearestArgs, limit: number) {
    const { location, excludeCourierIds, maxDistanceInKM } = args

    const courierActiveStatuses = [EnumCourierStatus.ONLINE, EnumCourierStatus.LAST_CALL]

    const ongoingDeliveryRawSubQuery = busyCourierDeliverySubQuery()

    const locationGeographyPointSql = Prisma.sql`ST_SetSRID(ST_MakePoint(${location.longitude}, ${location.latitude}), 4326)::geography`

    const distanceRawSubQuery = Prisma.sql`ST_Distance(
      "currentLocation"::geography,
      ${locationGeographyPointSql}
    )`

    const maxDistanceInMeters = maxDistanceInKM ? maxDistanceInKM * 1000 : null

    const query = Prisma.sql`
      SELECT 
        "id",
        ST_AsGeoJSON("currentLocation") AS "currentLocation",
        ${distanceRawSubQuery} AS distance

      FROM "Courier"
      WHERE "currentLocation" IS NOT NULL
      -- Add the condition to check if the courier is available
      AND "status"::text in (${Prisma.join(courierActiveStatuses, ',')})
      AND NOT EXISTS (${ongoingDeliveryRawSubQuery})
      -- A rider in an active SOS is offered nothing (spec 0022, AC-7)
      AND NOT EXISTS (${activeSosCourierSubQuery()})
      -- A deactivated rider is never offered work (spec 0051, AC-2)
      AND "deactivatedAt" IS NULL
      ${boxRoomCondition(args.boxUnits)}
      ${siblingLegCondition(args.siblingOfDeliveryId)}

      -- Exclude courier ids
      ${
        excludeCourierIds && excludeCourierIds.length > 0
          ? Prisma.sql`AND "id" NOT IN(${Prisma.join(excludeCourierIds, ',')})`
          : Prisma.empty
      }

      -- Max distance condition
      ${maxDistanceInMeters ? Prisma.sql`AND ${distanceRawSubQuery} <= ${maxDistanceInMeters}` : Prisma.empty}

      -- Add bounding box for performance
      ${
        maxDistanceInMeters
          ? Prisma.sql`AND "currentLocation" && _ST_Expand(${locationGeographyPointSql}, ${maxDistanceInMeters})`
          : Prisma.empty
      }

      ORDER BY distance
      LIMIT ${limit}
    `

    return this.prisma.$queryRaw<Array<{ id: string; distance: number; currentLocation: string }>>(query)
  }

  // GeoJSON lists a point as [longitude, latitude], the same order getCurrentLocation reads.
  async findNearestAvailableCandidates(args: ICourierFindNearestArgs, limit: number) {
    const rows = await this.nearestAvailableRows(args, limit)
    return rows.map((row) => {
      const point = JSON.parse(row.currentLocation)
      return {
        courierId: row.id,
        distance: row.distance,
        courierLocation: { latitude: point.coordinates[1], longitude: point.coordinates[0] },
      }
    })
  }

  async findNearestAvailableCourier(args: ICourierFindNearestArgs) {
    const { location } = args
    const result = await this.nearestAvailableRows(args, 1)

    if (result.length === 0 || !result[0]) {
      return null
    }

    const courierId = result[0].id
    const distance = result[0].distance
    const currentLocation = JSON.parse(result[0].currentLocation)

    const courier = await this.prisma.courier.findUniqueOrThrow({
      where: {
        id: courierId,
      },
    })

    return {
      courier: this.toDomain(courier),
      distance,
      // GeoJSON lists a point as [longitude, latitude], the same order getCurrentLocation reads.
      courierLocation: {
        latitude: currentLocation.coordinates[1],
        longitude: currentLocation.coordinates[0],
      },
      pickupLocation: {
        latitude: location.latitude,
        longitude: location.longitude,
      },
    }
  }

  async findMostSeniorAvailableCourier(args: ICourierFindBySeniorityArgs) {
    const { location, excludeCourierIds, maxDistanceInKM } = args

    const courierActiveStatuses = [EnumCourierStatus.ONLINE, EnumCourierStatus.LAST_CALL]

    const ongoingDeliveryRawSubQuery = busyCourierDeliverySubQuery()

    const locationGeographyPointSql = Prisma.sql`ST_SetSRID(ST_MakePoint(${location.longitude}, ${location.latitude}), 4326)::geography`

    const distanceRawSubQuery = Prisma.sql`ST_Distance(
      "currentLocation"::geography,
      ${locationGeographyPointSql}
    )`

    const maxDistanceInMeters = maxDistanceInKM ? maxDistanceInKM * 1000 : null

    // Order the courier by seniority
    // Currently seniority is based on the created date of the courier
    const query = Prisma.sql`
      SELECT 
        "id",
        ST_AsGeoJSON("currentLocation") AS "currentLocation",
        ${distanceRawSubQuery} AS distance,
        "createdAt" as seniority

      FROM "Courier"
      WHERE "currentLocation" IS NOT NULL
      -- Add the condition to check if the courier is available
      AND "status"::text in (${Prisma.join(courierActiveStatuses, ',')})
      AND NOT EXISTS (${ongoingDeliveryRawSubQuery})
      -- A rider in an active SOS is offered nothing (spec 0022, AC-7)
      AND NOT EXISTS (${activeSosCourierSubQuery()})
      -- A deactivated rider is never offered work (spec 0051, AC-2)
      AND "deactivatedAt" IS NULL
      ${boxRoomCondition(args.boxUnits)}
      ${siblingLegCondition(args.siblingOfDeliveryId)}

      -- Exclude courier ids
      ${
        excludeCourierIds && excludeCourierIds.length > 0
          ? Prisma.sql`AND "id" NOT IN(${Prisma.join(excludeCourierIds, ',')})`
          : Prisma.empty
      }
      
      -- Max distance condition
      ${maxDistanceInMeters ? Prisma.sql`AND ${distanceRawSubQuery} <= ${maxDistanceInMeters}` : Prisma.empty}

      -- Add bounding box for performance
      ${
        maxDistanceInMeters
          ? Prisma.sql`AND "currentLocation" && _ST_Expand(${locationGeographyPointSql}, ${maxDistanceInMeters})`
          : Prisma.empty
      }

      -- Order by seniority
      ORDER BY seniority ASC

      LIMIT 1
    `

    const result = await this.prisma.$queryRaw<Array<{ id: string; distance: number; currentLocation: string }>>(query)

    if (result.length === 0 || !result[0]) {
      return null
    }

    const courierId = result[0].id
    const distance = result[0].distance
    const currentLocation = JSON.parse(result[0].currentLocation)

    const courier = await this.prisma.courier.findUniqueOrThrow({
      where: {
        id: courierId,
      },
    })

    return {
      courier: this.toDomain(courier),
      distance,
      // GeoJSON lists a point as [longitude, latitude], the same order getCurrentLocation reads.
      courierLocation: {
        latitude: currentLocation.coordinates[1],
        longitude: currentLocation.coordinates[0],
      },
      pickupLocation: {
        latitude: location.latitude,
        longitude: location.longitude,
      },
    }
  }

  async findManyPaginated(where: Prisma.CourierWhereInput, page?: number, perPage?: number) {
    const paginator = createPaginator<Courier, Prisma.CourierFindManyArgs, Prisma.CourierDelegate>()
    const result = await paginator(this.prisma.courier, { where, orderBy: { createdAt: 'desc' } }, { page, perPage })

    return {
      ...result,
      data: this.toDomainMany(result.data),
    }
  }

  // id -> "First Last" for the given couriers, for the admin Offer column (spec 0002). Unknown ids
  // are simply missing from the map.
  async findNamesByIds(courierIds: string[]): Promise<Map<string, string>> {
    if (courierIds.length === 0) return new Map()

    const rows = await this.prisma.courier.findMany({
      where: { id: { in: courierIds } },
      select: { id: true, firstName: true, lastName: true },
    })

    return new Map(rows.map((row) => [row.id, `${row.firstName} ${row.lastName}`]))
  }

  async findById(courierId: string) {
    const result = await this.prisma.courier.findUnique({
      where: {
        id: courierId,
      },
    })

    return result ? this.toDomain(result) : null
  }

  // Whether this rider has an active SOS (spec 0022, AC-7), for the admin paths that pick a rider by
  // hand. Same rule as activeSosCourierSubQuery above.
  // Spec 0043 (AC-6): the box units this rider holds now (heldBoxDeliveriesWhere). A plain read, for
  // the admin's check before an assignment; the automatic claim reads it under the rider's row lock.
  async heldBoxUnits(courierId: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ held: number }>>(
      Prisma.sql`SELECT (${heldBoxUnitsSql(Prisma.sql`${courierId}`)}) AS "held"`
    )
    return rows[0]?.held ?? 0
  }

  // Spec 0048 (cross check 10): how many deliveries count against this rider's limit of two (the busy rule,
  // liveDeliveriesWhere), besides `exceptDeliveryId`. A plain read for an admin path's early 409; the claim
  // counts again under the rider's row lock.
  async liveDeliveryCount(courierId: string, exceptDeliveryId?: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ held: number }>>(
      Prisma.sql`SELECT (${liveDeliveryCountSql(Prisma.sql`${courierId}`, exceptDeliveryId)}) AS "held"`
    )
    return rows[0]?.held ?? 0
  }

  // Spec 0048 (AC-4): how many deliveries this rider holds in the box sense, besides `exceptDeliveryId`, so a
  // stack goes only to a rider holding nothing else, food being taken back included.
  async heldDeliveryCount(courierId: string, exceptDeliveryId?: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ held: number }>>(
      Prisma.sql`SELECT (${heldBoxCountSql(Prisma.sql`${courierId}`, exceptDeliveryId)}) AS "held"`
    )
    return rows[0]?.held ?? 0
  }

  async hasActiveSos(courierId: string): Promise<boolean> {
    const incident = await this.prisma.sosIncident.findFirst({
      where: { courierId, ...ACTIVE_SOS_WHERE },
      select: { id: true },
    })
    return incident !== null
  }

  async findByIdOrThrow(courierId: string) {
    const result = await this.prisma.courier.findUniqueOrThrow({
      where: {
        id: courierId,
      },
    })

    return this.toDomain(result)
  }

  async findByIdWithSettings(courierId: string) {
    const result = await this.prisma.courier.findUniqueOrThrow({
      where: {
        id: courierId,
      },
      include: {
        settings: true,
      },
    })

    return {
      courier: this.toDomain(result),
      courierSettings: result.settings
        ? new CourierSettingEntity(result.settings as CourierSetting)
        : null,
    }
  }

  // Spec 0051 (AC-2): whether this user's rider account is deactivated. One small read, for the auth doors;
  // false for a user with no rider (an admin or a restaurant).
  async isUserDeactivated(userId: string): Promise<boolean> {
    const courier = await this.prisma.courier.findUnique({ where: { userId }, select: { deactivatedAt: true } })
    return courier?.deactivatedAt != null
  }

  // Spec 0051 (row 108 review): whether the rider is deactivated, read with FOR SHARE, which waits for a
  // deactivation that holds the rider's row lock to commit. The accept uses it after its take.
  async isDeactivatedWaitingForLock(courierId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ deactivated: boolean }>>`
      SELECT ("deactivatedAt" IS NOT NULL) AS "deactivated" FROM "Courier" WHERE "id" = ${courierId} FOR SHARE
    `
    return rows[0]?.deactivated === true
  }

  async findByUserId(userId: string) {
    const result = await this.prisma.courier.findUniqueOrThrow({
      where: {
        userId,
      },
    })

    const courierLocation = await this.getCurrentLocation(result.id)

    return this.toDomain({
      ...result,
      currentLocation: courierLocation,
    })
  }

  private toDomain(data: Courier & { currentLocation?: GeoPosition | null }) {
    return new CourierEntity(data)
  }

  private toDomainMany(data: Courier[]) {
    return data.map((d) => this.toDomain(d))
  }
}
