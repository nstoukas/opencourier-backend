import { DeliveryAdminDto } from './delivery.admin.dto'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { DeliveryQuoteEntity } from 'src/domains/delivery-quote/entities/delivery-quote.entity'

describe('DeliveryAdminDto (AC-7)', () => {
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
})
