import { EnumDeliveryEventSource, EnumDeliveryEventType, EnumDeliveryStatus, EnumEventActor } from '@prisma/types'
import { DeliveryDomainService } from './delivery.domain.service'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { PartnerRepository } from 'src/persistence/repositories/partner.repository'

// Spec 0029, AC-2: busy mode adds its minutes to every new order's readyAt, whether picked or usual,
// and appends ", busy mode +X min" to the CREATED event message. pickupReadyAt is untouched.
describe('DeliveryDomainService busy mode on creation (spec 0029, AC-2)', () => {
  const MINUTE = 60 * 1000
  // 12:00 UTC = 14:00 Athens time in winter.
  const NOW = new Date('2026-11-09T12:00:00.000Z')

  let service: DeliveryDomainService
  let deliveryRepository: any
  let deliveryEventService: any
  let partnerRepository: any

  beforeEach(() => {
    jest.useFakeTimers('modern')
    jest.setSystemTime(NOW)

    deliveryRepository = {
      create: jest.fn().mockImplementation(async (data) => ({
        id: 'del-123',
        status: EnumDeliveryStatus.CREATED,
        ...data,
      })),
      findByIdOrThrow: jest.fn(),
      update: jest.fn(),
      updateIfMatches: jest.fn(),
    }

    deliveryEventService = {
      processDeliveryEvent: jest.fn().mockResolvedValue(undefined),
    }

    partnerRepository = {
      findById: jest.fn(),
    }

    service = new DeliveryDomainService(
      deliveryRepository as DeliveryRepository,
      { emit: jest.fn() } as any,
      { getOrDefault: jest.fn(), save: jest.fn() } as any,
      deliveryEventService as DeliveryEventService,
      { update: jest.fn(), findByIdOrThrow: jest.fn() } as any,
      { create: jest.fn(), deleteById: jest.fn() } as any,
      {} as any,
      partnerRepository as PartnerRepository
    )
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('adds busyExtraMinutes to usual prep time when restaurant picked no time (AC-2)', async () => {
    // usualPrepMinutes = 20, busyExtraMinutes = 15 -> ready in 35 min (12:35 UTC = 14:35 Athens)
    partnerRepository.findById.mockResolvedValue({
      id: 'partner-1',
      usualPrepMinutes: 20,
      busyExtraMinutes: 15,
    })

    const input: any = {
      partnerId: 'partner-1',
      pickupReadyAt: null,
    }

    const result = await service.create(input)

    const expectedReadyAt = new Date(NOW.getTime() + (20 + 15) * MINUTE)
    expect(deliveryRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        partnerId: 'partner-1',
        pickupReadyAt: null,
        readyAt: expectedReadyAt,
      })
    )
    expect(result.readyAt).toEqual(expectedReadyAt)

    // CREATED event mentions Athens clock time (14:35) and ", busy mode +15 min"
    expect(deliveryEventService.processDeliveryEvent).toHaveBeenCalledWith({
      deliveryId: 'del-123',
      type: EnumDeliveryEventType.CREATED,
      actor: EnumEventActor.PARTNER,
      source: EnumDeliveryEventSource.PARTNER_APP,
      message: 'Delivery was created delivery del-123 from partner partner-1, ready at 14:35, busy mode +15 min',
    })
  })

  test('adds busyExtraMinutes to a picked pickupReadyAt time without touching pickupReadyAt (AC-2)', async () => {
    // Restaurant picked ready in 10 min (12:10 UTC); busy adds 20 min -> readyAt = 12:30 UTC (14:30 Athens)
    partnerRepository.findById.mockResolvedValue({
      id: 'partner-1',
      usualPrepMinutes: 15,
      busyExtraMinutes: 20,
    })

    const pickedTime = new Date(NOW.getTime() + 10 * MINUTE)
    const input: any = {
      partnerId: 'partner-1',
      pickupReadyAt: pickedTime.toISOString(),
    }

    await service.create(input)

    const expectedReadyAt = new Date(pickedTime.getTime() + 20 * MINUTE)
    expect(deliveryRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        pickupReadyAt: pickedTime.toISOString(),
        readyAt: expectedReadyAt,
      })
    )

    expect(deliveryEventService.processDeliveryEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: EnumDeliveryEventType.CREATED,
        message: 'Delivery was created delivery del-123 from partner partner-1, ready at 14:30, busy mode +20 min',
      })
    )
  })

  test('when busy mode is OFF (null), readyAt uses initialReadyAt and CREATED message has no busy suffix', async () => {
    partnerRepository.findById.mockResolvedValue({
      id: 'partner-1',
      usualPrepMinutes: 15,
      busyExtraMinutes: null,
    })

    const input: any = {
      partnerId: 'partner-1',
      pickupReadyAt: null,
    }

    await service.create(input)

    const expectedReadyAt = new Date(NOW.getTime() + 15 * MINUTE) // 12:15 UTC = 14:15 Athens
    expect(deliveryRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        readyAt: expectedReadyAt,
      })
    )

    expect(deliveryEventService.processDeliveryEvent).toHaveBeenCalledWith({
      deliveryId: 'del-123',
      type: EnumDeliveryEventType.CREATED,
      actor: EnumEventActor.PARTNER,
      source: EnumDeliveryEventSource.PARTNER_APP,
      message: 'Delivery was created delivery del-123 from partner partner-1, ready at 14:15',
    })
  })

  test('when partner is not found or has no usualPrepMinutes, falls back to default 15 min with no busy suffix', async () => {
    partnerRepository.findById.mockResolvedValue(null)

    const input: any = {
      partnerId: 'unknown-partner',
      pickupReadyAt: null,
    }

    await service.create(input)

    const expectedReadyAt = new Date(NOW.getTime() + 15 * MINUTE)
    expect(deliveryRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        readyAt: expectedReadyAt,
      })
    )

    expect(deliveryEventService.processDeliveryEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.not.stringContaining('busy mode'),
      })
    )
  })
})
