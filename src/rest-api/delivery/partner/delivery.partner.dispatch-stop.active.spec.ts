import { ServiceUnavailableException } from '@nestjs/common'
import { EnumDispatchStopReason } from '@prisma/types'
import { DeliveryPartnerRestApiService } from './delivery.partner.rest-api.service'
import { dayjs } from 'src/core/utils/time'
import { INSTANCE_TIMEZONE } from 'src/constants'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'

describe('Delivery Partner RestApiService - Dispatch Stop (Spec 0014, AC-6)', () => {
  let service: DeliveryPartnerRestApiService

  let mockDeliveryQuoteDomainService: any
  let mockDeliveryDomainService: any
  let mockPartnerDomainService: any
  let mockLocationDomainService: any
  let mockCourierDomainService: any
  let mockQuoteToDeliveryConversionService: any
  let mockDispatchStopRepository: any

  const partnerId = 'partner-1'
  const mockPartner = new PartnerEntity({ id: partnerId } as any)

  const today17Athens = dayjs().tz(INSTANCE_TIMEZONE).hour(17).minute(0).second(0).millisecond(0).toDate()
  const todayStartAthens = dayjs().tz(INSTANCE_TIMEZONE).hour(12).minute(0).second(0).millisecond(0).toDate()

  const activeStop = {
    id: 'stop-heat-1',
    reason: EnumDispatchStopReason.HEAT,
    startsAt: todayStartAthens,
    endsAt: today17Athens,
    endedAt: null,
    cancelledAt: null,
    startedAt: todayStartAthens,
    createdByUserId: 'admin-1',
    createdAt: todayStartAthens,
    endedByUserId: null,
    cancelledByUserId: null,
    endWorkDoneAt: null,
  }

  beforeEach(() => {
    mockDeliveryQuoteDomainService = {
      getByIdOrThrow: jest.fn(),
    }
    mockDeliveryDomainService = {
      getByDeliveryQuoteId: jest.fn(),
      create: jest.fn(),
    }
    mockPartnerDomainService = {
      getById: jest.fn().mockResolvedValue(mockPartner),
    }
    mockLocationDomainService = {
      getByIds: jest.fn(),
    }
    mockCourierDomainService = {
      getByIdWithSettings: jest.fn(),
    }
    mockQuoteToDeliveryConversionService = {
      convert: jest.fn(),
    }
    mockDispatchStopRepository = {
      findOn: jest.fn().mockResolvedValue(null),
    }

    service = new DeliveryPartnerRestApiService(
      mockDeliveryQuoteDomainService,
      mockDeliveryDomainService,
      mockPartnerDomainService,
      mockLocationDomainService,
      mockCourierDomainService,
      mockQuoteToDeliveryConversionService,
      mockDispatchStopRepository,
      // Spec 0017: the history period (30 days), added by hand so the suite compiles.
      { instanceConfig: { getRestaurantHistoryDays: async () => 30 } } as any
    )
  })

  test('delivery creation answers 503 before any quote lookup, expiration check or delivery creation', async () => {
    mockDispatchStopRepository.findOn.mockResolvedValue(activeStop)

    const input: any = { quoteId: 'quote-123' }

    await expect(service.create(partnerId, input)).rejects.toThrow(
      new ServiceUnavailableException('Delivery is stopped until 17:00 (heat).')
    )

    // Critical assertion: quote was NOT looked up and delivery was NOT created
    expect(mockDeliveryQuoteDomainService.getByIdOrThrow).not.toHaveBeenCalled()
    expect(mockDeliveryDomainService.getByDeliveryQuoteId).not.toHaveBeenCalled()
    expect(mockDeliveryDomainService.create).not.toHaveBeenCalled()
  })
})
