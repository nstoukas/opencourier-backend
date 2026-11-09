import {
  EnumCourierCompensationReason,
  EnumDeliveryEventType,
  EnumPartnerChargeReason,
} from '@prisma/types'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import { CourierCompensationRepository } from './courier-compensation.repository'
import { PartnerChargeRepository } from './partner-charge.repository'
import { DeliveryRepository } from './delivery.repository'
import { DeliveryEventRepository } from './delivery-event.repository'
import { WAIT_END_EVENTS } from 'src/domains/delivery/wait-pay'
import { HAND_OVER_EVENTS } from 'src/domains/partner/wait-record'

describe('Repositories for Wait Pay (Spec 0033 AC-3, AC-4, AC-8)', () => {
  function makeUniqueConstraintError(): PrismaClientKnownRequestError {
    return new PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`waitOf`)',
      {
        code: 'P2002',
        clientVersion: '5.x',
        meta: { target: ['waitOf'] },
      }
    )
  }

  describe('CourierCompensationRepository.createWaitPayOnce (AC-3)', () => {
    let repository: CourierCompensationRepository
    let mockPrisma: any

    beforeEach(() => {
      mockPrisma = {
        courierCompensation: {
          create: jest.fn(),
          findUnique: jest.fn(),
          findMany: jest.fn(),
        },
      }
      repository = new CourierCompensationRepository(mockPrisma)
    })

    const input = {
      amount: 150,
      currencyCode: 'EUR',
      reason: EnumCourierCompensationReason.WAITING,
      policy: 'WAIT_PAY',
      message: 'Waited 15 min at 10 cents a minute',
      courierId: 'courier-1',
      deliveryId: 'del-1',
      waitOf: 'del-1:evt-leave-1',
    }

    it('creates and returns compensation row on success', async () => {
      mockPrisma.courierCompensation.create.mockResolvedValueOnce({
        id: 'comp-1',
        ...input,
      })

      const result = await repository.createWaitPayOnce(input)

      expect(result).toEqual({ id: 'comp-1', ...input })
      expect(mockPrisma.courierCompensation.create).toHaveBeenCalledWith({ data: input })
    })

    it('on unique constraint violation (P2002), fetches and returns the existing row by waitOf', async () => {
      mockPrisma.courierCompensation.create.mockRejectedValueOnce(makeUniqueConstraintError())
      mockPrisma.courierCompensation.findUnique.mockResolvedValueOnce({
        id: 'comp-existing',
        ...input,
      })

      const result = await repository.createWaitPayOnce(input)

      expect(mockPrisma.courierCompensation.findUnique).toHaveBeenCalledWith({
        where: { waitOf: 'del-1:evt-leave-1' },
      })
      expect(result).toEqual({ id: 'comp-existing', ...input })
    })

    it('rethrows any non-unique-constraint error', async () => {
      mockPrisma.courierCompensation.create.mockRejectedValueOnce(new Error('DB failure'))

      await expect(repository.createWaitPayOnce(input)).rejects.toThrow('DB failure')
    })

    it('findWaitAwards queries compensations where deliveryId matches and waitOf is not null', async () => {
      mockPrisma.courierCompensation.findMany.mockResolvedValueOnce([{ id: 'comp-1' }])

      const result = await repository.findWaitAwards('del-1')

      expect(mockPrisma.courierCompensation.findMany).toHaveBeenCalledWith({
        where: { deliveryId: 'del-1', waitOf: { not: null } },
        orderBy: { createdAt: 'asc' },
      })
      expect(result).toEqual([{ id: 'comp-1' }])
    })
  })

  describe('PartnerChargeRepository.createWaitChargeOnce (AC-4)', () => {
    let repository: PartnerChargeRepository
    let mockPrisma: any

    beforeEach(() => {
      mockPrisma = {
        partnerCharge: {
          create: jest.fn(),
          findUnique: jest.fn(),
        },
      }
      repository = new PartnerChargeRepository(mockPrisma)
    })

    const input = {
      partnerId: 'partner-1',
      deliveryId: 'del-1',
      amount: 150,
      currencyCode: 'EUR',
      reason: EnumPartnerChargeReason.WAITING,
      waitOf: 'del-1:evt-leave-1',
    }

    it('creates and returns partner charge on success', async () => {
      mockPrisma.partnerCharge.create.mockResolvedValueOnce({ id: 'charge-1', ...input })

      const result = await repository.createWaitChargeOnce(input)

      expect(result).toEqual({ id: 'charge-1', ...input })
      expect(mockPrisma.partnerCharge.create).toHaveBeenCalledWith({ data: input })
    })

    it('on unique constraint violation (P2002), fetches and returns the existing charge by waitOf', async () => {
      mockPrisma.partnerCharge.create.mockRejectedValueOnce(makeUniqueConstraintError())
      mockPrisma.partnerCharge.findUnique.mockResolvedValueOnce({
        id: 'charge-existing',
        ...input,
      })

      const result = await repository.createWaitChargeOnce(input)

      expect(mockPrisma.partnerCharge.findUnique).toHaveBeenCalledWith({
        where: { waitOf: 'del-1:evt-leave-1' },
      })
      expect(result).toEqual({ id: 'charge-existing', ...input })
    })

    it('rethrows any non-unique-constraint error', async () => {
      mockPrisma.partnerCharge.create.mockRejectedValueOnce(new Error('DB connection lost'))

      await expect(repository.createWaitChargeOnce(input)).rejects.toThrow('DB connection lost')
    })
  })

  describe('DeliveryRepository.findWaitPayToSettle (AC-8, decision 23.9)', () => {
    let repository: DeliveryRepository
    let mockPrisma: any

    beforeEach(() => {
      mockPrisma = {
        delivery: {
          findMany: jest.fn(),
        },
      }
      repository = new DeliveryRepository(mockPrisma)
    })

    it('queries deliveries with waitPayOwedAt in range, ordered by waitPayOwedAt asc', async () => {
      const from = new Date('2026-11-08T10:00:00Z')
      const to = new Date('2026-11-09T09:59:00Z')

      mockPrisma.delivery.findMany.mockResolvedValueOnce([{ id: 'del-1' }, { id: 'del-2' }])

      const result = await repository.findWaitPayToSettle(from, to)

      expect(result).toEqual(['del-1', 'del-2'])
      expect(mockPrisma.delivery.findMany).toHaveBeenCalledWith({
        where: { waitPayOwedAt: { gte: from, lte: to } },
        select: { id: true },
        orderBy: { waitPayOwedAt: 'asc' },
        take: 200,
      })
    })
  })

  describe('DeliveryEventRepository.findWaitEvents and findWaitPaidMessages (AC-2, AC-3)', () => {
    let repository: DeliveryEventRepository
    let mockPrisma: any

    beforeEach(() => {
      mockPrisma = {
        deliveryEvent: {
          findMany: jest.fn(),
        },
      }
      repository = new DeliveryEventRepository(mockPrisma)
    })

    it('findWaitEvents queries successful arrival, wait end, and handover events ordered by occurredAt asc', async () => {
      const mockEvents = [
        {
          id: 'evt-1',
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          occurredAt: new Date(),
          courierId: 'courier-1',
        },
      ]
      mockPrisma.deliveryEvent.findMany.mockResolvedValueOnce(mockEvents)

      const result = await repository.findWaitEvents('del-1')

      expect(mockPrisma.deliveryEvent.findMany).toHaveBeenCalledWith({
        where: {
          deliveryId: 'del-1',
          transitionSuccessful: true,
          type: {
            in: [
              EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
              ...WAIT_END_EVENTS,
              ...HAND_OVER_EVENTS,
            ],
          },
        },
        select: { id: true, type: true, occurredAt: true, courierId: true },
        orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
      })
      expect(result).toEqual(mockEvents)
    })

    it('findWaitPaidMessages queries messages of COURIER_PAID_FOR_WAIT events', async () => {
      mockPrisma.deliveryEvent.findMany.mockResolvedValueOnce([
        { message: 'Courier courier-1 paid 100 EUR; wait del-1:evt-1' },
      ])

      const result = await repository.findWaitPaidMessages('del-1')

      expect(mockPrisma.deliveryEvent.findMany).toHaveBeenCalledWith({
        where: {
          deliveryId: 'del-1',
          type: EnumDeliveryEventType.COURIER_PAID_FOR_WAIT,
        },
        select: { message: true },
      })
      expect(result).toEqual(['Courier courier-1 paid 100 EUR; wait del-1:evt-1'])
    })
  })
})
