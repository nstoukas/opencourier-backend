import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { EnumCancelledBy, EnumDeliveryStatus } from '@prisma/types'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { isInPartnerHistory, olderThanHistoryMessage, partnerHistoryWhere } from './partner-history'
import { DispatchStopRepository } from 'src/persistence/repositories/dispatch-stop.repository'
import { restaurantStoppedMessage } from 'src/domains/dispatch-stop/dispatch-stop-time'
import { DeliveryQuoteDomainService } from 'src/domains/delivery-quote/delivery-quote.domain.service'
import { PartnerDomainService } from 'src/domains/partner/partner.domain.service'
import {
  DeliveryForQuoteAlreadyExistsException,
  DeliveryLocationDoesntMatchQuoteException,
  DeliveryNotFoundException,
  NotFoundException,
  QuoteHasExpiredException,
} from 'src/errors'
import { DeliveryCreatePartnerInput } from './queries/delivery-create.partner.input'
import { LocationDomainService } from 'src/domains/location/location.domain.service'
import { DeliveryDomainService } from 'src/domains/delivery/delivery.domain.service'
import { EnumDeliverableAction, EnumUndeliverableAction } from '@prisma/types'
import { JsonValue } from 'src/shared-types/index'
import { CourierDomainService } from 'src/domains/courier/courier.domain.service'
import { DeliveryUpdatePartnerInput } from './queries/delivery-update.partner.input'
import { QuoteToDeliveryConversionService } from 'src/services/quote-to-delivery-conversion/quote-to-delivery-conversion.service'

// An optional text a restaurant sends (spec 0016's floor and doorbell): trimmed, and empty stored as none.
function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

@Injectable()
export class DeliveryPartnerRestApiService {
  private readonly logger = new Logger(DeliveryPartnerRestApiService.name)
  constructor(
    private deliveryQuoteDomainService: DeliveryQuoteDomainService,
    private deliveryDomainService: DeliveryDomainService,
    private partnerDomainService: PartnerDomainService,
    private locationDomainService: LocationDomainService,
    private courierDomainService: CourierDomainService,
    private quoteToDeliveryConversionService: QuoteToDeliveryConversionService,
    private dispatchStopRepository: DispatchStopRepository,
    private configDomainService: ConfigDomainService
  ) {}

  // Spec 0017: the restaurant's deliveries within the co-op's period, or still open, and the period
  // itself, which the page shows ("your orders from the last 30 days").
  async getManyByPartnerId(partnerId: string, page?: number, perPage?: number) {
    const historyDays = await this.configDomainService.instanceConfig.getRestaurantHistoryDays()
    const deliveries = await this.deliveryDomainService.getMany(
      partnerHistoryWhere(partnerId, historyDays, new Date()),
      page,
      perPage
    )

    return { ...deliveries, historyDays }
  }

  // Spec 0017 (AC-3): every route that takes a delivery id. Ownership first, so another restaurant's
  // delivery is a plain 404 and the period sentence never reveals it; then the period.
  private async assertVisibleToPartner(
    delivery: { partnerId: string | null; createdAt: Date; status: EnumDeliveryStatus } | null,
    partnerId: string
  ): Promise<void> {
    if (!delivery || delivery.partnerId !== partnerId) {
      throw new DeliveryNotFoundException('Delivery not found')
    }
    const historyDays = await this.configDomainService.instanceConfig.getRestaurantHistoryDays()
    if (!isInPartnerHistory(delivery, historyDays, new Date())) {
      throw new DeliveryNotFoundException(olderThanHistoryMessage(historyDays))
    }
  }

  async getByIdWithRelations(deliveryId: string, partnerId: string) {
    const delivery = await this.deliveryDomainService.getById(deliveryId)
    await this.assertVisibleToPartner(delivery, partnerId)
    if (!delivery) {
      throw new DeliveryNotFoundException('Delivery not found')
    }

    const locations = await this.locationDomainService.getByIds([delivery.pickupLocationId, delivery.dropoffLocationId])

    const pickupLocation = locations.find((location) => location.id === delivery.pickupLocationId)
    const dropoffLocation = locations.find((location) => location.id === delivery.dropoffLocationId)

    const courierWithSettings = delivery.courierId
      ? await this.courierDomainService.getByIdWithSettings(delivery.courierId)
      : null

    return {
      delivery,
      courierWithSettings,
      pickupLocation,
      dropoffLocation,
    }
  }

  async create(partnerId: string, input: DeliveryCreatePartnerInput) {
    const partner = await this.partnerDomainService.getById(partnerId)

    if (!partner) {
      throw new NotFoundException('Partner not found')
    }

    // Spec 0014, AC-6: refused before anything is created, so a quote taken before a stop cannot
    // place an order during it.
    const now = new Date()
    const stop = await this.dispatchStopRepository.findOn(now)
    if (stop) {
      throw new ServiceUnavailableException(restaurantStoppedMessage(stop, now))
    }

    const deliveryQuote = await this.deliveryQuoteDomainService.getByIdOrThrow(input.quoteId)
    // check if the quote has expired
    if (!deliveryQuote.expiresAt || deliveryQuote.expiresAt < new Date()) {
      throw new QuoteHasExpiredException('Delivery quote has expired')
    }

    const deliveryForQuote = await this.deliveryDomainService.getByDeliveryQuoteId(input.quoteId)
    if (deliveryForQuote) {
      throw new DeliveryForQuoteAlreadyExistsException('Delivery for quote already exists')
    }

    const deliveryQuoteLocations = await this.locationDomainService.getByIds([
      deliveryQuote.pickupLocationId,
      deliveryQuote.dropoffLocationId,
    ])
    const quotePickupLocation = deliveryQuoteLocations.find(
      (location) => location.id === deliveryQuote.pickupLocationId
    )
    const quoteDropoffLocation = deliveryQuoteLocations.find(
      (location) => location.id === deliveryQuote.dropoffLocationId
    )
    if (!quotePickupLocation || !quoteDropoffLocation) {
      throw new NotFoundException('Delivery quote locations not found')
    }

    const isValidPickupLocationDrift = await this.quoteToDeliveryConversionService.isValidDeliveryLocationDrift({
      fromLocation: {
        latitude: quotePickupLocation.latitude,
        longitude: quotePickupLocation.longitude,
      },
      toLocation: {
        latitude: input.pickupLatitude,
        longitude: input.pickupLongitude,
      },
    })
    if (!isValidPickupLocationDrift) {
      throw new DeliveryLocationDoesntMatchQuoteException("Delivery pickup location doesn't match quote location")
    }

    const isValidDropoffLocationDrift = await this.quoteToDeliveryConversionService.isValidDeliveryLocationDrift({
      fromLocation: {
        latitude: quoteDropoffLocation.latitude,
        longitude: quoteDropoffLocation.longitude,
      },
      toLocation: {
        latitude: input.dropoffLatitude,
        longitude: input.dropoffLongitude,
      },
    })
    if (!isValidDropoffLocationDrift) {
      throw new DeliveryLocationDoesntMatchQuoteException("Delivery dropoff location doesn't match quote location")
    }

    const pickupLocation = await this.locationDomainService.findOrCreate({
      ...input.pickupAddress,
      latitude: input.pickupLatitude,
      longitude: input.pickupLongitude,
    })
    const dropoffLocation = await this.locationDomainService.findOrCreate({
      ...input.dropoffAddress,
      latitude: input.dropoffLatitude,
      longitude: input.dropoffLongitude,
    })

    const delivery = await this.deliveryDomainService.create({
      pickupName: input.pickupName,
      pickupLocationId: pickupLocation.id,
      pickupPhoneNumber: input.pickupPhoneNumber,
      pickupBusinessName: input.pickupBusinessName,
      pickupNotes: input.pickupNotes,
      pickupVerification: input.pickupVerification as any as JsonValue,
      pickupReadyAt: input.pickupReadyAt,
      pickupDeadlineAt: input.pickupDeadlineAt,

      dropoffName: input.dropoffName,
      dropoffLocationId: dropoffLocation.id,
      dropoffPhoneNumber: input.dropoffPhoneNumber,
      dropoffBusinessName: input.dropoffBusinessName,
      dropoffNotes: input.dropoffNotes,
      dropoffReadyAt: input.dropoffReadyAt,
      dropoffEta: deliveryQuote.dropoffEta,
      dropoffDeadlineAt: input.dropoffDeadlineAt,
      dropoffSellerNotes: input.dropoffSellerNotes,
      dropoffFloor: optionalText(input.dropoffFloor),
      dropoffDoorbell: optionalText(input.dropoffDoorbell),
      dropoffVerification: input.dropoffVerification as any as JsonValue,

      deliverableAction: input.deliverableAction as EnumDeliverableAction,
      undeliverableAction: input.undeliverableAction as EnumUndeliverableAction,

      orderItems: input.orderItems as any as JsonValue,
      orderReference: input.orderReference,
      orderTotalValue: input.orderTotalValue,

      requiresDropoffSignature: input.requiresDropoffSignature,
      requiresId: input.requiresId,

      currencyCode: deliveryQuote.currency,
      idempotencyKey: input.idempotencyKey,

      externalStoreId: input.externalStoreId,
      returnVerification: input.returnVerification as any as JsonValue,
      externalId: input.externalId,

      totalCost: deliveryQuote.quote,

      tips: input.tip,

      partnerId: partnerId,
      deliveryQuoteId: deliveryQuote.id,
    })

    return delivery
  }

  async update(deliveryId: string, partnerId: string, input: DeliveryUpdatePartnerInput) {
    const delivery = await this.deliveryDomainService.getByIdOrThrow(deliveryId)
    await this.assertVisibleToPartner(delivery, partnerId)

    const dropoffLocation = await this.locationDomainService.getById(delivery.dropoffLocationId)
    if (!dropoffLocation) {
      throw new NotFoundException('Delivery locations not found')
    }

    const isValidDropoffLocationDrift = await this.quoteToDeliveryConversionService.isValidDeliveryLocationDrift({
      fromLocation: {
        latitude: dropoffLocation.latitude,
        longitude: dropoffLocation.longitude,
      },
      toLocation: {
        latitude: input.dropoffLatitude,
        longitude: input.dropoffLongitude,
      },
    })
    if (!isValidDropoffLocationDrift) {
      throw new DeliveryLocationDoesntMatchQuoteException("Delivery dropoff location doesn't match quote location")
    }

    // Row 102: a Location row is shared (`findOrCreate` reuses one for the same address and point),
    // so moving it in place would move every other delivery and quote on it too. A moved point gets a
    // row of its own: the old address with the new coordinates. An unmoved point changes nothing.
    const pointMoved =
      dropoffLocation.latitude !== input.dropoffLatitude || dropoffLocation.longitude !== input.dropoffLongitude
    const dropoffLocationId = pointMoved
      ? (
          await this.locationDomainService.create({
            addressLine1: dropoffLocation.addressLine1,
            addressLine2: dropoffLocation.addressLine2,
            city: dropoffLocation.city,
            state: dropoffLocation.state,
            street: dropoffLocation.street,
            zipCode: dropoffLocation.zipCode,
            countryCode: dropoffLocation.countryCode,
            stateCode: dropoffLocation.stateCode,
            houseNumber: dropoffLocation.houseNumber,
            formattedAddress: dropoffLocation.formattedAddress,
            latitude: input.dropoffLatitude,
            longitude: input.dropoffLongitude,
          })
        ).id
      : delivery.dropoffLocationId

    const updatedDelivery = await this.deliveryDomainService.update(delivery.id, {
      dropoffLocationId,
      pickupNotes: input.pickupNotes,
      pickupVerification: input.pickupVerification as any as JsonValue,
      pickupReadyAt: input.pickupReadyAt,
      pickupDeadlineAt: input.pickupDeadlineAt,

      dropoffNotes: input.dropoffNotes,
      dropoffReadyAt: input.dropoffReadyAt,
      dropoffDeadlineAt: input.dropoffDeadlineAt,
      dropoffVerification: input.dropoffVerification as any as JsonValue,

      orderReference: input.orderReference,

      tips: input.tipByCustomer,
    })

    return updatedDelivery
  }

  // `?? RESTAURANT`, not a default parameter: a default applies to undefined only, never to null.
  async cancel(deliveryId: string, partnerId: string, cancelledBy?: EnumCancelledBy | null) {
    const delivery = await this.deliveryDomainService.getByIdOrThrow(deliveryId)
    await this.assertVisibleToPartner(delivery, partnerId)

    const updatedDelivery = await this.deliveryDomainService.cancelDelivery(
      deliveryId,
      cancelledBy ?? EnumCancelledBy.RESTAURANT
    )

    return updatedDelivery
  }
}
