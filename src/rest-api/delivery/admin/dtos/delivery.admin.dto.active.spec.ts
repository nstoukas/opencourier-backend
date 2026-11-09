import { DeliveryAdminDto } from './delivery.admin.dto'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { DeliveryQuoteEntity } from 'src/domains/delivery-quote/entities/delivery-quote.entity'
import { EnumCancelledBy, EnumDeliveryStatus, EnumFoodOutcome } from '@prisma/types'

describe('DeliveryAdminDto (AC-7, AC-13)', () => {
  const sampleDelivery = new DeliveryEntity({
    id: 'del-1',
    pickupName: 'Partner A',
    pickupPhoneNumber: '12345',
    pickupLocationId: 'loc-1',
    dropoffName: 'Customer B',
    dropoffPhoneNumber: '67890',
    dropoffLocationId: 'loc-2',
    deliverableAction: 'PIN' as any,
    undeliverableAction: 'RETURN' as any,
    matchedCourierId: null,
    status: 'CREATED' as any,
    paid: false,
    pay: 307,
    tips: 0,
    totalCompensation: 307,
    feePercentage: 10,
    pickupTypes: [],
    imageType: null,
    imageName: null,
    orderReference: 'ORD-1',
    partnerId: 'part-1',
    deliveryQuoteId: 'quote-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    deliveredAt: null,
    pickedUpAt: null,
    rejectedBy: [],
  } as any)

  const sampleQuote = new DeliveryQuoteEntity({
    id: 'quote-1',
    quote: 3.38,
    quoteRangeFrom: 338,
    quoteRangeTo: 338,
    feePercentage: 10,
    baseFee: 200,
    distanceFee: 107,
    currency: 'EUR',
    duration: 15,
    distance: 0.71,
    expiresAt: new Date(),
    pickupLocationId: 'loc-1',
    dropoffLocationId: 'loc-2',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any)

  // AC-7: DeliveryAdminDto with a quote carries baseFee and distanceFee
  it('carries baseFee and distanceFee when initialized with a quote (AC-7)', () => {
    const dto = new DeliveryAdminDto(sampleDelivery, sampleQuote)

    expect(dto.baseFee).toBe(200)
    expect(dto.distanceFee).toBe(107)
    expect(dto.feePercentage).toBe(10)
  })

  // AC-7: without a quote they are null
  it('returns baseFee and distanceFee as null when initialized without a quote (AC-7)', () => {
    const dto = new DeliveryAdminDto(sampleDelivery)

    expect(dto.baseFee).toBeNull()
    expect(dto.distanceFee).toBeNull()
  })

  describe('Cancellation fields and partner charge (Spec 0015 AC-13)', () => {
    it('returns cancellation fields and partnerCharge as null for non-cancelled delivery', () => {
      const dto = new DeliveryAdminDto(sampleDelivery)

      expect(dto.cancelledBy).toBeNull()
      expect(dto.cancelledFromStatus).toBeNull()
      expect(dto.cancelledAt).toBeNull()
      expect(dto.foodOutcome).toBeNull()
      expect(dto.foodOutcomeAt).toBeNull()
      expect(dto.partnerCharge).toBeNull()
    })

    it('carries cancellation fields and partnerCharge when delivery was cancelled', () => {
      const cancelledAt = new Date('2026-11-01T10:00:00Z')
      const foodOutcomeAt = new Date('2026-11-01T10:15:00Z')
      const chargeCreatedAt = new Date('2026-11-01T10:00:01Z')

      const cancelledDelivery = new DeliveryEntity({
        ...sampleDelivery,
        status: EnumDeliveryStatus.CANCELED,
        cancelledBy: EnumCancelledBy.RESTAURANT,
        cancelledFromStatus: EnumDeliveryStatus.PICKED_UP,
        cancelledAt,
        foodOutcome: EnumFoodOutcome.RETURNED,
        foodOutcomeAt,
      } as any)

      const partnerCharge = {
        amount: 1250,
        currencyCode: 'EUR',
        createdAt: chargeCreatedAt,
      }

      const dto = new DeliveryAdminDto(cancelledDelivery, sampleQuote, undefined, partnerCharge)

      expect(dto.cancelledBy).toBe(EnumCancelledBy.RESTAURANT)
      expect(dto.cancelledFromStatus).toBe(EnumDeliveryStatus.PICKED_UP)
      expect(dto.cancelledAt).toBe(cancelledAt)
      expect(dto.foodOutcome).toBe(EnumFoodOutcome.RETURNED)
      expect(dto.foodOutcomeAt).toBe(foodOutcomeAt)
      expect(dto.partnerCharge).toEqual({
        amount: 1250,
        currencyCode: 'EUR',
        createdAt: chargeCreatedAt,
      })
      expect(dto.waitCharges).toEqual([])
    })
  })

  describe('Wait charges (Spec 0033 decision 23.20)', () => {
    it('defaults waitCharges to empty array when not passed', () => {
      const dto = new DeliveryAdminDto(sampleDelivery)
      expect(dto.waitCharges).toEqual([])
    })

    it('carries waitCharges when provided', () => {
      const waitCharges = [
        { amount: 150, currencyCode: 'EUR', createdAt: new Date('2026-11-09T10:00:00Z') },
        { amount: 300, currencyCode: 'EUR', createdAt: new Date('2026-11-09T10:30:00Z') },
      ]
      const dto = new DeliveryAdminDto(sampleDelivery, sampleQuote, undefined, null, waitCharges)
      expect(dto.waitCharges).toEqual(waitCharges)
    })
  })
})
