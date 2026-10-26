import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { DeliveryQuoteDomainService } from 'src/domains/delivery-quote/delivery-quote.domain.service'
import { LocationDomainService } from 'src/domains/location/location.domain.service'
import { PartnerDomainService } from 'src/domains/partner/partner.domain.service'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { CourierMatcherService } from 'src/services/courier-matcher/courier-matcher.service'
import {
  DeliveryQuoteCreationFailureReason,
  DeliveryQuotePartnerRestApiService,
} from './delivery-quote.partner.rest-api.service'

describe('DeliveryQuotePartnerRestApiService - service area check (AC-10)', () => {
  let service: DeliveryQuotePartnerRestApiService
  let deliveryQuoteDomainService: jest.Mocked<DeliveryQuoteDomainService>
  let partnerDomainService: jest.Mocked<PartnerDomainService>
  let locationDomainService: jest.Mocked<LocationDomainService>
  let courierMatcherService: jest.Mocked<CourierMatcherService>
  let configDomainService: jest.Mocked<ConfigDomainService>

  const partnerId = 'partner-1'
  const mockPartner = new PartnerEntity({
    id: partnerId,
  } as any)

  // Square polygon around Volos center (lat 39.35..39.40, lng 22.90..23.00)
  const serviceAreaPolygon = {
    type: 'Polygon',
    coordinates: [
      [
        [22.90, 39.35],
        [23.00, 39.35],
        [23.00, 39.40],
        [22.90, 39.40],
        [22.90, 39.35],
      ],
    ],
  }

  const baseInput: any = {
    pickupAddress: { street: 'Iasonos 1', city: 'Volos' },
    pickupLatitude: 39.362,
    pickupLongitude: 22.945,
    dropoffAddress: { street: 'Dimitriadis 2', city: 'Volos' },
    dropoffLatitude: 39.365,
    dropoffLongitude: 22.948,
    pickupPhoneNumber: '+302421012345',
    dropoffPhoneNumber: '+306912345678',
  }

  beforeEach(() => {
    deliveryQuoteDomainService = {
      create: jest.fn(),
    } as any

    partnerDomainService = {
      getById: jest.fn().mockResolvedValue(mockPartner),
    } as any

    locationDomainService = {
      findOrCreate: jest.fn(async (args) => ({
        id: 'loc-id',
        latitude: args.latitude,
        longitude: args.longitude,
      })),
    } as any

    courierMatcherService = {
      findCourierForDelivery: jest.fn().mockResolvedValue({ id: 'courier-1' }),
    } as any

    configDomainService = {
      instanceConfig: {
        getDetails: jest.fn().mockResolvedValue({ region: serviceAreaPolygon }),
      },
    } as any

    service = new DeliveryQuotePartnerRestApiService(
      deliveryQuoteDomainService,
      partnerDomainService,
      locationDomainService,
      courierMatcherService,
      configDomainService
    )
  })

  it('refuses quote when pickup location is outside service area', async () => {
    const input = {
      ...baseInput,
      pickupLatitude: 39.55, // Outside polygon
      pickupLongitude: 22.945,
    }

    const result = await service.create(partnerId, input)

    expect(result).toEqual({
      deliveryQuote: null,
      failureReason: DeliveryQuoteCreationFailureReason.OUTSIDE_SERVICE_AREA,
    })
    expect(courierMatcherService.findCourierForDelivery).not.toHaveBeenCalled()
  })

  it('refuses quote when dropoff location is outside service area', async () => {
    const input = {
      ...baseInput,
      dropoffLatitude: 39.55, // Outside polygon
      dropoffLongitude: 22.948,
    }

    const result = await service.create(partnerId, input)

    expect(result).toEqual({
      deliveryQuote: null,
      failureReason: DeliveryQuoteCreationFailureReason.OUTSIDE_SERVICE_AREA,
    })
    expect(courierMatcherService.findCourierForDelivery).not.toHaveBeenCalled()
  })

  it('proceeds with finding courier and creating quote when both locations are inside service area', async () => {
    deliveryQuoteDomainService.create.mockResolvedValue({ id: 'quote-123' } as any)

    const result = await service.create(partnerId, baseInput)

    expect(courierMatcherService.findCourierForDelivery).toHaveBeenCalled()
    expect(result.deliveryQuote).toBeDefined()
    expect(result.failureReason).toBeUndefined()
  })
})
