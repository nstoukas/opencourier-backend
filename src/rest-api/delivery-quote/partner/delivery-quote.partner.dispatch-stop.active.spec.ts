import { ServiceUnavailableException } from '@nestjs/common'
import { EnumDispatchStopReason } from '@prisma/types'
import {
  DeliveryQuoteCreationFailureReason,
  DeliveryQuotePartnerRestApiService,
} from './delivery-quote.partner.rest-api.service'
import { DeliveryQuotePartnerRestApiController } from './delivery-quote.partner.rest-api.controller'
import { dayjs } from 'src/core/utils/time'
import { INSTANCE_TIMEZONE } from 'src/constants'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'

describe('Delivery Quote Partner - Dispatch Stop (Spec 0014, AC-6)', () => {
  let service: DeliveryQuotePartnerRestApiService
  let controller: DeliveryQuotePartnerRestApiController

  let mockDeliveryQuoteDomainService: any
  let mockPartnerDomainService: any
  let mockLocationDomainService: any
  let mockCourierMatcherService: any
  let mockConfigDomainService: any
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
    mockDeliveryQuoteDomainService = { create: jest.fn(), getByIdOrThrow: jest.fn() }
    mockPartnerDomainService = { getById: jest.fn().mockResolvedValue(mockPartner) }
    mockLocationDomainService = { findOrCreate: jest.fn() }
    mockCourierMatcherService = { findCourierForDelivery: jest.fn() }
    mockConfigDomainService = {
      instanceConfig: {
        getDetails: jest.fn().mockResolvedValue({}),
      },
    }
    mockDispatchStopRepository = {
      findOn: jest.fn().mockResolvedValue(null),
    }

    service = new DeliveryQuotePartnerRestApiService(
      mockDeliveryQuoteDomainService,
      mockPartnerDomainService,
      mockLocationDomainService,
      mockCourierMatcherService,
      mockConfigDomainService,
      mockDispatchStopRepository
    )

    controller = new DeliveryQuotePartnerRestApiController(service)
  })

  describe('Service: quote creation refusal', () => {
    test('returns DISPATCH_STOPPED with restaurant sentence and creates no location when dispatch is stopped', async () => {
      mockDispatchStopRepository.findOn.mockResolvedValue(activeStop)

      const result = await service.create(partnerId, baseInput)

      expect(result).toEqual({
        deliveryQuote: null,
        failureReason: DeliveryQuoteCreationFailureReason.DISPATCH_STOPPED,
        failureMessage: 'Delivery is stopped until 17:00 (heat).',
      })
      // Neither locations nor partner were queried
      expect(mockLocationDomainService.findOrCreate).not.toHaveBeenCalled()
      expect(mockPartnerDomainService.getById).not.toHaveBeenCalled()
      expect(mockCourierMatcherService.findCourierForDelivery).not.toHaveBeenCalled()
    })
  })

  describe('Controller: 503 response', () => {
    test('throws ServiceUnavailableException (503) with the stop sentence when reason is DISPATCH_STOPPED', async () => {
      mockDispatchStopRepository.findOn.mockResolvedValue(activeStop)

      await expect(controller.createDeliveryQuote(baseInput, mockPartner)).rejects.toThrow(
        new ServiceUnavailableException('Delivery is stopped until 17:00 (heat).')
      )
    })
  })
})
