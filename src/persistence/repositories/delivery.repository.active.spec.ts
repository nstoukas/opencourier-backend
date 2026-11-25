import { EnumDeliveryStatus, Prisma } from '@prisma/types'
import { DeliveryRepository } from './delivery.repository'
import { PrismaService } from 'src/services/prisma/prisma.service'
import { DELIVERY_ONGOING_STATUSES } from 'src/shared-types'
import { StackStop } from 'src/domains/delivery/stack'

describe('DeliveryRepository - mid-job add-ons (spec 0048 row 81, rulings & decision 81.22)', () => {
  let repository: DeliveryRepository
  let mockPrisma: any
  let fakeTx: {
    $queryRaw: jest.Mock
    delivery: {
      count: jest.Mock
      findUnique: jest.Mock
      findUniqueOrThrow: jest.Mock
      updateMany: jest.Mock
    }
  }

  beforeEach(() => {
    fakeTx = {
      $queryRaw: jest.fn(),
      delivery: {
        count: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn(),
      },
    }

    // Interactive transaction mock: executes the callback with fakeTx.
    // If the callback throws (such as RollBack), the transaction promise rejects.
    mockPrisma = {
      $transaction: jest.fn(async (cb: (tx: any) => Promise<any>) => cb(fakeTx)),
      delivery: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    }

    repository = new DeliveryRepository(mockPrisma as unknown as PrismaService)
  })

  describe('claimAddOnWithinBox (spec 0048 AC-6, AC-11, decision 81.22)', () => {
    const courierId = 'courier-r81'
    const deliveryId = 'del-addon-1'
    const jobId = 'job-held-1'
    const allowedJobStatuses: EnumDeliveryStatus[] = [
      EnumDeliveryStatus.ACCEPTED,
      EnumDeliveryStatus.DISPATCHED,
    ]

    test('happy path: returns CLAIMED when rider holds exactly the job in an allowed status and box fits', async () => {
      // 1. Not deactivated
      fakeTx.$queryRaw.mockResolvedValueOnce([{ deactivated: false }])
      // 2. Sibling leg check: no sibling leg held
      fakeTx.$queryRaw.mockResolvedValueOnce([{ exists: false }])
      // 3. Live delivery count: exactly 1 held
      fakeTx.$queryRaw.mockResolvedValueOnce([{ held: 1 }])
      // 4. Job check: held job is still this courier's in allowedJobStatuses
      fakeTx.delivery.count.mockResolvedValueOnce(1)
      // 5. Read delivery boxUnits
      fakeTx.delivery.findUnique.mockResolvedValueOnce({ boxUnits: 30 })
      // 6. Held box units sum
      fakeTx.$queryRaw.mockResolvedValueOnce([{ held: 20 }]) // 20 + 30 = 50 <= 100
      // 7. Update conditional write hits
      fakeTx.delivery.updateMany.mockResolvedValueOnce({ count: 1 })

      const outcome = await repository.claimAddOnWithinBox(
        deliveryId,
        courierId,
        jobId,
        allowedJobStatuses,
        { status: EnumDeliveryStatus.ASSIGNING_COURIER },
        { matchedCourierId: courierId }
      )

      expect(outcome).toBe('CLAIMED')
      expect(fakeTx.delivery.count).toHaveBeenCalledWith({
        where: {
          id: jobId,
          courierId,
          status: { in: allowedJobStatuses },
        },
      })
      expect(fakeTx.delivery.updateMany).toHaveBeenCalledWith({
        where: {
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          id: deliveryId,
          boxUnits: 30,
        },
        data: { matchedCourierId: courierId },
      })
    })

    test('returns JOB_CHANGED when held job count is 0 (job completed, dropped off, or reassigned)', async () => {
      fakeTx.$queryRaw.mockResolvedValueOnce([{ deactivated: false }])
      fakeTx.$queryRaw.mockResolvedValueOnce([{ exists: false }])
      fakeTx.$queryRaw.mockResolvedValueOnce([{ held: 1 }]) // live count was 1
      // Job count returns 0 because jobId is no longer held by courierId in allowedJobStatuses
      fakeTx.delivery.count.mockResolvedValueOnce(0)

      const outcome = await repository.claimAddOnWithinBox(
        deliveryId,
        courierId,
        jobId,
        allowedJobStatuses,
        { status: EnumDeliveryStatus.ASSIGNING_COURIER },
        { matchedCourierId: courierId }
      )

      expect(outcome).toBe('JOB_CHANGED')
      // Delivery was never read or updated
      expect(fakeTx.delivery.findUnique).not.toHaveBeenCalled()
      expect(fakeTx.delivery.updateMany).not.toHaveBeenCalled()
    })

    test('returns JOB_CHANGED when live delivery count is not 1 (e.g. held count is 0)', async () => {
      fakeTx.$queryRaw.mockResolvedValueOnce([{ deactivated: false }])
      fakeTx.$queryRaw.mockResolvedValueOnce([{ exists: false }])
      // Live count is 0 (rider finished job)
      fakeTx.$queryRaw.mockResolvedValueOnce([{ held: 0 }])
      fakeTx.delivery.count.mockResolvedValueOnce(1)

      const outcome = await repository.claimAddOnWithinBox(
        deliveryId,
        courierId,
        jobId,
        allowedJobStatuses,
        { status: EnumDeliveryStatus.ASSIGNING_COURIER },
        { matchedCourierId: courierId }
      )

      expect(outcome).toBe('JOB_CHANGED')
      expect(fakeTx.delivery.findUnique).not.toHaveBeenCalled()
      expect(fakeTx.delivery.updateMany).not.toHaveBeenCalled()
    })

    test('returns JOB_CHANGED when held job transitioned past the allowed addOnMoment status', async () => {
      // E.g. Moment was BEFORE_PICKUP (job must be ACCEPTED or DISPATCHED),
      // but rider tapped PICKED_UP in the moment between matching and claim.
      fakeTx.$queryRaw.mockResolvedValueOnce([{ deactivated: false }])
      fakeTx.$queryRaw.mockResolvedValueOnce([{ exists: false }])
      fakeTx.$queryRaw.mockResolvedValueOnce([{ held: 1 }])
      // Count query filters by status: { in: allowedJobStatuses }.
      // Since status in DB is now PICKED_UP, count returns 0.
      fakeTx.delivery.count.mockResolvedValueOnce(0)

      const outcome = await repository.claimAddOnWithinBox(
        deliveryId,
        courierId,
        jobId,
        [EnumDeliveryStatus.ACCEPTED, EnumDeliveryStatus.DISPATCHED],
        { status: EnumDeliveryStatus.ASSIGNING_COURIER },
        { matchedCourierId: courierId }
      )

      expect(outcome).toBe('JOB_CHANGED')
      expect(fakeTx.delivery.updateMany).not.toHaveBeenCalled()
    })

    test('returns BOX_FULL when held job and add-on exceed 100 box units', async () => {
      fakeTx.$queryRaw.mockResolvedValueOnce([{ deactivated: false }])
      fakeTx.$queryRaw.mockResolvedValueOnce([{ exists: false }])
      fakeTx.$queryRaw.mockResolvedValueOnce([{ held: 1 }])
      fakeTx.delivery.count.mockResolvedValueOnce(1)
      fakeTx.delivery.findUnique.mockResolvedValueOnce({ boxUnits: 60 })
      fakeTx.$queryRaw.mockResolvedValueOnce([{ held: 50 }]) // 50 + 60 = 110 > 100

      const outcome = await repository.claimAddOnWithinBox(
        deliveryId,
        courierId,
        jobId,
        allowedJobStatuses,
        { status: EnumDeliveryStatus.ASSIGNING_COURIER },
        { matchedCourierId: courierId }
      )

      expect(outcome).toBe('BOX_FULL')
      expect(fakeTx.delivery.updateMany).not.toHaveBeenCalled()
    })

    test('returns NOT_WAITING when delivery conditional write misses', async () => {
      fakeTx.$queryRaw.mockResolvedValueOnce([{ deactivated: false }])
      fakeTx.$queryRaw.mockResolvedValueOnce([{ exists: false }])
      fakeTx.$queryRaw.mockResolvedValueOnce([{ held: 1 }])
      fakeTx.delivery.count.mockResolvedValueOnce(1)
      fakeTx.delivery.findUnique.mockResolvedValueOnce({ boxUnits: 30 })
      fakeTx.$queryRaw.mockResolvedValueOnce([{ held: 20 }])
      // Missed write: count === 0
      fakeTx.delivery.updateMany.mockResolvedValueOnce({ count: 0 })

      const outcome = await repository.claimAddOnWithinBox(
        deliveryId,
        courierId,
        jobId,
        allowedJobStatuses,
        { status: EnumDeliveryStatus.ASSIGNING_COURIER },
        { matchedCourierId: courierId }
      )

      expect(outcome).toBe('NOT_WAITING')
    })
  })

  describe('joinAcceptedAddOn (spec 0048 AC-10, agy review fix 6a3720c, decision 81.22)', () => {
    const courierId = 'courier-r81'
    const addOnId = 'del-addon-1'
    const jobId = 'job-held-1'
    const stops: StackStop[] = [
      { deliveryId: jobId, stop: 'PICKUP' },
      { deliveryId: addOnId, stop: 'PICKUP' },
      { deliveryId: jobId, stop: 'DROPOFF' },
      { deliveryId: addOnId, stop: 'DROPOFF' },
    ]

    test('happy path: joins both deliveries into the same offerGroupId and stopSequence', async () => {
      // Both updateMany calls return count: 1
      fakeTx.delivery.updateMany
        .mockResolvedValueOnce({ count: 1 }) // job update
        .mockResolvedValueOnce({ count: 1 }) // addOn update
      fakeTx.delivery.findUniqueOrThrow.mockResolvedValueOnce({ status: EnumDeliveryStatus.DISPATCHED })

      const joined = await repository.joinAcceptedAddOn(addOnId, jobId, courierId, stops)

      // Row 146 review: returns job status from inside the transaction, not boolean true
      expect(joined).toBe(EnumDeliveryStatus.DISPATCHED)
      expect(joined).not.toBe(true)
      expect(fakeTx.delivery.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: jobId },
        select: { status: true },
      })
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)

      // 1. Job updated with groupId and stopSequence
      expect(fakeTx.delivery.updateMany).toHaveBeenNthCalledWith(1, {
        where: { id: jobId, courierId, status: { in: DELIVERY_ONGOING_STATUSES } },
        data: {
          offerGroupId: expect.any(String),
          stopSequence: stops.map((s) => ({ deliveryId: s.deliveryId, stop: s.stop })),
        },
      })

      // 2. Add-on updated with same groupId and stopSequence, filtering by ongoing status
      const assignedGroupId = fakeTx.delivery.updateMany.mock.calls[0][0].data.offerGroupId
      expect(fakeTx.delivery.updateMany).toHaveBeenNthCalledWith(2, {
        where: { id: addOnId, courierId, status: { in: DELIVERY_ONGOING_STATUSES } },
        data: {
          offerGroupId: assignedGroupId,
          stopSequence: stops.map((s) => ({ deliveryId: s.deliveryId, stop: s.stop })),
        },
      })

      // Fallback cleanup not called on success
      expect(mockPrisma.delivery.updateMany).not.toHaveBeenCalled()
    })

    test('job miss: when job is no longer ongoing with this courier, rolls back and clears stopSequence on addOn', async () => {
      // Job update misses (count: 0) because job ended or moved
      fakeTx.delivery.updateMany.mockResolvedValueOnce({ count: 0 })

      const joined = await repository.joinAcceptedAddOn(addOnId, jobId, courierId, stops)

      // Returns null on rollback: never a status, never false
      expect(joined).toBeNull()
      expect(joined).not.toBe(false)
      expect(joined).not.toBe(EnumDeliveryStatus.DISPATCHED)
      // addOn update inside transaction was not called because job threw RollBack
      expect(fakeTx.delivery.updateMany).toHaveBeenCalledTimes(1)
      // Outside transaction: addOn's stopSequence is cleared to DbNull so it goes on alone
      expect(mockPrisma.delivery.updateMany).toHaveBeenCalledWith({
        where: { id: addOnId },
        data: { stopSequence: Prisma.DbNull },
      })
    })

    test('add-on miss (agy review fix 6a3720c): when add-on update misses, transaction rolls back so job keeps no orphan groupId', async () => {
      // Job update hits (count: 1), but addOn update misses (count: 0 - e.g. admin moved addOn order)
      fakeTx.delivery.updateMany
        .mockResolvedValueOnce({ count: 1 }) // job write hits
        .mockResolvedValueOnce({ count: 0 }) // addOn write misses

      const joined = await repository.joinAcceptedAddOn(addOnId, jobId, courierId, stops)

      // Returns null on rollback: never a status, never false
      expect(joined).toBeNull()
      expect(joined).not.toBe(false)
      expect(joined).not.toBe(EnumDeliveryStatus.DISPATCHED)
      expect(fakeTx.delivery.updateMany).toHaveBeenCalledTimes(2)

      // The transaction threw RollBack, rolling back the job update in the DB.
      // Outside transaction: addOn's stopSequence is cleared to DbNull
      expect(mockPrisma.delivery.updateMany).toHaveBeenCalledWith({
        where: { id: addOnId },
        data: { stopSequence: Prisma.DbNull },
      })
    })

    test('rethrows unexpected database error that is not a RollBack', async () => {
      const dbError = new Error('Database connection failed')
      fakeTx.delivery.updateMany.mockRejectedValueOnce(dbError)

      await expect(repository.joinAcceptedAddOn(addOnId, jobId, courierId, stops)).rejects.toThrow(
        'Database connection failed'
      )

      expect(mockPrisma.delivery.updateMany).not.toHaveBeenCalled()
    })

    test('the add on update carries the ongoing status filter (row 146 review fix 176f818)', async () => {
      fakeTx.delivery.updateMany
        .mockResolvedValueOnce({ count: 1 }) // job update
        .mockResolvedValueOnce({ count: 1 }) // addOn update
      fakeTx.delivery.findUniqueOrThrow.mockResolvedValueOnce({ status: EnumDeliveryStatus.ACCEPTED })

      await repository.joinAcceptedAddOn(addOnId, jobId, courierId, stops)

      // Add-on update must carry status filter { in: DELIVERY_ONGOING_STATUSES }
      expect(fakeTx.delivery.updateMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: {
            id: addOnId,
            courierId,
            status: { in: DELIVERY_ONGOING_STATUSES },
          },
        })
      )
    })

    test('when add on is cancelled between accept and join, update matches nothing (count 0), transaction rolls back, job keeps no groupId, add on stop list is cleared, and joinAcceptedAddOn returns null', async () => {
      // In the database: job is ongoing, but add-on was cancelled between its accept and this join.
      // Under spec 0015, a cancelled order keeps courierId for payout accounting, but its status is CANCELED.
      const dbAddOn = {
        id: addOnId,
        courierId,
        status: EnumDeliveryStatus.CANCELED,
      }

      fakeTx.delivery.updateMany.mockImplementation(async ({ where }: { where: any }) => {
        if (where.id === jobId) return { count: 1 }
        if (where.id === addOnId) {
          // If the update checks ongoing status: CANCELED is not ongoing -> 0 matches.
          // If the status filter is dropped (the bug): id and courierId match -> 1 match.
          const matchesStatus = where.status?.in ? where.status.in.includes(dbAddOn.status) : true
          const matchesCourier = where.courierId === dbAddOn.courierId
          return { count: matchesStatus && matchesCourier ? 1 : 0 }
        }
        return { count: 0 }
      })
      fakeTx.delivery.findUniqueOrThrow.mockResolvedValue({ status: EnumDeliveryStatus.ACCEPTED })

      const joined = await repository.joinAcceptedAddOn(addOnId, jobId, courierId, stops)

      // 1. Returns null on rollback (never the job's status)
      expect(joined).toBeNull()

      // 2. Transaction rolled back: job was never read for commit, findUniqueOrThrow never called
      expect(fakeTx.delivery.findUniqueOrThrow).not.toHaveBeenCalled()

      // 3. Add-on stopSequence cleared outside the rolled-back transaction so it goes on alone
      expect(mockPrisma.delivery.updateMany).toHaveBeenCalledWith({
        where: { id: addOnId },
        data: { stopSequence: Prisma.DbNull },
      })
    })
  })

  describe('findTakenGroupMembers (decision 128.6)', () => {
    test('queries deliveries for offerGroupId, matchedCourierId, offeredAt, courierId, and ASSIGNING_COURIER status', async () => {
      const offeredAt = new Date('2026-11-23T08:00:00Z')
      const mockRows = [
        {
          id: 'del-1',
          offerGroupId: 'grp-stack-1',
          matchedCourierId: 'courier-r80',
          courierId: 'courier-r80',
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          offeredAt,
          createdAt: new Date('2026-11-23T07:55:00Z'),
        },
        {
          id: 'del-2',
          offerGroupId: 'grp-stack-1',
          matchedCourierId: 'courier-r80',
          courierId: 'courier-r80',
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          offeredAt,
          createdAt: new Date('2026-11-23T07:56:00Z'),
        },
      ]
      mockPrisma.delivery.findMany = jest.fn().mockResolvedValueOnce(mockRows)

      const result = await repository.findTakenGroupMembers('grp-stack-1', 'courier-r80', offeredAt)

      expect(mockPrisma.delivery.findMany).toHaveBeenCalledWith({
        where: {
          offerGroupId: 'grp-stack-1',
          matchedCourierId: 'courier-r80',
          offeredAt,
          courierId: 'courier-r80',
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
      expect(result).toHaveLength(2)
      expect(result[0]?.id).toBe('del-1')
      expect(result[1]?.id).toBe('del-2')
    })
  })

  describe('findTakenNotAccepted (spec 0048, widened by row 172)', () => {
    test("findTakenNotAccepted's where has status ASSIGNING_COURIER, courierId not null, updatedAt lt before, and NO offerGroupId condition; returns only rows whose matchedCourierId equals courierId", async () => {
      const before = new Date('2026-11-26T01:00:00.000Z')
      const mockRows = [
        {
          id: 'del-single-matched',
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId: 'courier-1',
          matchedCourierId: 'courier-1',
          offerGroupId: null,
          updatedAt: new Date('2026-11-26T00:58:00.000Z'),
        },
        {
          id: 'del-pair-matched',
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId: 'courier-2',
          matchedCourierId: 'courier-2',
          offerGroupId: 'grp-pair-1',
          updatedAt: new Date('2026-11-26T00:57:00.000Z'),
        },
        {
          id: 'del-unmatched-courier',
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId: 'courier-3',
          matchedCourierId: 'courier-4',
          offerGroupId: null,
          updatedAt: new Date('2026-11-26T00:56:00.000Z'),
        },
      ]
      mockPrisma.delivery.findMany = jest.fn().mockResolvedValueOnce(mockRows)

      const result = await repository.findTakenNotAccepted(before)

      expect(mockPrisma.delivery.findMany).toHaveBeenCalledWith({
        where: {
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId: { not: null },
          updatedAt: { lt: before },
        },
        orderBy: { updatedAt: 'asc' },
        take: 50,
      })

      // Pin that there is NO offerGroupId condition in where
      const findManyCall = mockPrisma.delivery.findMany.mock.calls[0][0]
      expect(findManyCall.where).not.toHaveProperty('offerGroupId')
      expect(findManyCall.where.offerGroupId).toBeUndefined()

      // Returns only rows whose matchedCourierId equals courierId
      expect(result).toHaveLength(2)
      expect(result.map((r) => r.id)).toEqual(['del-single-matched', 'del-pair-matched'])
      for (const entity of result) {
        expect(entity.matchedCourierId).toBe(entity.courierId)
      }
    })
  })
})
