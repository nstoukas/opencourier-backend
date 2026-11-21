import {
  EnumCourierAccountChangeKind,
  EnumDeliveryStatus,
  EnumShiftBookingEventType,
  EnumShiftBookingStatus,
  EnumUserRole,
  Prisma,
} from '@prisma/types'
import { PrismaService } from 'src/services/prisma/prisma.service'
import { CourierAccountRepository } from './courier-account.repository'
import { activeSosCourierSubQuery, heldBoxDeliveriesWhere } from './courier.repository'

// Spec 0051 (row 108): deactivating and reactivating a rider, and the record of every account action.
// Written from the spec's acceptance criteria and its cross check, not from the code. No test here runs
// SQL against a database: the locked read is checked as text, and each outcome by the row it returns.
describe('CourierAccountRepository (spec 0051: AC-1, AC-3, AC-5, cross checks 1, 4, 5, 6, 8, 9, 10)', () => {
  const NOW = new Date('2026-11-21T10:00:00.000Z')
  const COURIER_ID = 'courier-volos-1'
  const USER_ID = 'user-volos-1'
  const ADMIN_ID = 'admin-user-1'

  let tx: {
    $queryRaw: jest.Mock
    courier: { update: jest.Mock }
    user: { update: jest.Mock; findUnique: jest.Mock }
    shiftBooking: { findMany: jest.Mock; update: jest.Mock }
    shiftBookingEvent: { create: jest.Mock }
    courierAccountChange: { create: jest.Mock; createMany: jest.Mock }
  }
  let prisma: {
    $transaction: jest.Mock
    courierAccountChange: { createMany: jest.Mock; findMany: jest.Mock }
    user: { findMany: jest.Mock }
  }
  let repository: CourierAccountRepository
  // Every write, in the order it happened, so a test can say what came before what.
  let writes: string[]

  // The row the locked read returns for a rider who can be deactivated.
  const freeRider = { userId: USER_ID, deactivated: false, inSos: false, holdsJob: false }

  // A tagged template call arrives as (strings, ...values); Prisma.sql puts it back together, nested
  // pieces included, so the whole statement can be read as text.
  const lockedQuery = (): Prisma.Sql => {
    const [strings, ...values] = tx.$queryRaw.mock.calls[0]
    return Prisma.sql(strings, ...values)
  }

  const expectNothingWritten = () => {
    expect(tx.courier.update).not.toHaveBeenCalled()
    expect(tx.user.update).not.toHaveBeenCalled()
    expect(tx.shiftBooking.update).not.toHaveBeenCalled()
    expect(tx.shiftBookingEvent.create).not.toHaveBeenCalled()
    expect(tx.courierAccountChange.create).not.toHaveBeenCalled()
    expect(tx.courierAccountChange.createMany).not.toHaveBeenCalled()
  }

  beforeEach(() => {
    writes = []
    const noting = (name: string) =>
      jest.fn().mockImplementation(async () => {
        writes.push(name)
        return {}
      })
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([freeRider]),
      courier: { update: noting('courier.update') },
      user: { update: noting('user.update'), findUnique: jest.fn().mockResolvedValue({ role: [EnumUserRole.COURIER] }) },
      shiftBooking: { findMany: jest.fn().mockResolvedValue([]), update: noting('shiftBooking.update') },
      shiftBookingEvent: { create: noting('shiftBookingEvent.create') },
      courierAccountChange: { create: noting('courierAccountChange.create'), createMany: noting('createMany') },
    }
    prisma = {
      $transaction: jest.fn().mockImplementation((work: (client: typeof tx) => unknown) => work(tx)),
      courierAccountChange: { createMany: jest.fn().mockResolvedValue({ count: 0 }), findMany: jest.fn() },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    }
    repository = new CourierAccountRepository(prisma as unknown as PrismaService)
  })

  describe('deactivate: the locked read (cross check 5)', () => {
    test("locks the rider's row FOR UPDATE and reads deactivated, in SOS and holds a job in that one statement", async () => {
      await repository.deactivate(COURIER_ID, ADMIN_ID, 'Left the co-op', NOW)

      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1)
      const query = lockedQuery()
      expect(query.sql).toContain('FROM "Courier"')
      expect(query.sql).toMatch(/WHERE "Courier"\."id" = \?\s+FOR UPDATE/)
      expect(query.values).toContain(COURIER_ID)
      expect(query.sql).toContain('("Courier"."deactivatedAt" IS NOT NULL) AS "deactivated"')
      expect(query.sql).toContain('AS "inSos"')
      expect(query.sql).toContain('AS "holdsJob"')
    })

    test('"in SOS" is the same active SOS rule matching uses', async () => {
      await repository.deactivate(COURIER_ID, ADMIN_ID, 'Left the co-op', NOW)
      expect(lockedQuery().sql).toContain(`EXISTS (${activeSosCourierSubQuery().sql}) AS "inSos"`)
    })

    test('"holds a job" is a delivery whose courierId is the rider, in every status from accepted to arrived at drop off, or a return trip', async () => {
      await repository.deactivate(COURIER_ID, ADMIN_ID, 'Left the co-op', NOW)

      const query = lockedQuery()
      // The box model's one rule for what a rider holds, for the locked rider...
      expect(query.sql).toContain(heldBoxDeliveriesWhere(Prisma.sql`"Courier"."id"`).sql)
      // ...limited to deliveries the rider really holds: an open offer alone does not block (cross check 6).
      expect(query.sql).toMatch(/\)\s+AND "Delivery"\."courierId" = "Courier"\."id"\s+\) AS "holdsJob"/)
      for (const status of [
        EnumDeliveryStatus.ACCEPTED,
        EnumDeliveryStatus.DISPATCHED,
        EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
        EnumDeliveryStatus.PICKED_UP,
        EnumDeliveryStatus.ON_THE_WAY,
        EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
      ]) {
        expect(query.values).toContain(status)
      }
      // A return trip in progress: cancelled after pick up, no food outcome recorded yet.
      expect(query.values).toContain(EnumDeliveryStatus.CANCELED)
      expect(query.sql).toContain('"Delivery"."foodOutcome" IS NULL')
    })

    test('the read comes before every write, all inside the one transaction', async () => {
      tx.$queryRaw.mockImplementation(async () => {
        writes.push('locked read')
        return [freeRider]
      })
      tx.shiftBooking.findMany.mockResolvedValue([{ id: 'booking-1' }])

      await repository.deactivate(COURIER_ID, ADMIN_ID, 'Left the co-op', NOW)

      expect(writes[0]).toBe('locked read')
      expect(writes).toEqual([
        'locked read',
        'courier.update',
        'user.update',
        'shiftBooking.update',
        'shiftBookingEvent.create',
        'courierAccountChange.create',
      ])
      // Nothing went around the transaction.
      expect(prisma.courierAccountChange.createMany).not.toHaveBeenCalled()
    })
  })

  describe('deactivate: refusals write nothing (AC-1, cross checks 1, 5, 8)', () => {
    test('MISSING when there is no such rider', async () => {
      tx.$queryRaw.mockResolvedValue([])
      await expect(repository.deactivate('no-such-rider', ADMIN_ID, 'Left', NOW)).resolves.toEqual({
        outcome: 'MISSING',
      })
      expectNothingWritten()
    })

    test('ALREADY when the rider is already deactivated', async () => {
      tx.$queryRaw.mockResolvedValue([{ ...freeRider, deactivated: true }])
      await expect(repository.deactivate(COURIER_ID, ADMIN_ID, 'Left', NOW)).resolves.toEqual({ outcome: 'ALREADY' })
      expectNothingWritten()
    })

    test('IS_ADMIN when the same login is also an admin (cross check 8)', async () => {
      tx.user.findUnique.mockResolvedValue({ role: [EnumUserRole.COURIER, EnumUserRole.ADMIN] })
      await expect(repository.deactivate(COURIER_ID, ADMIN_ID, 'Left', NOW)).resolves.toEqual({ outcome: 'IS_ADMIN' })
      expect(tx.user.findUnique).toHaveBeenCalledWith({ where: { id: USER_ID }, select: { role: true } })
      expectNothingWritten()
    })

    test('IN_SOS while the rider has an active SOS (cross check 1)', async () => {
      tx.$queryRaw.mockResolvedValue([{ ...freeRider, inSos: true }])
      await expect(repository.deactivate(COURIER_ID, ADMIN_ID, 'Left', NOW)).resolves.toEqual({ outcome: 'IN_SOS' })
      expectNothingWritten()
    })

    test('HOLDS_JOB while the rider holds a delivery past acceptance (AC-1)', async () => {
      tx.$queryRaw.mockResolvedValue([{ ...freeRider, holdsJob: true }])
      await expect(repository.deactivate(COURIER_ID, ADMIN_ID, 'Left', NOW)).resolves.toEqual({ outcome: 'HOLDS_JOB' })
      expectNothingWritten()
    })

    test('a rider both in SOS and holding a job is refused, and nothing is written', async () => {
      tx.$queryRaw.mockResolvedValue([{ ...freeRider, inSos: true, holdsJob: true }])
      const result = await repository.deactivate(COURIER_ID, ADMIN_ID, 'Left', NOW)
      expect(['IN_SOS', 'HOLDS_JOB']).toContain(result.outcome)
      expectNothingWritten()
    })
  })

  describe('deactivate: the writes on DONE (AC-1, AC-5, cross checks 4 and 6)', () => {
    test('sets deactivatedAt and deactivatedByUserId on the rider', async () => {
      await repository.deactivate(COURIER_ID, ADMIN_ID, 'Left the co-op', NOW)

      expect(tx.courier.update).toHaveBeenCalledTimes(1)
      expect(tx.courier.update).toHaveBeenCalledWith({
        where: { id: COURIER_ID },
        data: { deactivatedAt: NOW, deactivatedByUserId: ADMIN_ID },
      })
    })

    test("sets credentialsChangedAt to now on the rider's user, ending every session, and leaves the password alone", async () => {
      await repository.deactivate(COURIER_ID, ADMIN_ID, 'Left the co-op', NOW)

      expect(tx.user.update).toHaveBeenCalledTimes(1)
      expect(tx.user.update).toHaveBeenCalledWith({ where: { id: USER_ID }, data: { credentialsChangedAt: NOW } })
    })

    test('looks for BOOKED bookings that have not ended: future ones and one running now (cross check 6)', async () => {
      await repository.deactivate(COURIER_ID, ADMIN_ID, 'Left the co-op', NOW)

      expect(tx.shiftBooking.findMany).toHaveBeenCalledTimes(1)
      const where = tx.shiftBooking.findMany.mock.calls[0][0].where
      // Not ended yet: a booking that started an hour ago and ends in an hour is found too, so the rule
      // is on endsAt alone, never on startsAt.
      expect(where).toEqual({ courierId: COURIER_ID, status: EnumShiftBookingStatus.BOOKED, endsAt: { gt: NOW } })
      expect(where).not.toHaveProperty('startsAt')
    })

    test('drops each of them, ended at this moment, with one DROPPED event naming the admin', async () => {
      tx.shiftBooking.findMany.mockResolvedValue([{ id: 'booking-running' }, { id: 'booking-tomorrow' }])

      const result = await repository.deactivate(COURIER_ID, ADMIN_ID, 'Left the co-op', NOW)

      expect(tx.shiftBooking.update).toHaveBeenCalledTimes(2)
      expect(tx.shiftBookingEvent.create).toHaveBeenCalledTimes(2)
      for (const bookingId of ['booking-running', 'booking-tomorrow']) {
        expect(tx.shiftBooking.update).toHaveBeenCalledWith({
          where: { id: bookingId },
          data: expect.objectContaining({ status: EnumShiftBookingStatus.DROPPED, endedAt: NOW }),
        })
        expect(tx.shiftBookingEvent.create).toHaveBeenCalledWith({
          data: {
            shiftBookingId: bookingId,
            type: EnumShiftBookingEventType.DROPPED,
            courierId: COURIER_ID,
            adminUserId: ADMIN_ID,
          },
        })
      }
      expect(result).toEqual({ outcome: 'DONE', userId: USER_ID, droppedBookings: 2 })
    })

    test('a dropped booking is no longer on offer for a swap', async () => {
      tx.shiftBooking.findMany.mockResolvedValue([{ id: 'booking-1' }])
      await repository.deactivate(COURIER_ID, ADMIN_ID, 'Left the co-op', NOW)
      expect(tx.shiftBooking.update.mock.calls[0][0].data.swapOfferedAt).toBeNull()
    })

    test('a rider with no bookings: none dropped, no DROPPED event, still DONE', async () => {
      const result = await repository.deactivate(COURIER_ID, ADMIN_ID, 'Left the co-op', NOW)

      expect(tx.shiftBooking.update).not.toHaveBeenCalled()
      expect(tx.shiftBookingEvent.create).not.toHaveBeenCalled()
      expect(result).toEqual({ outcome: 'DONE', userId: USER_ID, droppedBookings: 0 })
    })

    test('records one DEACTIVATED account change with the admin as actor and the reason (AC-5)', async () => {
      await repository.deactivate(COURIER_ID, ADMIN_ID, 'Left the co-op in November', NOW)

      expect(tx.courierAccountChange.create).toHaveBeenCalledTimes(1)
      expect(tx.courierAccountChange.create).toHaveBeenCalledWith({
        data: {
          courierId: COURIER_ID,
          actorUserId: ADMIN_ID,
          kind: EnumCourierAccountChangeKind.DEACTIVATED,
          reason: 'Left the co-op in November',
        },
      })
    })
  })

  describe('reactivate (AC-3, cross check 9)', () => {
    beforeEach(() => {
      tx.$queryRaw.mockResolvedValue([{ userId: USER_ID, deactivated: true }])
    })

    test("locks the rider's row FOR UPDATE before deciding", async () => {
      await repository.reactivate(COURIER_ID, ADMIN_ID, null, NOW)

      const query = lockedQuery()
      expect(query.sql).toContain('FROM "Courier"')
      expect(query.sql).toContain('FOR UPDATE')
      expect(query.sql).toContain('("deactivatedAt" IS NOT NULL) AS "deactivated"')
      expect(query.values).toEqual([COURIER_ID])
    })

    test('MISSING when there is no such rider; nothing is written', async () => {
      tx.$queryRaw.mockResolvedValue([])
      await expect(repository.reactivate('no-such-rider', ADMIN_ID, null, NOW)).resolves.toEqual({ outcome: 'MISSING' })
      expectNothingWritten()
    })

    test('NOT_DEACTIVATED for a rider who is not deactivated; nothing is written', async () => {
      tx.$queryRaw.mockResolvedValue([{ userId: USER_ID, deactivated: false }])
      await expect(repository.reactivate(COURIER_ID, ADMIN_ID, null, NOW)).resolves.toEqual({
        outcome: 'NOT_DEACTIVATED',
      })
      expectNothingWritten()
    })

    test('clears both deactivation fields on the rider', async () => {
      await repository.reactivate(COURIER_ID, ADMIN_ID, null, NOW)

      expect(tx.courier.update).toHaveBeenCalledTimes(1)
      expect(tx.courier.update).toHaveBeenCalledWith({
        where: { id: COURIER_ID },
        data: { deactivatedAt: null, deactivatedByUserId: null },
      })
    })

    test('clears the password and sets credentialsChangedAt again', async () => {
      await repository.reactivate(COURIER_ID, ADMIN_ID, null, NOW)

      expect(tx.user.update).toHaveBeenCalledTimes(1)
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { password: null, credentialsChangedAt: NOW },
      })
    })

    test('restores no bookings', async () => {
      await repository.reactivate(COURIER_ID, ADMIN_ID, null, NOW)

      expect(tx.shiftBooking.update).not.toHaveBeenCalled()
      expect(tx.shiftBookingEvent.create).not.toHaveBeenCalled()
    })

    test('records one REACTIVATED account change with the admin and the optional reason', async () => {
      const done = await repository.reactivate(COURIER_ID, ADMIN_ID, 'Came back for the winter', NOW)

      expect(done).toEqual({ outcome: 'DONE', userId: USER_ID })
      expect(tx.courierAccountChange.create).toHaveBeenCalledTimes(1)
      expect(tx.courierAccountChange.create).toHaveBeenCalledWith({
        data: {
          courierId: COURIER_ID,
          actorUserId: ADMIN_ID,
          kind: EnumCourierAccountChangeKind.REACTIVATED,
          reason: 'Came back for the winter',
        },
      })
    })

    test('with no reason, the row is recorded with a null reason', async () => {
      await repository.reactivate(COURIER_ID, ADMIN_ID, null, NOW)
      expect(tx.courierAccountChange.create.mock.calls[0][0].data.reason).toBeNull()
    })
  })

  describe('record (AC-5, cross check 10)', () => {
    test('writes nothing for an empty list', async () => {
      await repository.record([])
      expect(prisma.courierAccountChange.createMany).not.toHaveBeenCalled()
    })

    test('writes one row per change, with every field the record keeps', async () => {
      await repository.record([
        {
          courierId: COURIER_ID,
          actorUserId: ADMIN_ID,
          actorIsRider: false,
          kind: EnumCourierAccountChangeKind.FIELD_EDITED,
          field: 'phoneNumber',
          oldValue: '+306900000000',
          newValue: '+306911111111',
        },
        {
          courierId: COURIER_ID,
          actorUserId: null,
          actorIsRider: true,
          kind: EnumCourierAccountChangeKind.PASSWORD_CHANGED,
        },
      ])

      expect(prisma.courierAccountChange.createMany).toHaveBeenCalledTimes(1)
      expect(prisma.courierAccountChange.createMany).toHaveBeenCalledWith({
        data: [
          {
            courierId: COURIER_ID,
            actorUserId: ADMIN_ID,
            actorIsRider: false,
            kind: EnumCourierAccountChangeKind.FIELD_EDITED,
            field: 'phoneNumber',
            oldValue: '+306900000000',
            newValue: '+306911111111',
            reason: null,
          },
          {
            courierId: COURIER_ID,
            actorUserId: null,
            actorIsRider: true,
            kind: EnumCourierAccountChangeKind.PASSWORD_CHANGED,
            field: null,
            oldValue: null,
            newValue: null,
            reason: null,
          },
        ],
      })
    })

    test("writes through the caller's transaction when one is given", async () => {
      await repository.record(
        [
          {
            courierId: COURIER_ID,
            actorUserId: ADMIN_ID,
            actorIsRider: false,
            kind: EnumCourierAccountChangeKind.FIELD_EDITED,
            field: 'firstName',
            oldValue: 'Nikos',
            newValue: 'Nikolaos',
          },
        ],
        tx as unknown as Prisma.TransactionClient
      )

      expect(tx.courierAccountChange.createMany).toHaveBeenCalledTimes(1)
      expect(prisma.courierAccountChange.createMany).not.toHaveBeenCalled()
    })
  })

  describe('listFor (AC-6, AC-7)', () => {
    const row = (id: string, overrides: Record<string, unknown> = {}) => ({
      id,
      courierId: COURIER_ID,
      actorUserId: null,
      actorIsRider: false,
      kind: EnumCourierAccountChangeKind.FIELD_EDITED,
      field: null,
      oldValue: null,
      newValue: null,
      reason: null,
      createdAt: NOW,
      ...overrides,
    })

    test("reads this rider's changes only, newest first", async () => {
      prisma.courierAccountChange.findMany.mockResolvedValue([])

      await repository.listFor(COURIER_ID)

      const args = prisma.courierAccountChange.findMany.mock.calls[0][0]
      expect(args.where).toEqual({ courierId: COURIER_ID })
      const orderBy = Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy]
      expect(orderBy[0]).toEqual({ createdAt: 'desc' })
    })

    test("gives each admin's row the admin's email, and the rider's own row none", async () => {
      prisma.courierAccountChange.findMany.mockResolvedValue([
        row('change-3', { actorUserId: 'admin-b', kind: EnumCourierAccountChangeKind.REACTIVATED }),
        row('change-2', { actorIsRider: true, kind: EnumCourierAccountChangeKind.PASSWORD_CHANGED }),
        row('change-1', { actorUserId: 'admin-a', kind: EnumCourierAccountChangeKind.DEACTIVATED, reason: 'Left' }),
        row('change-0', { actorUserId: 'admin-a' }),
      ])
      prisma.user.findMany.mockResolvedValue([
        { id: 'admin-a', email: 'anna@coop.gr' },
        { id: 'admin-b', email: 'babis@coop.gr' },
      ])

      const changes = await repository.listFor(COURIER_ID)

      // The order the database gave is kept.
      expect(changes.map((change) => change.id)).toEqual(['change-3', 'change-2', 'change-1', 'change-0'])
      expect(changes.map((change) => change.actorEmail)).toEqual(['babis@coop.gr', null, 'anna@coop.gr', 'anna@coop.gr'])
      expect(changes[2]).toMatchObject({ kind: EnumCourierAccountChangeKind.DEACTIVATED, reason: 'Left' })
      // Each admin is looked up once.
      const lookedUp = prisma.user.findMany.mock.calls[0][0].where.id.in
      expect([...lookedUp].sort()).toEqual(['admin-a', 'admin-b'])
    })

    test('an admin whose login no longer exists reads as no email, and the row is still listed', async () => {
      prisma.courierAccountChange.findMany.mockResolvedValue([row('change-1', { actorUserId: 'admin-gone' })])
      prisma.user.findMany.mockResolvedValue([])

      const changes = await repository.listFor(COURIER_ID)

      expect(changes).toHaveLength(1)
      expect(changes[0]?.actorEmail).toBeNull()
    })
  })
})
