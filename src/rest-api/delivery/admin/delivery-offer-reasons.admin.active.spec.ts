import { DeliveryAdminRestApiController } from './delivery.admin.rest-api.controller'
import { DeliveryDomainService } from 'src/domains/delivery/delivery.domain.service'
import { DeliveryEventDomainService } from 'src/domains/delivery-event/delivery-event.domain.service'
import { DeliveryIssueDomainService } from 'src/domains/delivery-issue/delivery-issue.domain.service'
import { OfferReasonAdminDto } from './dtos/offer-reason.admin.dto'
import { DeliveryCourierDto } from '../courier/dtos/delivery.courier.dto'
import { EnumDeliveryStatus } from '@prisma/types'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'

describe('Delivery Offer Reasons & Privacy (Spec 0044: AC-8, Security model)', () => {
  let controller: DeliveryAdminRestApiController
  let mockDeliveryDomainService: jest.Mocked<DeliveryDomainService>
  let mockDeliveryEventDomainService: jest.Mocked<DeliveryEventDomainService>
  let mockDeliveryIssueDomainService: jest.Mocked<DeliveryIssueDomainService>

  const deliveryId = 'del-offer-reason-admin-1'

  const mockOfferReasonRow = {
    id: 'reason-row-1',
    deliveryEventId: 'evt-offered-1',
    deliveryId,
    courierId: 'rider-chosen',
    strategy: 'FAIRNESS',
    weights: { roadTime: 50, earnings: 30, waiting: 20 },
    values: { roadSeconds: 150, centsPerHour: 800 },
    score: 0.18,
    candidateCount: 2,
    ridersInRange: 5,
    candidates: [
      { courierId: 'rider-chosen', roadSeconds: 150, centsPerHour: 800, score: 0.18 },
      { courierId: 'rider-other', roadSeconds: 220, centsPerHour: 1500, score: 0.45 },
    ],
    kind: 'SINGLE',
    createdAt: new Date('2026-11-21T10:00:00Z'),
  }

  beforeEach(() => {
    mockDeliveryDomainService = {
      getByIdOrThrowWithQuote: jest.fn().mockResolvedValue({
        delivery: {
          id: deliveryId,
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          pickupLocationId: 'loc-1',
          dropoffLocationId: 'loc-2',
        } as any,
        quote: null as any,
      }),
      getOfferViews: jest.fn().mockResolvedValue(new Map()),
      getPartnerCharge: jest.fn().mockResolvedValue(null),
      getWaitCharges: jest.fn().mockResolvedValue([]),
      getOfferReasons: jest.fn().mockResolvedValue([mockOfferReasonRow as any]),
      // Spec 0046: the delivery page also asks for the order's legs; none for a single delivery.
      getOrderLegs: jest.fn().mockResolvedValue({ legs: [], missingLegNumbers: [] }),
    } as any

    mockDeliveryEventDomainService = {} as any
    mockDeliveryIssueDomainService = {} as any

    controller = new DeliveryAdminRestApiController(
      mockDeliveryDomainService,
      mockDeliveryEventDomainService,
      mockDeliveryIssueDomainService,
      {} as any
    )
  })

  test('admin getDelivery queries deliveryDomainService.getOfferReasons and maps rows into offerReasons DTO', async () => {
    const result = await controller.getDelivery(deliveryId)

    expect(mockDeliveryDomainService.getOfferReasons).toHaveBeenCalledWith(deliveryId)
    expect(result.offerReasons).toHaveLength(1)

    const dto = result.offerReasons[0]!
    expect(dto).toBeInstanceOf(OfferReasonAdminDto)
    expect(dto.id).toBe('reason-row-1')
    expect(dto.strategy).toBe('FAIRNESS')
    expect(dto.weights).toEqual({ roadTime: 50, earnings: 30, waiting: 20 })
    expect(dto.score).toBe(0.18)
    expect(dto.candidateCount).toBe(2)
    expect(dto.ridersInRange).toBe(5)
    // Admin DTO carries candidates
    expect(dto.candidates).toHaveLength(2)
    expect(dto.candidates![0]).toMatchObject({ courierId: 'rider-chosen', score: 0.18 })
  })

  test('privacy guard: courier DeliveryCourierDto never returns OfferReason candidates or offerReasons', () => {
    const delivery = {
      id: 'del-courier-privacy-1',
      status: EnumDeliveryStatus.ASSIGNING_COURIER,
      pickupLocationId: 'loc-1',
      dropoffLocationId: 'loc-2',
      pickupName: 'Pickup',
      pickupPhoneNumber: '+30123',
      pickupBusinessName: 'Biz',
      pickupNotes: null,
      pickupVerification: null,
      boxSize: 'MEDIUM',
    } as any

    const courierDto = new DeliveryCourierDto(delivery)

    // Security invariant: candidate values (other riders' earnings per hour) are admin only
    expect((courierDto as any).offerReasons).toBeUndefined()
    expect((courierDto as any).candidates).toBeUndefined()

    // Inspect all prototype and instance property keys of DeliveryCourierDto
    const allKeys = Object.keys(courierDto)
    expect(allKeys).not.toContain('offerReasons')
    expect(allKeys).not.toContain('candidates')
  })
})
