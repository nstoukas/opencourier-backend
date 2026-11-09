import { EnumDeliveryEventType } from '@prisma/types'
import { DeliveryRepository } from './delivery.repository'
import { PrismaService } from 'src/services/prisma/prisma.service'
import { HAND_OVER_EVENTS } from 'src/domains/partner/wait-record'

// Spec 0030: DeliveryRepository.findForWaitRecord query structure (AC-2, AC-6, Value 5).
describe('DeliveryRepository.findForWaitRecord (spec 0030)', () => {
  let repository: DeliveryRepository
  let mockPrisma: any

  const SINCE = new Date('2026-10-10T12:00:00.000Z')
  const PARTNER_ID = 'partner-volos-10'

  beforeEach(() => {
    mockPrisma = {
      delivery: {
        findMany: jest.fn(),
      },
    }
    repository = new DeliveryRepository(mockPrisma as unknown as PrismaService)
  })

  test('queries deliveries filtering by partnerId, createdAt >= since, readyAt not null, and successful PICKED_UP (AC-2)', async () => {
    mockPrisma.delivery.findMany.mockResolvedValue([])

    await repository.findForWaitRecord(PARTNER_ID, SINCE)

    expect(mockPrisma.delivery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          partnerId: PARTNER_ID,
          createdAt: { gte: SINCE },
          readyAt: { not: null },
          deliveryEvent: {
            some: {
              type: EnumDeliveryEventType.PICKED_UP,
              transitionSuccessful: true,
            },
          },
        },
      })
    )
  })

  test('selects only the required fields and events, selecting no courierId or rider data (AC-6, Value 5)', async () => {
    mockPrisma.delivery.findMany.mockResolvedValue([])

    await repository.findForWaitRecord(PARTNER_ID, SINCE)

    expect(mockPrisma.delivery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
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
    )

    // Ensure courierId is not in the select clause
    const callArgs = mockPrisma.delivery.findMany.mock.calls[0][0]
    expect(callArgs.select).not.toHaveProperty('courierId')
    expect(callArgs.select.deliveryEvent.select).not.toHaveProperty('courierId')

    // Ensure handover events are selected so arrivals before the last handover can be discounted (spec 0030, AC-3)
    expect(callArgs.select.deliveryEvent.where.type.in).toEqual(
      expect.arrayContaining([
        EnumDeliveryEventType.REASSIGNED,
        EnumDeliveryEventType.RETURNED_TO_WAITING,
        EnumDeliveryEventType.HANDED_BACK,
      ])
    )
  })

  test('maps returned deliveryEvent array to events property on each delivery', async () => {
    const createdAt = new Date('2026-11-01T10:00:00Z')
    const readyAt = new Date('2026-11-01T10:15:00Z')
    const foodReadyAt = new Date('2026-11-01T10:14:00Z')
    const occurredAt = new Date('2026-11-01T10:16:00Z')

    mockPrisma.delivery.findMany.mockResolvedValue([
      {
        id: 'del-123',
        createdAt,
        readyAt,
        foodReadyAt,
        deliveryEvent: [
          { type: EnumDeliveryEventType.PICKED_UP, occurredAt },
        ],
      },
    ])

    const result = await repository.findForWaitRecord(PARTNER_ID, SINCE)

    expect(result).toEqual([
      {
        id: 'del-123',
        createdAt,
        readyAt,
        foodReadyAt,
        events: [
          { type: EnumDeliveryEventType.PICKED_UP, occurredAt },
        ],
      },
    ])
    // Ensure raw deliveryEvent property is stripped in the mapped result
    expect(result[0]).not.toHaveProperty('deliveryEvent')
  })
})
