import { DeliveryDomainService } from './delivery.domain.service'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import {
  EnumDeliveryStatus,
  EnumDeliveryEventType,
} from 'src/shared-types'

describe('DeliveryDomainService.markFoodReady - Offer Timing (Spec 0031: AC-7)', () => {
  let service: DeliveryDomainService
  let deliveryRepository: any
  let deliveryEventService: any
  let configDomainService: any
  let instanceConfig: any

  const NOW = new Date(1794142800000)

  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(NOW)

    deliveryRepository = {
      findByIdOrThrow: jest.fn(),
      updateIfMatches: jest.fn().mockResolvedValue(true),
    }

    deliveryEventService = {
      recordReadyEvent: jest.fn().mockResolvedValue(undefined),
      notifyReadyUpdated: jest.fn().mockResolvedValue(undefined),
      offerOrWait: jest.fn().mockResolvedValue(undefined),
    }

    instanceConfig = {
      getOfferTimingEnabled: jest.fn().mockResolvedValue(true),
    }

    configDomainService = {
      instanceConfig,
    }

    service = new DeliveryDomainService(
      deliveryRepository as DeliveryRepository,
      { emit: jest.fn() } as any,
      { getOrDefault: jest.fn(), save: jest.fn() } as any,
      deliveryEventService as DeliveryEventService,
      {} as any,
      {} as any,
      configDomainService,
      { findById: jest.fn() } as any
    )
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  function baseDelivery(overrides: Record<string, any> = {}) {
    return {
      id: 'del-1',
      status: EnumDeliveryStatus.ASSIGNING_COURIER,
      matchedCourierId: null,
      courierId: null,
      foodReadyAt: null,
      readyAt: new Date(NOW.getTime() + 15 * 60_000),
      ...overrides,
    }
  }

  describe('AC-7: markFoodReady runs offerOrWait only for a delivery still waiting with timing on', () => {
    it('runs offerOrWait when delivery is ASSIGNING_COURIER, has no courier, and offerTimingEnabled is true', async () => {
      const initial = baseDelivery()
      const updated = { ...initial, foodReadyAt: NOW }

      deliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(updated)

      await service.markFoodReady('del-1')

      // Record ready event and notify
      expect(deliveryEventService.recordReadyEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.FOOD_READY,
          deliveryId: 'del-1',
        }),
        EnumDeliveryStatus.ASSIGNING_COURIER
      )
      expect(deliveryEventService.notifyReadyUpdated).toHaveBeenCalledWith(updated, null)

      // AC-7: runs offerOrWait immediately on the waiting delivery
      expect(deliveryEventService.offerOrWait).toHaveBeenCalledTimes(1)
      expect(deliveryEventService.offerOrWait).toHaveBeenCalledWith('del-1')
    })

    it('does NOT run offerOrWait when offerTimingEnabled is false', async () => {
      instanceConfig.getOfferTimingEnabled.mockResolvedValue(false)

      const initial = baseDelivery()
      const updated = { ...initial, foodReadyAt: NOW }

      deliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(updated)

      await service.markFoodReady('del-1')

      expect(deliveryEventService.offerOrWait).not.toHaveBeenCalled()
    })

    it('does NOT run offerOrWait when an offer is already out (matchedCourierId is set)', async () => {
      const initial = baseDelivery({ matchedCourierId: 'courier-offered' })
      const updated = { ...initial, foodReadyAt: NOW }

      deliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(updated)

      await service.markFoodReady('del-1')

      expect(deliveryEventService.offerOrWait).not.toHaveBeenCalled()
    })

    it('does NOT run offerOrWait when a rider has accepted (courierId is set)', async () => {
      const initial = baseDelivery({ courierId: 'courier-assigned' })
      const updated = { ...initial, foodReadyAt: NOW }

      deliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(updated)

      await service.markFoodReady('del-1')

      expect(deliveryEventService.offerOrWait).not.toHaveBeenCalled()
    })

    it('does NOT run offerOrWait when delivery is in ongoing status (e.g. DISPATCHED)', async () => {
      const initial = baseDelivery({
        status: EnumDeliveryStatus.DISPATCHED,
        courierId: 'courier-working',
      })
      const updated = { ...initial, foodReadyAt: NOW }

      deliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(updated)

      await service.markFoodReady('del-1')

      expect(deliveryEventService.offerOrWait).not.toHaveBeenCalled()
    })

    it('does not reject markFoodReady when offerOrWait throws an error', async () => {
      const initial = baseDelivery()
      const updated = { ...initial, foodReadyAt: NOW }

      deliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(updated)

      deliveryEventService.offerOrWait.mockRejectedValueOnce(
        new Error('BullMQ connection failure during offerOrWait')
      )

      // The restaurant's tap is already saved and notified; offer failure must not reject markFoodReady
      await expect(service.markFoodReady('del-1')).resolves.toEqual(updated)
      expect(deliveryEventService.offerOrWait).toHaveBeenCalledWith('del-1')
    })
  })
})
