import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { EnumDispatchStopReason } from '@prisma/types'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import {
  DeliveryQuoteCreationFailureReason,
  DeliveryQuotePartnerRestApiService,
} from './delivery-quote.partner.rest-api.service'
import { DeliveryQuotePartnerRestApiController } from './delivery-quote.partner.rest-api.controller'

// Spec 0029, AC-4: POST partner/v1/delivery-quotes refuses with 409 when restaurant is disabled or paused.
// Disabled is checked first, and both are checked before dispatch stop.
describe('DeliveryQuotePartner - Availability checks (spec 0029, AC-4, decision 34.8)', () => {
  const partnerId = 'partner-1'
  // 12:00 UTC = 14:00 Athens time in winter.
  const NOW = new Date('2026-11-09T12:00:00.000Z')

  let service: DeliveryQuotePartnerRestApiService
  let controller: DeliveryQuotePartnerRestApiController
  let mockDeliveryQuoteDomainService: any
  let mockPartnerDomainService: any
  let mockLocationDomainService: any
  let mockCourierMatcherService: any
  let mockConfigDomainService: any
  let mockDispatchStopRepository: any

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

  const activeDispatchStop = {
    id: 'stop-heat-1',
    reason: EnumDispatchStopReason.HEAT,
    startsAt: new Date(NOW.getTime() - 60_000),
    endsAt: new Date(NOW.getTime() + 60 * 60_000),
    endedAt: null,
    cancelledAt: null,
    startedAt: new Date(NOW.getTime() - 60_000),
    createdByUserId: 'admin-1',
    createdAt: new Date(NOW.getTime() - 60_000),
  }

  const makePartner = (overrides: Partial<PartnerEntity> = {}): PartnerEntity =>
    new PartnerEntity({
      id: partnerId,
      name: 'To Steki',
      logo: null,
      phoneNumber: '+302421012345',
      webhookUrl: null,
      usualPrepMinutes: 15,
      busyExtraMinutes: null,
      pausedUntil: null,
      disabledAt: null,
      disabledReason: null,
      userId: 'user-1',
      pickupLocationId: 'loc-1',
      createdAt: new Date('2026-07-01T10:00:00Z'),
      updatedAt: new Date('2026-07-01T10:00:00Z'),
      ...overrides,
    })

  beforeEach(() => {
    jest.useFakeTimers('modern')
    jest.setSystemTime(NOW)

    mockDeliveryQuoteDomainService = { create: jest.fn(), getByIdOrThrow: jest.fn() }
    mockPartnerDomainService = { getById: jest.fn() }
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

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('Service: quote creation refusal', () => {
    test('returns PARTNER_NOT_ACCEPTING with disabled sentence when restaurant is disabled (AC-4)', async () => {
      mockPartnerDomainService.getById.mockResolvedValue(
        makePartner({
          disabledAt: NOW,
          disabledReason: 'Unregistered business',
        })
      )

      const result = await service.create(partnerId, baseInput)

      expect(result).toEqual({
        deliveryQuote: null,
        failureReason: DeliveryQuoteCreationFailureReason.PARTNER_NOT_ACCEPTING,
        failureMessage: 'The co-op has disabled this restaurant: Unregistered business',
      })
      // Location and courier matcher were not queried
      expect(mockLocationDomainService.findOrCreate).not.toHaveBeenCalled()
      expect(mockCourierMatcherService.findCourierForDelivery).not.toHaveBeenCalled()
    })

    test('returns PARTNER_NOT_ACCEPTING with paused sentence when restaurant is paused (AC-4)', async () => {
      // 12:30 UTC = 14:30 Athens time.
      const until = new Date('2026-11-09T12:30:00.000Z')
      mockPartnerDomainService.getById.mockResolvedValue(
        makePartner({
          pausedUntil: until,
        })
      )

      const result = await service.create(partnerId, baseInput)

      expect(result).toEqual({
        deliveryQuote: null,
        failureReason: DeliveryQuoteCreationFailureReason.PARTNER_NOT_ACCEPTING,
        failureMessage: 'Ordering is paused until 14:30.',
      })
      expect(mockLocationDomainService.findOrCreate).not.toHaveBeenCalled()
      expect(mockCourierMatcherService.findCourierForDelivery).not.toHaveBeenCalled()
    })

    test('disabled is checked before paused: returns disabled failure when both are set (AC-4)', async () => {
      const until = new Date('2026-11-09T12:30:00.000Z')
      mockPartnerDomainService.getById.mockResolvedValue(
        makePartner({
          disabledAt: NOW,
          disabledReason: 'Safety investigation',
          pausedUntil: until,
        })
      )

      const result = await service.create(partnerId, baseInput)

      expect(result).toEqual({
        deliveryQuote: null,
        failureReason: DeliveryQuoteCreationFailureReason.PARTNER_NOT_ACCEPTING,
        failureMessage: 'The co-op has disabled this restaurant: Safety investigation',
      })
    })

    test('both are checked before dispatch stop: returns PARTNER_NOT_ACCEPTING when dispatch is stopped (AC-4)', async () => {
      mockPartnerDomainService.getById.mockResolvedValue(
        makePartner({
          disabledAt: NOW,
          disabledReason: 'Late paperwork',
        })
      )
      mockDispatchStopRepository.findOn.mockResolvedValue(activeDispatchStop)

      const result = await service.create(partnerId, baseInput)

      expect(result.failureReason).toBe(DeliveryQuoteCreationFailureReason.PARTNER_NOT_ACCEPTING)
      expect(result.failureMessage).toBe('The co-op has disabled this restaurant: Late paperwork')
    })

    test('throws 404 NotFoundException when partner is not found in database', async () => {
      mockPartnerDomainService.getById.mockResolvedValue(null)

      await expect(service.create('unknown-partner', baseInput)).rejects.toThrow(
        new NotFoundException('Partner not found')
      )
    })
  })

  describe('Controller: 409 response (decision 34.8)', () => {
    test('throws ConflictException (409) with disabled sentence when reason is PARTNER_NOT_ACCEPTING (AC-4)', async () => {
      const partner = makePartner({
        disabledAt: NOW,
        disabledReason: 'Administrative hold',
      })
      mockPartnerDomainService.getById.mockResolvedValue(partner)

      await expect(controller.createDeliveryQuote(baseInput, partner)).rejects.toThrow(
        new ConflictException('The co-op has disabled this restaurant: Administrative hold')
      )
    })

    test('throws ConflictException (409) with paused sentence when reason is PARTNER_NOT_ACCEPTING (AC-4)', async () => {
      const until = new Date('2026-11-09T12:45:00.000Z') // 14:45 Athens
      const partner = makePartner({
        pausedUntil: until,
      })
      mockPartnerDomainService.getById.mockResolvedValue(partner)

      await expect(controller.createDeliveryQuote(baseInput, partner)).rejects.toThrow(
        new ConflictException('Ordering is paused until 14:45.')
      )
    })

    test('returns quote when restaurant is accepting orders (busy mode does not refuse)', async () => {
      const partner = makePartner({
        busyExtraMinutes: 15,
        pausedUntil: null,
        disabledAt: null,
      })
      mockPartnerDomainService.getById.mockResolvedValue(partner)

      const sampleQuote = {
        id: 'quote-1',
        partnerId,
        fee: 300,
        amount: 300,
        createdAt: NOW,
        expiresAt: new Date(NOW.getTime() + 15 * 60_000),
      }
      mockLocationDomainService.findOrCreate.mockResolvedValue({ id: 'loc-1' })
      mockCourierMatcherService.findCourierForDelivery.mockResolvedValue({ id: 'courier-1' })
      mockDeliveryQuoteDomainService.create.mockResolvedValue(sampleQuote)

      const result = await controller.createDeliveryQuote(baseInput, partner)

      expect(result.id).toBe('quote-1')
    })
  })
})
