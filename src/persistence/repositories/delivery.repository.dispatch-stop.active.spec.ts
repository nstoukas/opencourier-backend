import { EnumDeliveryStatus } from '@prisma/types'
import { DeliveryRepository } from './delivery.repository'
import { PrismaService } from 'src/services/prisma/prisma.service'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'

describe('DeliveryRepository - dispatch stop queries (Spec 0014, AC-5, AC-9)', () => {
  let repository: DeliveryRepository
  let mockPrisma: any

  beforeEach(() => {
    mockPrisma = {
      delivery: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
    }
    repository = new DeliveryRepository(mockPrisma as unknown as PrismaService)
  })

  test('findAllOpenOffers queries ASSIGNING_COURIER with matchedCourierId and returns DeliveryEntity instances', async () => {
    const rawDelivery = {
      id: 'del-open-1',
      status: EnumDeliveryStatus.ASSIGNING_COURIER,
      matchedCourierId: 'courier-1',
      courierId: null,
      partnerId: 'partner-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    mockPrisma.delivery.findMany.mockResolvedValue([rawDelivery])

    const result = await repository.findAllOpenOffers()

    expect(mockPrisma.delivery.findMany).toHaveBeenCalledWith({
      where: {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: { not: null },
        courierId: null,
      },
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toBeInstanceOf(DeliveryEntity)
    expect(result[0]?.id).toBe('del-open-1')
  })

  test('findAllHeldBeforePickup queries ACCEPTED, DISPATCHED, COURIER_ARRIVED_AT_PICKUP_LOCATION with courierId', async () => {
    const rawDelivery = {
      id: 'del-held-1',
      status: EnumDeliveryStatus.ACCEPTED,
      matchedCourierId: null,
      courierId: 'courier-1',
      partnerId: 'partner-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    mockPrisma.delivery.findMany.mockResolvedValue([rawDelivery])

    const result = await repository.findAllHeldBeforePickup()

    expect(mockPrisma.delivery.findMany).toHaveBeenCalledWith({
      where: {
        status: {
          in: [
            EnumDeliveryStatus.ACCEPTED,
            EnumDeliveryStatus.DISPATCHED,
            EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
          ],
        },
        courierId: { not: null },
      },
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toBeInstanceOf(DeliveryEntity)
    expect(result[0]?.id).toBe('del-held-1')
  })

  test('countOpenOffersAndHeldBeforePickup counts open offers and held deliveries in parallel', async () => {
    mockPrisma.delivery.count
      .mockResolvedValueOnce(3) // open offers
      .mockResolvedValueOnce(5) // held deliveries

    const result = await repository.countOpenOffersAndHeldBeforePickup()

    expect(mockPrisma.delivery.count).toHaveBeenNthCalledWith(1, {
      where: {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: { not: null },
        courierId: null,
      },
    })
    expect(mockPrisma.delivery.count).toHaveBeenNthCalledWith(2, {
      where: {
        status: {
          in: [
            EnumDeliveryStatus.ACCEPTED,
            EnumDeliveryStatus.DISPATCHED,
            EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
          ],
        },
        courierId: { not: null },
      },
    })
    expect(result).toEqual({ offersToEnd: 3, deliveriesToReturn: 5 })
  })
})
