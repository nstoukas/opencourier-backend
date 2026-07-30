import { DeliveryEventRepository } from './delivery-event.repository'
import { PrismaService } from '../../services/prisma/prisma.service'
import { DeliveryEventEntity } from 'src/domains/delivery-event/entities/delivery-event.entity'
import {
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
} from '@prisma/types'

describe('DeliveryEventRepository', () => {
  let repository: DeliveryEventRepository
  let mockPrisma: {
    deliveryEvent: {
      findMany: jest.Mock
    }
  }

  const mockDeliveryId = 'cms57718o0007np9uq4ayigd4'

  beforeEach(() => {
    // Construct hand-rolled fake PrismaService with mocked deliveryEvent.findMany
    mockPrisma = {
      deliveryEvent: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    }

    repository = new DeliveryEventRepository(mockPrisma as unknown as PrismaService)
  })

  describe('findManyByDeliveryId', () => {
    test('queries by delivery, ordered oldest first with a deterministic tie-break', async () => {
      await repository.findManyByDeliveryId(mockDeliveryId)

      // Assert Prisma findMany query parameters pin delivery filtering and deterministic ordering
      expect(mockPrisma.deliveryEvent.findMany).toHaveBeenCalledTimes(1)
      expect(mockPrisma.deliveryEvent.findMany).toHaveBeenCalledWith({
        where: { deliveryId: mockDeliveryId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    })

    test('rows come back as DeliveryEventEntity instances', async () => {
      // Setup raw Prisma database records returned by query
      const rawRows = [
        {
          id: 'evt-1',
          deliveryId: mockDeliveryId,
          type: EnumDeliveryEventType.CREATED,
          actor: EnumEventActor.PARTNER,
          eventSource: EnumDeliveryEventSource.PARTNER_APP,
          oldStatus: EnumDeliveryStatus.CREATED,
          newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          transitionSuccessful: true,
          message: null,
          createdAt: new Date('2026-07-28T21:58:51.940Z'),
          updatedAt: new Date('2026-07-28T21:58:51.940Z'),
        },
        {
          id: 'evt-2',
          deliveryId: mockDeliveryId,
          type: EnumDeliveryEventType.DISPATCHED,
          actor: EnumEventActor.ADMIN,
          eventSource: EnumDeliveryEventSource.OPENCOURIER,
          oldStatus: EnumDeliveryStatus.DISPATCHED,
          newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          transitionSuccessful: false,
          message: 'Courier ID is required for dispatching',
          createdAt: new Date('2026-07-28T22:00:00.000Z'),
          updatedAt: new Date('2026-07-28T22:00:00.000Z'),
        },
      ]

      mockPrisma.deliveryEvent.findMany.mockResolvedValue(rawRows)

      const result = await repository.findManyByDeliveryId(mockDeliveryId)

      // Assert returned objects are instance of DeliveryEventEntity domain class
      expect(result).toHaveLength(2)
      expect(result[0]).toBeInstanceOf(DeliveryEventEntity)
      expect(result[0]?.eventSource).toBe(EnumDeliveryEventSource.PARTNER_APP)
      expect(result[0]?.transitionSuccessful).toBe(true)

      expect(result[1]).toBeInstanceOf(DeliveryEventEntity)
      expect(result[1]?.transitionSuccessful).toBe(false)
      expect(result[1]?.message).toBe('Courier ID is required for dispatching')
    })
  })
})
