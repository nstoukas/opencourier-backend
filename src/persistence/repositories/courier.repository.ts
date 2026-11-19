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
      WHERE (
        "Delivery"."courierId" = "Courier"."id"
        AND "Delivery"."status"::text IN (${Prisma.join(DELIVERY_ONGOING_STATUSES, ',')})
      ) OR (
        "Delivery"."matchedCourierId" = "Courier"."id"
        AND "Delivery"."courierId" IS NULL
        AND "Delivery"."status"::text = ${EnumDeliveryStatus.ASSIGNING_COURIER}
      )
    `
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
