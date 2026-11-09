import {
  EnumCancelledBy,
  EnumCourierCompensationReason,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumPartnerChargeReason,
} from '@prisma/types'
import { DeliveryRepository } from './delivery.repository'
import { CourierCompensationRepository } from './courier-compensation.repository'
import { PartnerChargeRepository } from './partner-charge.repository'
import { PrismaService } from 'src/services/prisma/prisma.service'
import { DELIVERY_ONGOING_STATUSES } from 'src/shared-types'
import { PRISMA_UNIQUE_CONSTRAINT_ERROR } from 'src/prisma.util'

describe('Repositories for Cancellation (Spec 0015 AC-1, AC-6, AC-10)', () => {
  const makeUniqueConstraintError = () => {
    const error = new Error('Unique constraint failed on the constraint: cancellationOf')
    error.name = 'PrismaClientKnownRequestError'
    ;(error as any).code = PRISMA_UNIQUE_CONSTRAINT_ERROR
    return error
  }

  describe('DeliveryRepository.findCancellationsToSettle (AC-10)', () => {
    let repository: DeliveryRepository
    let mockPrisma: any

    beforeEach(() => {
      mockPrisma = {
        delivery: {
          findMany: jest.fn(),
        },
      }
      repository = new DeliveryRepository(mockPrisma as unknown as PrismaService)
    })

    it('where clause keys on cancelledAt (not on status) and contains the exact three OR branches', async () => {
      const from = new Date('2026-10-31T10:00:00Z')
      const to = new Date('2026-11-01T09:59:00Z')

      mockPrisma.delivery.findMany.mockResolvedValueOnce([{ id: 'del-1' }, { id: 'del-2' }])

      const result = await repository.findCancellationsToSettle(from, to, DELIVERY_ONGOING_STATUSES)

      expect(result).toEqual(['del-1', 'del-2'])
      expect(mockPrisma.delivery.findMany).toHaveBeenCalledWith({
        where: {
          cancelledAt: { gte: from, lte: to },
          cancelledFromStatus: { in: DELIVERY_ONGOING_STATUSES },
          OR: [
            {
              courierId: { not: null },
              courierCompensations: { none: { reason: EnumCourierCompensationReason.CANCELLATION } },
            },
            {
              courierId: { not: null },
              deliveryEvent: { none: { type: EnumDeliveryEventType.COURIER_PAID_FOR_CANCELLATION } },
            },
            {
              cancelledBy: EnumCancelledBy.RESTAURANT,
              partnerId: { not: null },
              partnerCharges: { none: { reason: EnumPartnerChargeReason.CANCELLATION } },
            },
          ],
        },
        select: { id: true },
        orderBy: { cancelledAt: 'asc' },
        take: 200,
      })

      // Verify that 'status' is NOT in the where clause (keyed on cancelledAt, not on status, so FAILED is covered)
      const calledWhere = mockPrisma.delivery.findMany.mock.calls[0][0].where
      expect(calledWhere).not.toHaveProperty('status')
    })
  })

  describe('DeliveryRepository.findCancelledJobsForCourier (AC-7, AC-11)', () => {
    let repository: DeliveryRepository
    let mockPrisma: any

    beforeEach(() => {
      mockPrisma = {
        delivery: {
          findMany: jest.fn(),
        },
      }
      repository = new DeliveryRepository(mockPrisma as unknown as PrismaService)
    })

    it('queries by courierId, cancelledAt >= since, cancelledFromStatus in ongoing, sorted desc by cancelledAt without id when deliveryId is omitted', async () => {
      const since = new Date('2026-10-31T12:00:00Z')
      mockPrisma.delivery.findMany.mockResolvedValueOnce([])

      await repository.findCancelledJobsForCourier('courier-1', since, DELIVERY_ONGOING_STATUSES)

      expect(mockPrisma.delivery.findMany).toHaveBeenCalledWith({
        where: {
          courierId: 'courier-1',
          cancelledAt: { gte: since },
          cancelledFromStatus: { in: DELIVERY_ONGOING_STATUSES },
        },
        orderBy: { cancelledAt: 'desc' },
        take: 20,
        include: {
          pickupLocation: true,
          courierCompensations: {
            where: { reason: EnumCourierCompensationReason.CANCELLATION, courierId: 'courier-1' },
          },
        },
      })
      const calledWhere = mockPrisma.delivery.findMany.mock.calls[0][0].where
      expect(calledWhere).not.toHaveProperty('id')
    })

    it('adds { id: deliveryId } to where clause only when deliveryId is given (spec 0015, agy review)', async () => {
      const since = new Date('2026-10-31T12:00:00Z')
      mockPrisma.delivery.findMany.mockResolvedValueOnce([])

      await repository.findCancelledJobsForCourier('courier-1', since, DELIVERY_ONGOING_STATUSES, 'del-specific-1')

      expect(mockPrisma.delivery.findMany).toHaveBeenCalledWith({
        where: {
          courierId: 'courier-1',
          cancelledAt: { gte: since },
          cancelledFromStatus: { in: DELIVERY_ONGOING_STATUSES },
          id: 'del-specific-1',
        },
        orderBy: { cancelledAt: 'desc' },
        take: 20,
        include: {
          pickupLocation: true,
          courierCompensations: {
            where: { reason: EnumCourierCompensationReason.CANCELLATION, courierId: 'courier-1' },
          },
        },
      })
      const calledWhere = mockPrisma.delivery.findMany.mock.calls[0][0].where
      expect(calledWhere.id).toBe('del-specific-1')
    })

    it('findPartnerCharge queries partnerCharge by deliveryId with selected fields', async () => {
      mockPrisma.partnerCharge = { findUnique: jest.fn().mockResolvedValue({ amount: 900, currencyCode: 'EUR' }) }

      const result = await repository.findPartnerCharge('del-1')

      expect(mockPrisma.partnerCharge.findUnique).toHaveBeenCalledWith({
        where: { cancellationOf: 'del-1' },
        select: { amount: true, currencyCode: true, createdAt: true },
      })
      expect(result).toEqual({ amount: 900, currencyCode: 'EUR' })
    })
  })

  describe('CourierCompensationRepository.createCancellationAwardOnce (AC-1, AC-2)', () => {
    let repository: CourierCompensationRepository
    let mockPrisma: any

    beforeEach(() => {
      mockPrisma = {
        courierCompensation: {
          create: jest.fn(),
          findUnique: jest.fn(),
        },
      }
      repository = new CourierCompensationRepository(mockPrisma as unknown as PrismaService)
    })

    it('creates and returns compensation row on success', async () => {
      const input = {
        amount: 800,
        currencyCode: 'EUR',
        reason: EnumCourierCompensationReason.CANCELLATION,
        policy: 'FULL_COMPENSATION',
        courierId: 'courier-1',
        deliveryId: 'del-1',
        cancellationOf: 'del-1',
      }
      mockPrisma.courierCompensation.create.mockResolvedValueOnce({ id: 'comp-1', ...input })

      const result = await repository.createCancellationAwardOnce(input)

      expect(result).toEqual({ id: 'comp-1', ...input })
      expect(mockPrisma.courierCompensation.create).toHaveBeenCalledWith({ data: input })
    })

    it('on unique constraint violation (P2002), fetches and returns the existing row', async () => {
      const input = {
        amount: 800,
        currencyCode: 'EUR',
        reason: EnumCourierCompensationReason.CANCELLATION,
        policy: 'FULL_COMPENSATION',
        courierId: 'courier-1',
        deliveryId: 'del-1',
        cancellationOf: 'del-1',
      }

      mockPrisma.courierCompensation.create.mockRejectedValueOnce(makeUniqueConstraintError())
      mockPrisma.courierCompensation.findUnique.mockResolvedValueOnce({
        id: 'comp-existing',
        ...input,
      })

      const result = await repository.createCancellationAwardOnce(input)

      expect(mockPrisma.courierCompensation.findUnique).toHaveBeenCalledWith({
        where: { cancellationOf: 'del-1' },
      })
      expect(result).toEqual({ id: 'comp-existing', ...input })
    })

    it('rethrows any non-unique-constraint error', async () => {
      mockPrisma.courierCompensation.create.mockRejectedValueOnce(new Error('Connection error'))

      await expect(
        repository.createCancellationAwardOnce({
          amount: 800,
          currencyCode: 'EUR',
          reason: EnumCourierCompensationReason.CANCELLATION,
          policy: 'FULL_COMPENSATION',
          courierId: 'courier-1',
          deliveryId: 'del-1',
          cancellationOf: 'del-1',
        })
      ).rejects.toThrow('Connection error')
    })
  })

  describe('PartnerChargeRepository.createOnce (AC-6)', () => {
    let repository: PartnerChargeRepository
    let mockPrisma: any

    beforeEach(() => {
      mockPrisma = {
        partnerCharge: {
          create: jest.fn(),
          findUnique: jest.fn(),
        },
      }
      repository = new PartnerChargeRepository(mockPrisma as unknown as PrismaService)
    })

    it('creates and returns partner charge on success', async () => {
      const input = {
        partnerId: 'part-1',
        deliveryId: 'del-1',
        amount: 1200,
        currencyCode: 'EUR',
        reason: EnumPartnerChargeReason.CANCELLATION,
      }
      mockPrisma.partnerCharge.create.mockResolvedValueOnce({ id: 'charge-1', ...input })

      const result = await repository.createOnce(input)

      expect(result).toEqual({ id: 'charge-1', ...input })
      expect(mockPrisma.partnerCharge.create).toHaveBeenCalledWith({ data: { ...input, cancellationOf: 'del-1' } })
    })

    it('on unique constraint violation (P2002), fetches and returns the existing charge', async () => {
      const input = {
        partnerId: 'part-1',
        deliveryId: 'del-1',
        amount: 1200,
        currencyCode: 'EUR',
        reason: EnumPartnerChargeReason.CANCELLATION,
      }

      mockPrisma.partnerCharge.create.mockRejectedValueOnce(makeUniqueConstraintError())
      mockPrisma.partnerCharge.findUnique.mockResolvedValueOnce({
        id: 'charge-existing',
        ...input,
      })

      const result = await repository.createOnce(input)

      expect(mockPrisma.partnerCharge.findUnique).toHaveBeenCalledWith({
        where: { cancellationOf: 'del-1' },
      })
      expect(result).toEqual({ id: 'charge-existing', ...input })
    })

    it('rethrows any non-unique-constraint error', async () => {
      mockPrisma.partnerCharge.create.mockRejectedValueOnce(new Error('Database unavailable'))

      await expect(
        repository.createOnce({
          partnerId: 'part-1',
          deliveryId: 'del-1',
          amount: 1200,
          currencyCode: 'EUR',
          reason: EnumPartnerChargeReason.CANCELLATION,
        })
      ).rejects.toThrow('Database unavailable')
    })
  })
})
