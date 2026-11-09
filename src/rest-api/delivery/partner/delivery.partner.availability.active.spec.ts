import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { EnumDispatchStopReason } from '@prisma/types'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { DeliveryPartnerRestApiService } from './delivery.partner.rest-api.service'

// Spec 0029, AC-4: POST partner/v1/deliveries refuses with 409 when restaurant is disabled or paused.
// Disabled is checked first, and both are checked before dispatch stop.
describe('DeliveryPartnerRestApiService - Availability checks (spec 0029, AC-4)', () => {
  const partnerId = 'partner-1'
  // 12:00 UTC = 14:00 Athens time in winter.
  const NOW = new Date('2026-11-09T12:00:00.000Z')

  let service: DeliveryPartnerRestApiService
  let mockDeliveryQuoteDomainService: any
  let mockDeliveryDomainService: any
  let mockPartnerDomainService: any
  let mockLocationDomainService: any
  let mockCourierDomainService: any
  let mockQuoteToDeliveryConversionService: any
  let mockDispatchStopRepository: any

  const baseInput: any = { quoteId: 'quote-123' }

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

    mockDeliveryQuoteDomainService = {
      getByIdOrThrow: jest.fn().mockResolvedValue({
        id: 'quote-123',
        expiresAt: new Date(NOW.getTime() + 10 * 60_000),
        pickupLocationId: 'loc-pickup',
        dropoffLocationId: 'loc-dropoff',
      }),
    }
    mockDeliveryDomainService = {
      getByDeliveryQuoteId: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'del-123' }),
    }
    mockPartnerDomainService = {
      getById: jest.fn(),
    }
    mockLocationDomainService = {
      getByIds: jest.fn().mockResolvedValue([{ id: 'loc-pickup' }, { id: 'loc-dropoff' }]),
      findOrCreate: jest.fn().mockResolvedValue({ id: 'loc-1' }),
    }
    mockCourierDomainService = {
      getByIdWithSettings: jest.fn(),
    }
    mockQuoteToDeliveryConversionService = {
      isValidDeliveryLocationDrift: jest.fn().mockReturnValue(true),
      convert: jest.fn().mockResolvedValue({ partnerId }),
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
      { instanceConfig: { getRestaurantHistoryDays: async () => 30 } } as any,
      {} as any
    )
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('throws 409 ConflictException when restaurant is disabled by the co-op (AC-4)', async () => {
    mockPartnerDomainService.getById.mockResolvedValue(
      makePartner({
        disabledAt: NOW,
        disabledReason: 'Health and safety review',
      })
    )

    await expect(service.create(partnerId, baseInput)).rejects.toThrow(
      new ConflictException('The co-op has disabled this restaurant: Health and safety review')
    )

    // Nothing created or looked up
    expect(mockDeliveryQuoteDomainService.getByIdOrThrow).not.toHaveBeenCalled()
    expect(mockDeliveryDomainService.create).not.toHaveBeenCalled()
  })

  test('throws 409 ConflictException with Athens clock time when restaurant is paused (AC-4)', async () => {
    // 12:30 UTC = 14:30 Athens time.
    const until = new Date('2026-11-09T12:30:00.000Z')
    mockPartnerDomainService.getById.mockResolvedValue(
      makePartner({
        pausedUntil: until,
      })
    )

    await expect(service.create(partnerId, baseInput)).rejects.toThrow(
      new ConflictException('Ordering is paused until 14:30.')
    )

    // Nothing created or looked up
    expect(mockDeliveryQuoteDomainService.getByIdOrThrow).not.toHaveBeenCalled()
    expect(mockDeliveryDomainService.create).not.toHaveBeenCalled()
  })

  test('disabled is checked before paused: answers disabled sentence when both are present (AC-4)', async () => {
    const until = new Date('2026-11-09T12:30:00.000Z')
    mockPartnerDomainService.getById.mockResolvedValue(
      makePartner({
        disabledAt: NOW,
        disabledReason: 'Subscription lapse',
        pausedUntil: until,
      })
    )

    await expect(service.create(partnerId, baseInput)).rejects.toThrow(
      new ConflictException('The co-op has disabled this restaurant: Subscription lapse')
    )
  })

  test('both are checked before dispatch stop: answers 409 (not 503) when disabled and dispatch is stopped (AC-4)', async () => {
    mockPartnerDomainService.getById.mockResolvedValue(
      makePartner({
        disabledAt: NOW,
        disabledReason: 'Account suspended',
      })
    )
    mockDispatchStopRepository.findOn.mockResolvedValue(activeDispatchStop)

    // Must be ConflictException (409), not ServiceUnavailableException (503)
    await expect(service.create(partnerId, baseInput)).rejects.toThrow(
      new ConflictException('The co-op has disabled this restaurant: Account suspended')
    )
  })

  test('both are checked before dispatch stop: answers 409 (not 503) when paused and dispatch is stopped (AC-4)', async () => {
    const until = new Date('2026-11-09T12:30:00.000Z')
    mockPartnerDomainService.getById.mockResolvedValue(
      makePartner({
        pausedUntil: until,
      })
    )
    mockDispatchStopRepository.findOn.mockResolvedValue(activeDispatchStop)

    await expect(service.create(partnerId, baseInput)).rejects.toThrow(
      new ConflictException('Ordering is paused until 14:30.')
    )
  })

  test('allows delivery creation when restaurant is accepting orders (busy mode on does not refuse) (AC-4)', async () => {
    mockPartnerDomainService.getById.mockResolvedValue(
      makePartner({
        busyExtraMinutes: 15,
        pausedUntil: null,
        disabledAt: null,
      })
    )

    await service.create(partnerId, baseInput)

    expect(mockDeliveryQuoteDomainService.getByIdOrThrow).toHaveBeenCalledWith('quote-123')
    expect(mockDeliveryDomainService.create).toHaveBeenCalled()
  })

  test('throws 404 NotFoundException when partner is not found in database', async () => {
    mockPartnerDomainService.getById.mockResolvedValue(null)

    await expect(service.create('unknown-partner', baseInput)).rejects.toThrow(
      new NotFoundException('Partner not found')
    )
    expect(mockDeliveryQuoteDomainService.getByIdOrThrow).not.toHaveBeenCalled()
  })
})
