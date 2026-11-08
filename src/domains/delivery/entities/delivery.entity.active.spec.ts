import { DeliveryEntity } from './delivery.entity'
import { DeliveryWithLocationsEntity } from './delivery-with-locations.entity'
import { EnumDeliveryStatus } from '@prisma/types'

describe('Delivery entities - cancellationPayoutPolicy (Decision 32.18)', () => {
  const baseDeliveryData = {
    id: 'del-entity-test',
    status: EnumDeliveryStatus.CANCELED,
    pickupName: 'Restaurant',
    pickupPhoneNumber: '+302101234567',
    pickupBusinessName: 'Food Place',
    pickupNotes: null,
    pickupVerification: null,
    pickupLocationId: 'loc-1',
    pickupReadyAt: null,
    pickupDeadlineAt: null,
    dropoffName: 'Customer',
    dropoffPhoneNumber: '+302109876543',
    dropoffBusinessName: null,
    dropoffNotes: null,
    dropoffSellerNotes: null,
    dropoffVerification: null,
    dropoffReadyAt: null,
    dropoffEta: null,
    dropoffDeadlineAt: null,
    deliverableAction: 'HAND_TO_CUSTOMER' as any,
    undeliverableAction: null,
    undeliverableReason: null,
    dropoffLocationId: 'loc-2',
    deliveryTypes: [],
    requiresDropoffSignature: false,
    requiresId: false,
    orderReference: 'ORD-1',
    orderTotalValue: 1000,
    orderItems: null,
    customerNotes: [],
    currencyCode: 'EUR',
    totalCost: 1000,
    fee: 200,
    feePercentage: 20,
    pay: 300,
    tips: 0,
    totalCompensation: 300,
    pickupTypes: [],
    imageType: null,
    returnVerification: null,
    externalUserInfo: null,
    externalId: null,
    courierId: 'courier-1',
    partnerId: 'partner-1',
    deliveryQuoteId: 'quote-1',
    rejectedByCouriers: [],
    matchedCourierId: null,
    offeredAt: null,
    offerExpiresAt: null,
    cancelledBy: null,
    cancelledFromStatus: null,
    cancelledAt: null,
    foodOutcome: null,
    foodOutcomeAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  describe('DeliveryEntity', () => {
    it('copies cancellationPayoutPolicy from data when present', () => {
      const entity = new DeliveryEntity({
        ...baseDeliveryData,
        cancellationPayoutPolicy: 'FULL_COMPENSATION',
      } as any)

      expect(entity.cancellationPayoutPolicy).toBe('FULL_COMPENSATION')
    })

    it('copies cancellationPayoutPolicy as null when null in data', () => {
      const entity = new DeliveryEntity({
        ...baseDeliveryData,
        cancellationPayoutPolicy: null,
      } as any)

      expect(entity.cancellationPayoutPolicy).toBeNull()
    })
  })

  describe('DeliveryWithLocationsEntity', () => {
    it('copies cancellationPayoutPolicy from data when present', () => {
      const entity = new DeliveryWithLocationsEntity({
        ...baseDeliveryData,
        pickupLocation: null,
        dropoffLocation: null,
        cancellationPayoutPolicy: 'QUARTER_COMPENSATION',
      } as any)

      expect(entity.cancellationPayoutPolicy).toBe('QUARTER_COMPENSATION')
    })

    it('copies cancellationPayoutPolicy as null when null in data', () => {
      const entity = new DeliveryWithLocationsEntity({
        ...baseDeliveryData,
        pickupLocation: null,
        dropoffLocation: null,
        cancellationPayoutPolicy: null,
      } as any)

      expect(entity.cancellationPayoutPolicy).toBeNull()
    })
  })
})

describe('Delivery entities - searchFold is never carried (spec 0025 AC-7, decision 98.3)', () => {
  // The trigger stores the folded order reference, customer and restaurant; it is personal data,
  // so it stops at the repository. The entities only declare the field for the type: a built entity
  // has no searchFold key at all, so a serialised entity (the partner webhook posts whole
  // entities) gains no field, not even "searchFold": null.
  const storedFold = 'ord-1\ncustomer\nfood place'

  function buildDeliveryEntity() {
    return new DeliveryEntity({ ...baseDeliveryRow(), searchFold: storedFold } as any)
  }
  function buildDeliveryWithLocationsEntity() {
    return new DeliveryWithLocationsEntity({
      ...baseDeliveryRow(),
      pickupLocation: null,
      dropoffLocation: null,
      searchFold: storedFold,
    } as any)
  }

  describe.each([
    ['DeliveryEntity', buildDeliveryEntity],
    ['DeliveryWithLocationsEntity', buildDeliveryWithLocationsEntity],
  ])('%s built from a row with searchFold set', (_name, build) => {
    it('has no searchFold property', () => {
      expect('searchFold' in build()).toBe(false)
    })

    it('has no searchFold among its own keys', () => {
      expect(Object.keys(build())).not.toContain('searchFold')
    })

    it('serialises with no searchFold key and no folded text', () => {
      const json = JSON.stringify(build())
      expect(json).not.toContain('searchFold')
      expect(json).not.toContain('food place')
    })

    it('still copies the fields the fold is made from', () => {
      const entity = build()
      expect(entity.orderReference).toBe('ORD-1')
      expect(entity.dropoffName).toBe('Customer')
      expect(entity.pickupBusinessName).toBe('Food Place')
      expect(entity.id).toBe('del-fold-test')
    })
  })

  function baseDeliveryRow() {
    return {
      id: 'del-fold-test',
      status: EnumDeliveryStatus.ACCEPTED,
      pickupName: 'Restaurant',
      pickupPhoneNumber: '+302101234567',
      pickupBusinessName: 'Food Place',
      dropoffName: 'Customer',
      dropoffPhoneNumber: '+302109876543',
      orderReference: 'ORD-1',
      courierId: 'courier-1',
      partnerId: 'partner-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  }
})
