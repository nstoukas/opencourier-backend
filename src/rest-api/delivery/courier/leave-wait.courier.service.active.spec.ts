import { ConflictException } from '@nestjs/common'
import { EnumDeliveryStatus } from '@prisma/types'
import { DeliveryNotFoundException } from 'src/errors'
import {
  LeaveWaitCourierService,
  NOT_WAITING_MESSAGE,
  ORDER_CHANGED_MESSAGE,
  tooSoonMessage,
} from './leave-wait.courier.service'

describe('LeaveWaitCourierService (Spec 0033 AC-6)', () => {
  let service: LeaveWaitCourierService
  let mockDeliveryRepository: any
  let mockConfigDomainService: any
  let mockDeliveryEventService: any

  const COURIER_ID = 'courier-1'
  const OTHER_COURIER_ID = 'courier-2'
  const DELIVERY_ID = 'del-wait-1'
  const PROMISED_TIME = new Date('2026-11-09T10:00:00.000Z')
  const ARRIVAL_TIME = new Date('2026-11-09T10:00:00.000Z')

  beforeEach(() => {
    mockDeliveryRepository = {
      findById: jest.fn(),
    }

    mockConfigDomainService = {
      instanceConfig: {
        getWaitLimitMinutes: jest.fn().mockResolvedValue(10),
      },
    }

    mockDeliveryEventService = {
      occurredAtForCourierTap: jest.fn(),
      leaveWait: jest.fn().mockResolvedValue(true),
    }

    service = new LeaveWaitCourierService(
      mockDeliveryRepository,
      mockConfigDomainService,
      mockDeliveryEventService
    )
  })

  function deliveryAt(status: EnumDeliveryStatus, overrides: Record<string, any> = {}) {
    return {
      id: DELIVERY_ID,
      status,
      courierId: COURIER_ID,
      arrivedAtPickupAt: ARRIVAL_TIME,
      promisedReadyAt: PROMISED_TIME,
      ...overrides,
    }
  }

  describe('404 Not Found (not theirs or non-existent)', () => {
    it('throws DeliveryNotFoundException when delivery does not exist', async () => {
      mockDeliveryRepository.findById.mockResolvedValue(null)

      await expect(service.leave(DELIVERY_ID, COURIER_ID)).rejects.toThrow(
        DeliveryNotFoundException
      )
      expect(mockDeliveryEventService.leaveWait).not.toHaveBeenCalled()
    })

    it('throws DeliveryNotFoundException when delivery belongs to another courier', async () => {
      mockDeliveryRepository.findById.mockResolvedValue(
        deliveryAt(EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION, {
          courierId: OTHER_COURIER_ID,
        })
      )

      await expect(service.leave(DELIVERY_ID, COURIER_ID)).rejects.toThrow(
        DeliveryNotFoundException
      )
      expect(mockDeliveryEventService.leaveWait).not.toHaveBeenCalled()
    })

    it('throws DeliveryNotFoundException when delivery has no courierId assigned', async () => {
      mockDeliveryRepository.findById.mockResolvedValue(
        deliveryAt(EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION, {
          courierId: null,
        })
      )

      await expect(service.leave(DELIVERY_ID, COURIER_ID)).rejects.toThrow(
        DeliveryNotFoundException
      )
      expect(mockDeliveryEventService.leaveWait).not.toHaveBeenCalled()
    })
  })

  describe('409 Wrong Status', () => {
    const wrongStatuses = [
      EnumDeliveryStatus.CREATED,
      EnumDeliveryStatus.ASSIGNING_COURIER,
      EnumDeliveryStatus.ACCEPTED,
      EnumDeliveryStatus.DISPATCHED,
      EnumDeliveryStatus.PICKED_UP,
      EnumDeliveryStatus.ON_THE_WAY,
      EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
      EnumDeliveryStatus.DROPPED_OFF,
      EnumDeliveryStatus.CANCELED,
      EnumDeliveryStatus.FAILED,
    ]

    test.each(wrongStatuses)(
      'throws ConflictException with NOT_WAITING_MESSAGE from status %s',
      async (status) => {
        mockDeliveryRepository.findById.mockResolvedValue(deliveryAt(status))

        await expect(service.leave(DELIVERY_ID, COURIER_ID)).rejects.toThrow(
          new ConflictException(NOT_WAITING_MESSAGE)
        )
        expect(mockDeliveryEventService.leaveWait).not.toHaveBeenCalled()
      }
    )
  })

  describe('409 Before the Limit', () => {
    it('throws ConflictException naming limit when attempting to leave before limitMinutes have elapsed', async () => {
      // Arrived at 10:00:00, limit is 10 min, now is 10:09:59 (1 second too soon)
      const now = new Date('2026-11-09T10:09:59.000Z')
      jest.useFakeTimers()
      jest.setSystemTime(now)

      try {
        mockDeliveryRepository.findById.mockResolvedValue(
          deliveryAt(EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION)
        )

        await expect(service.leave(DELIVERY_ID, COURIER_ID)).rejects.toThrow(
          new ConflictException(tooSoonMessage(10))
        )
        expect(mockDeliveryEventService.leaveWait).not.toHaveBeenCalled()
      } finally {
        jest.useRealTimers()
      }
    })

    it('throws ConflictException when delivery has no promisedReadyAt timestamp (409 with no promise)', async () => {
      mockDeliveryRepository.findById.mockResolvedValue(
        deliveryAt(EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION, {
          promisedReadyAt: null,
        })
      )

      await expect(service.leave(DELIVERY_ID, COURIER_ID)).rejects.toThrow(
        new ConflictException(tooSoonMessage(10))
      )
      expect(mockDeliveryEventService.leaveWait).not.toHaveBeenCalled()
    })

    it('throws ConflictException just before promised plus the limit however long the rider has been there (409 just before promised plus limit)', async () => {
      // Arrived early at 09:30:00 (waiting 39 min 59 sec!), promised at 10:00:00, limit 10 min.
      // Leave time is 10:10:00. At 10:09:59 rider cannot leave yet.
      const now = new Date('2026-11-09T10:09:59.000Z')
      jest.useFakeTimers()
      jest.setSystemTime(now)

      try {
        mockDeliveryRepository.findById.mockResolvedValue(
          deliveryAt(EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION, {
            arrivedAtPickupAt: new Date('2026-11-09T09:30:00.000Z'),
            promisedReadyAt: PROMISED_TIME,
          })
        )

        await expect(service.leave(DELIVERY_ID, COURIER_ID)).rejects.toThrow(
          new ConflictException(tooSoonMessage(10))
        )
        expect(mockDeliveryEventService.leaveWait).not.toHaveBeenCalled()
      } finally {
        jest.useRealTimers()
      }
    })

    it('uses singular "1 minute" in tooSoonMessage when limit is 1 minute', () => {
      expect(tooSoonMessage(1)).toBe('You can leave 1 minute after the time the food was promised.')
      expect(tooSoonMessage(10)).toBe('You can leave 10 minutes after the time the food was promised.')
    })
  })

  describe('200 Success at and after the Limit', () => {
    it('allows leaving exactly at the limit boundary (200 at promised plus limit)', async () => {
      // Promised at 10:00:00, limit is 10 min, now is exactly 10:10:00
      const now = new Date('2026-11-09T10:10:00.000Z')
      jest.useFakeTimers()
      jest.setSystemTime(now)

      try {
        const delivery = deliveryAt(EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION)
        mockDeliveryRepository.findById.mockResolvedValue(delivery)
        mockDeliveryEventService.leaveWait.mockResolvedValue(true)

        const result = await service.leave(DELIVERY_ID, COURIER_ID)

        expect(result).toEqual({ status: EnumDeliveryStatus.ASSIGNING_COURIER })
        expect(mockDeliveryEventService.leaveWait).toHaveBeenCalledWith(
          delivery,
          COURIER_ID,
          now
        )
      } finally {
        jest.useRealTimers()
      }
    })

    it('leave time is unmoved by a later readyAt bumped by the restaurant', async () => {
      // Promised at 10:00:00, restaurant delayed readyAt to 10:30:00 (+30 min delay).
      // Limit is 10 min. At 10:10:00 rider can leave because leave time counts from promisedReadyAt.
      const now = new Date('2026-11-09T10:10:00.000Z')
      jest.useFakeTimers()
      jest.setSystemTime(now)

      try {
        const delivery = deliveryAt(EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION, {
          readyAt: new Date('2026-11-09T10:30:00.000Z'),
          promisedReadyAt: PROMISED_TIME,
        })
        mockDeliveryRepository.findById.mockResolvedValue(delivery)
        mockDeliveryEventService.leaveWait.mockResolvedValue(true)

        const result = await service.leave(DELIVERY_ID, COURIER_ID)

        expect(result).toEqual({ status: EnumDeliveryStatus.ASSIGNING_COURIER })
        expect(mockDeliveryEventService.leaveWait).toHaveBeenCalledWith(
          delivery,
          COURIER_ID,
          now
        )
      } finally {
        jest.useRealTimers()
      }
    })

    it('allows leaving well past the limit (e.g. 15 minutes after arrival)', async () => {
      const now = new Date('2026-11-09T10:15:00.000Z')
      jest.useFakeTimers()
      jest.setSystemTime(now)

      try {
        const delivery = deliveryAt(EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION)
        mockDeliveryRepository.findById.mockResolvedValue(delivery)
        mockDeliveryEventService.leaveWait.mockResolvedValue(true)

        const result = await service.leave(DELIVERY_ID, COURIER_ID)

        expect(result).toEqual({ status: EnumDeliveryStatus.ASSIGNING_COURIER })
        expect(mockDeliveryEventService.leaveWait).toHaveBeenCalledWith(
          delivery,
          COURIER_ID,
          now
        )
      } finally {
        jest.useRealTimers()
      }
    })
  })

  describe('tapAgeMs moves the leave time (Spec 0009 & AC-6)', () => {
    it('allows leave when tap occurred at limit, even if request arrived late at server due to poor network', async () => {
      // Arrived at pickup: 10:00:00.
      // Phone tapped leave at 10:10:00 (10 min = limit satisfied).
      // Request reached server at 10:12:00 with tapAgeMs: 120_000 (2 minutes late).
      const serverNow = new Date('2026-11-09T10:12:00.000Z')
      const tapOccurredAt = new Date('2026-11-09T10:10:00.000Z')
      jest.useFakeTimers()
      jest.setSystemTime(serverNow)

      try {
        const delivery = deliveryAt(EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION)
        mockDeliveryRepository.findById.mockResolvedValue(delivery)
        mockDeliveryEventService.occurredAtForCourierTap.mockResolvedValue(tapOccurredAt)
        mockDeliveryEventService.leaveWait.mockResolvedValue(true)

        const result = await service.leave(DELIVERY_ID, COURIER_ID, 120_000)

        expect(result).toEqual({ status: EnumDeliveryStatus.ASSIGNING_COURIER })
        expect(mockDeliveryEventService.occurredAtForCourierTap).toHaveBeenCalledWith(
          delivery,
          {
            receivedAt: serverNow,
            tapAgeMs: 120_000,
          }
        )
        expect(mockDeliveryEventService.leaveWait).toHaveBeenCalledWith(
          delivery,
          COURIER_ID,
          tapOccurredAt
        )
      } finally {
        jest.useRealTimers()
      }
    })

    it('refuses leave if tap occurred too soon, even if request reached server after limit', async () => {
      // Arrived at pickup: 10:00:00.
      // Phone tapped leave at 10:08:00 (only 8 min elapsed - too soon!).
      // Request delayed by network and reached server at 10:12:00.
      const serverNow = new Date('2026-11-09T10:12:00.000Z')
      const tapOccurredAt = new Date('2026-11-09T10:08:00.000Z')
      jest.useFakeTimers()
      jest.setSystemTime(serverNow)

      try {
        const delivery = deliveryAt(EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION)
        mockDeliveryRepository.findById.mockResolvedValue(delivery)
        mockDeliveryEventService.occurredAtForCourierTap.mockResolvedValue(tapOccurredAt)

        await expect(service.leave(DELIVERY_ID, COURIER_ID, 240_000)).rejects.toThrow(
          new ConflictException(tooSoonMessage(10))
        )
        expect(mockDeliveryEventService.leaveWait).not.toHaveBeenCalled()
      } finally {
        jest.useRealTimers()
      }
    })
  })

  describe('Lost Race / Concurrent Change', () => {
    it('throws ConflictException with ORDER_CHANGED_MESSAGE when leaveWait returns false', async () => {
      const now = new Date('2026-11-09T10:15:00.000Z')
      jest.useFakeTimers()
      jest.setSystemTime(now)

      try {
        const delivery = deliveryAt(EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION)
        mockDeliveryRepository.findById.mockResolvedValue(delivery)
        // Race lost: e.g. food was marked picked up or order was cancelled
        mockDeliveryEventService.leaveWait.mockResolvedValue(false)

        await expect(service.leave(DELIVERY_ID, COURIER_ID)).rejects.toThrow(
          new ConflictException(ORDER_CHANGED_MESSAGE)
        )
      } finally {
        jest.useRealTimers()
      }
    })
  })
})
