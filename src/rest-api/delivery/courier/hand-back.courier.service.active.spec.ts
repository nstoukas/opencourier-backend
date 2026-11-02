import { ConflictException } from '@nestjs/common'
import { EnumDeliveryStatus } from '@prisma/types'
import {
  AT_RESTAURANT_MESSAGE,
  ORDER_CHANGED_MESSAGE,
  windowOverMessage,
  HandBackCourierService,
} from './hand-back.courier.service'
import { DeliveryNotFoundException } from 'src/errors'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { OFFER_EXPIRY_GRACE_SECONDS } from 'src/constants'

describe('HandBackCourierService (Spec 0020 AC-5)', () => {
  let service: HandBackCourierService
  let mockDeliveryRepository: jest.Mocked<DeliveryRepository>
  let mockConfigDomainService: any
  let mockDeliveryEventService: jest.Mocked<DeliveryEventService>

  const courierId = 'courier-test-1'
  const deliveryId = 'del-test-100'

  beforeEach(() => {
    mockDeliveryRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<DeliveryRepository>

    mockConfigDomainService = {
      instanceConfig: {
        getHandBackSeconds: jest.fn().mockResolvedValue(60),
      },
    }

    mockDeliveryEventService = {
      handBack: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<DeliveryEventService>

    service = new HandBackCourierService(
      mockDeliveryRepository,
      mockConfigDomainService as ConfigDomainService,
      mockDeliveryEventService
    )
  })

  describe('windowOverMessage formatting', () => {
    it('formats 60 seconds as "1 minute"', () => {
      expect(windowOverMessage(60)).toBe(
        'The first minute is over. Report an issue or call dispatch to give this order back.'
      )
    })

    it('formats 120 seconds as "2 minutes"', () => {
      expect(windowOverMessage(120)).toBe(
        'The first 2 minutes are over. Report an issue or call dispatch to give this order back.'
      )
    })

    it('formats 1 second as "1 second"', () => {
      expect(windowOverMessage(1)).toBe(
        'The first second is over. Report an issue or call dispatch to give this order back.'
      )
    })

    it('formats 90 seconds as "90 seconds"', () => {
      expect(windowOverMessage(90)).toBe(
        'The first 90 seconds are over. Report an issue or call dispatch to give this order back.'
      )
    })

    it('formats 0 or negative as switched off sentence', () => {
      expect(windowOverMessage(0)).toBe(
        'Handing back is switched off. Report an issue or call dispatch to give this order back.'
      )
      expect(windowOverMessage(-1)).toBe(
        'Handing back is switched off. Report an issue or call dispatch to give this order back.'
      )
    })
  })

  describe('Order of checks in handBack', () => {
    it('Check 1: throws DeliveryNotFoundException (404) when delivery does not exist', async () => {
      mockDeliveryRepository.findById.mockResolvedValue(null)

      await expect(service.handBack(deliveryId, courierId)).rejects.toThrow(DeliveryNotFoundException)
      expect(mockDeliveryEventService.handBack).not.toHaveBeenCalled()
    })

    it('Check 1: throws DeliveryNotFoundException (404) when delivery belongs to another rider', async () => {
      mockDeliveryRepository.findById.mockResolvedValue({
        id: deliveryId,
        courierId: 'courier-other',
        status: EnumDeliveryStatus.ACCEPTED,
        handBackUntil: new Date(Date.now() + 60000),
      } as any)

      await expect(service.handBack(deliveryId, courierId)).rejects.toThrow(DeliveryNotFoundException)
      expect(mockDeliveryEventService.handBack).not.toHaveBeenCalled()
    })

    it('Check 2: throws 409 with AT_RESTAURANT_MESSAGE when status is not ACCEPTED or DISPATCHED', async () => {
      for (const nonHandBackStatus of [
        EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
        EnumDeliveryStatus.PICKED_UP,
        EnumDeliveryStatus.ON_THE_WAY,
        EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
        EnumDeliveryStatus.DROPPED_OFF,
        EnumDeliveryStatus.CANCELED,
        EnumDeliveryStatus.FAILED,
      ]) {
        mockDeliveryRepository.findById.mockResolvedValue({
          id: deliveryId,
          courierId,
          status: nonHandBackStatus,
          handBackUntil: null, // Even with expired or null date, Check 2 must fire first
        } as any)

        await expect(service.handBack(deliveryId, courierId)).rejects.toThrow(ConflictException)
        await expect(service.handBack(deliveryId, courierId)).rejects.toThrow(AT_RESTAURANT_MESSAGE)
      }

      // Check 2 must check status BEFORE checking handBackUntil
      expect(mockConfigDomainService.instanceConfig.getHandBackSeconds).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.handBack).not.toHaveBeenCalled()
    })

    it('Check 3: throws 409 with windowOverMessage when handBackUntil is null', async () => {
      mockDeliveryRepository.findById.mockResolvedValue({
        id: deliveryId,
        courierId,
        status: EnumDeliveryStatus.ACCEPTED,
        handBackUntil: null,
      } as any)
      mockConfigDomainService.instanceConfig.getHandBackSeconds.mockResolvedValue(60)

      await expect(service.handBack(deliveryId, courierId)).rejects.toThrow(ConflictException)
      await expect(service.handBack(deliveryId, courierId)).rejects.toThrow(windowOverMessage(60))
      expect(mockDeliveryEventService.handBack).not.toHaveBeenCalled()
    })

    it('Check 3: throws 409 with windowOverMessage when now > handBackUntil + OFFER_EXPIRY_GRACE_SECONDS', async () => {
      const fixedNow = 1_000_000
      jest.spyOn(Date, 'now').mockReturnValue(fixedNow)

      // Grace is 3 seconds (3000ms). Setting until 3001ms ago means past grace period
      const until = new Date(fixedNow - (OFFER_EXPIRY_GRACE_SECONDS * 1000 + 1))
      mockDeliveryRepository.findById.mockResolvedValue({
        id: deliveryId,
        courierId,
        status: EnumDeliveryStatus.ACCEPTED,
        handBackUntil: until,
      } as any)
      mockConfigDomainService.instanceConfig.getHandBackSeconds.mockResolvedValue(90)

      await expect(service.handBack(deliveryId, courierId)).rejects.toThrow(ConflictException)
      await expect(service.handBack(deliveryId, courierId)).rejects.toThrow(windowOverMessage(90))
      expect(mockDeliveryEventService.handBack).not.toHaveBeenCalled()

      jest.restoreAllMocks()
    })

    it('Check 3: request inside grace period (handBackUntil < now <= handBackUntil + grace) still passes', async () => {
      const fixedNow = 1_000_000
      jest.spyOn(Date, 'now').mockReturnValue(fixedNow)

      // Expired 1 second ago, but grace is 3 seconds, so within grace
      const until = new Date(fixedNow - 1000)
      mockDeliveryRepository.findById.mockResolvedValue({
        id: deliveryId,
        courierId,
        status: EnumDeliveryStatus.DISPATCHED,
        handBackUntil: until,
      } as any)
      mockDeliveryEventService.handBack.mockResolvedValue(true)

      const result = await service.handBack(deliveryId, courierId)

      expect(result).toEqual({ status: EnumDeliveryStatus.ASSIGNING_COURIER })
      expect(mockDeliveryEventService.handBack).toHaveBeenCalledWith(
        deliveryId,
        courierId,
        EnumDeliveryStatus.DISPATCHED
      )

      jest.restoreAllMocks()
    })

    it('Check 4: throws 409 with ORDER_CHANGED_MESSAGE when deliveryEventService.handBack returns false', async () => {
      const fixedNow = 1_000_000
      jest.spyOn(Date, 'now').mockReturnValue(fixedNow)

      const until = new Date(fixedNow + 30000)
      mockDeliveryRepository.findById.mockResolvedValue({
        id: deliveryId,
        courierId,
        status: EnumDeliveryStatus.ACCEPTED,
        handBackUntil: until,
      } as any)
      mockDeliveryEventService.handBack.mockResolvedValue(false) // missed conditional write race

      await expect(service.handBack(deliveryId, courierId)).rejects.toThrow(ConflictException)
      await expect(service.handBack(deliveryId, courierId)).rejects.toThrow(ORDER_CHANGED_MESSAGE)

      jest.restoreAllMocks()
    })

    it('Success: returns { status: ASSIGNING_COURIER } when hand back succeeds', async () => {
      const fixedNow = 1_000_000
      jest.spyOn(Date, 'now').mockReturnValue(fixedNow)

      const until = new Date(fixedNow + 50000)
      mockDeliveryRepository.findById.mockResolvedValue({
        id: deliveryId,
        courierId,
        status: EnumDeliveryStatus.ACCEPTED,
        handBackUntil: until,
      } as any)
      mockDeliveryEventService.handBack.mockResolvedValue(true)

      const result = await service.handBack(deliveryId, courierId)

      expect(result).toEqual({ status: EnumDeliveryStatus.ASSIGNING_COURIER })
      expect(mockDeliveryEventService.handBack).toHaveBeenCalledWith(
        deliveryId,
        courierId,
        EnumDeliveryStatus.ACCEPTED
      )

      jest.restoreAllMocks()
    })
  })
})
