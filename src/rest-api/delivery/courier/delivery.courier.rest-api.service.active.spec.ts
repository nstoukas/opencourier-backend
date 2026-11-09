import { EnumDeliveryIssueReason, EnumDeliveryStatus } from '@prisma/types'
import { ConflictException } from '@nestjs/common'
import { DeliveryRestApiCourierService } from './delivery.courier.rest-api.service'
import { DeliveryDomainService } from 'src/domains/delivery/delivery.domain.service'
import { DeliveryIssueDomainService } from 'src/domains/delivery-issue/delivery-issue.domain.service'
import { LocationNoteDomainService } from 'src/domains/location-note/location-note.domain.service'
import { LocationNoteReactionDomainService } from 'src/domains/location-note-reaction/location-note-reaction.domain.service'
import { DeliveryNotFoundException } from 'src/errors'
import { DeliveryIssueWithCourier } from 'src/persistence/repositories/delivery-issue.repository'

describe('DeliveryRestApiCourierService', () => {
  let service: DeliveryRestApiCourierService
  let mockDeliveryDomainService: jest.Mocked<DeliveryDomainService>
  let mockLocationNoteDomainService: jest.Mocked<LocationNoteDomainService>
  let mockDeliveryIssueDomainService: jest.Mocked<DeliveryIssueDomainService>

  const deliveryId = 'del-assigned-101'
  const courierId = 'courier-assigned-202'

  const mockStoredIssue: DeliveryIssueWithCourier = {
    id: 'issue-xyz-1',
    deliveryId,
    courierId,
    reason: EnumDeliveryIssueReason.WRONG_ADDRESS,
    note: 'Wrong buzzer on street',
    createdAt: new Date('2026-10-27T08:00:00.000Z'),
    courier: {
      firstName: 'Nikos',
      lastName: 'Papastamou',
    },
  }

  beforeEach(() => {
    mockDeliveryDomainService = {
      getById: jest.fn(),
      update: jest.fn(),
      submitDeliveryEvent: jest.fn(),
      markAsDispatched: jest.fn(),
      courierArrivedAtPickup: jest.fn(),
      markAsPickedUp: jest.fn(),
      courierArrivedAtDropOff: jest.fn(),
      markAsDelivered: jest.fn(),
      cancelDelivery: jest.fn(),
    } as unknown as jest.Mocked<DeliveryDomainService>

    mockLocationNoteDomainService = {
      create: jest.fn().mockResolvedValue({ id: 'note-1' } as any),
    } as unknown as jest.Mocked<LocationNoteDomainService>

    mockDeliveryIssueDomainService = {
      report: jest.fn().mockResolvedValue(mockStoredIssue),
      listForDelivery: jest.fn(),
    } as unknown as jest.Mocked<DeliveryIssueDomainService>

    service = new DeliveryRestApiCourierService(
      mockDeliveryDomainService,
      mockLocationNoteDomainService,
      {} as LocationNoteReactionDomainService,
      mockDeliveryIssueDomainService,
      {} as any
    )
  })

  describe('reportIssue (clauses 1 & 6)', () => {
    test('stores a DeliveryIssue for a delivery assigned to the calling rider', async () => {
      // Delivery domain service finds delivery matching deliveryId AND courierId filter
      mockDeliveryDomainService.getById.mockResolvedValue({
        id: deliveryId,
        courierId: courierId,
      } as any)

      const input = {
        reason: EnumDeliveryIssueReason.WRONG_ADDRESS,
        note: 'Wrong buzzer on street',
      }

      const result = await service.reportIssue(deliveryId, courierId, input)

      expect(mockDeliveryDomainService.getById).toHaveBeenCalledWith(deliveryId, { courierId })
      expect(mockDeliveryIssueDomainService.report).toHaveBeenCalledWith({
        deliveryId,
        courierId,
        reason: EnumDeliveryIssueReason.WRONG_ADDRESS,
        note: 'Wrong buzzer on street',
      })
      expect(result).toBe(mockStoredIssue)
    })

    test('answers 404 DeliveryNotFoundException and stores nothing when delivery is not assigned to rider or unknown', async () => {
      // getById returns null when delivery does not belong to courierId or does not exist
      mockDeliveryDomainService.getById.mockResolvedValue(null)

      const input = {
        reason: EnumDeliveryIssueReason.OTHER,
        note: 'Cannot find restaurant',
      }

      await expect(service.reportIssue('del-other-courier', courierId, input)).rejects.toThrow(
        DeliveryNotFoundException
      )
      await expect(service.reportIssue('del-other-courier', courierId, input)).rejects.toThrow(
        'Delivery not found'
      )

      // Critical: nothing stored when delivery is not found/not assigned to this courier
      expect(mockDeliveryIssueDomainService.report).not.toHaveBeenCalled()
    })

    test('clause 6: emits no DeliveryEvent, updates no status, and writes neither undeliverableAction nor undeliverableReason', async () => {
      mockDeliveryDomainService.getById.mockResolvedValue({
        id: deliveryId,
        courierId: courierId,
        undeliverableAction: null,
        undeliverableReason: null,
      } as any)

      const input = {
        reason: EnumDeliveryIssueReason.ORDER_HANDED,
        note: 'Handed directly to recipient at gate',
      }

      await service.reportIssue(deliveryId, courierId, input)

      // Must NOT call update or submitDeliveryEvent on deliveryDomainService
      expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
      expect(mockDeliveryDomainService.submitDeliveryEvent).not.toHaveBeenCalled()
    })
  })

  describe('Five courier step methods pass tap { receivedAt, tapAgeMs } (Spec 0009, AC-4, AC-9)', () => {
    const assignedDelivery = {
      id: deliveryId,
      courierId,
      status: EnumDeliveryStatus.ACCEPTED,
    }

    beforeEach(() => {
      mockDeliveryDomainService.getById.mockResolvedValue(assignedDelivery as any)
      mockDeliveryDomainService.markAsDispatched.mockResolvedValue({ ...assignedDelivery, status: EnumDeliveryStatus.DISPATCHED } as any)
      mockDeliveryDomainService.courierArrivedAtPickup.mockResolvedValue({ ...assignedDelivery, status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION } as any)
      mockDeliveryDomainService.markAsPickedUp.mockResolvedValue({ ...assignedDelivery, status: EnumDeliveryStatus.PICKED_UP } as any)
      mockDeliveryDomainService.courierArrivedAtDropOff.mockResolvedValue({ ...assignedDelivery, status: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION } as any)
      mockDeliveryDomainService.markAsDelivered.mockResolvedValue({ ...assignedDelivery, status: EnumDeliveryStatus.DROPPED_OFF } as any)
    })

    test('markAsDispatched passes tap when tapAgeMs sent, undefined when absent', async () => {
      const before = Date.now()
      await service.markAsDispatched(deliveryId, courierId, { tapAgeMs: 4500 })

      expect(mockDeliveryDomainService.markAsDispatched).toHaveBeenCalledWith(
        deliveryId,
        expect.objectContaining({
          tapAgeMs: 4500,
          receivedAt: expect.any(Date),
        })
      )
      const passedTap = mockDeliveryDomainService.markAsDispatched.mock.calls[0]?.[1]
      expect(passedTap?.receivedAt.getTime()).toBeGreaterThanOrEqual(before)

      // Absent tapAgeMs passes undefined
      await service.markAsDispatched(deliveryId, courierId, {})
      expect(mockDeliveryDomainService.markAsDispatched).toHaveBeenLastCalledWith(deliveryId, undefined)
    })

    test('courierArrivedAtPickup passes tap when tapAgeMs sent, undefined when absent', async () => {
      await service.courierArrivedAtPickup(deliveryId, courierId, { tapAgeMs: 1200 })

      expect(mockDeliveryDomainService.courierArrivedAtPickup).toHaveBeenCalledWith(
        deliveryId,
        expect.objectContaining({
          tapAgeMs: 1200,
          receivedAt: expect.any(Date),
        }),
        undefined
      )

      await service.courierArrivedAtPickup(deliveryId, courierId, {})
      expect(mockDeliveryDomainService.courierArrivedAtPickup).toHaveBeenLastCalledWith(deliveryId, undefined, undefined)
    })

    test('courierArrivedAtPickup passes detected boolean and tapAgeMs to domain service (Spec 0021 AC-4)', async () => {
      await service.courierArrivedAtPickup(deliveryId, courierId, { tapAgeMs: 1500, detected: true })
      expect(mockDeliveryDomainService.courierArrivedAtPickup).toHaveBeenLastCalledWith(
        deliveryId,
        expect.objectContaining({ tapAgeMs: 1500 }),
        true
      )

      await service.courierArrivedAtPickup(deliveryId, courierId, { detected: false })
      expect(mockDeliveryDomainService.courierArrivedAtPickup).toHaveBeenLastCalledWith(
        deliveryId,
        undefined,
        false
      )
    })

    test('markAsPickedUp passes tap when tapAgeMs sent, undefined when absent', async () => {
      await service.markAsPickedUp(deliveryId, courierId, { tapAgeMs: 8000 })

      expect(mockDeliveryDomainService.markAsPickedUp).toHaveBeenCalledWith(
        deliveryId,
        expect.objectContaining({
          tapAgeMs: 8000,
          receivedAt: expect.any(Date),
        })
      )

      await service.markAsPickedUp(deliveryId, courierId, {})
      expect(mockDeliveryDomainService.markAsPickedUp).toHaveBeenLastCalledWith(deliveryId, undefined)
    })

    test('courierArrivedAtDropOff passes tap when tapAgeMs sent, undefined when absent', async () => {
      await service.courierArrivedAtDropOff(deliveryId, courierId, { tapAgeMs: 3400 })

      expect(mockDeliveryDomainService.courierArrivedAtDropOff).toHaveBeenCalledWith(
        deliveryId,
        expect.objectContaining({
          tapAgeMs: 3400,
          receivedAt: expect.any(Date),
        }),
        undefined
      )

      await service.courierArrivedAtDropOff(deliveryId, courierId, {})
      expect(mockDeliveryDomainService.courierArrivedAtDropOff).toHaveBeenLastCalledWith(deliveryId, undefined, undefined)
    })

    test('courierArrivedAtDropOff passes detected boolean and tapAgeMs to domain service (Spec 0021 AC-4)', async () => {
      await service.courierArrivedAtDropOff(deliveryId, courierId, { tapAgeMs: 2500, detected: true })
      expect(mockDeliveryDomainService.courierArrivedAtDropOff).toHaveBeenLastCalledWith(
        deliveryId,
        expect.objectContaining({ tapAgeMs: 2500 }),
        true
      )

      await service.courierArrivedAtDropOff(deliveryId, courierId, { detected: false })
      expect(mockDeliveryDomainService.courierArrivedAtDropOff).toHaveBeenLastCalledWith(
        deliveryId,
        undefined,
        false
      )
    })

    test('markAsDelivered passes tap when tapAgeMs sent, undefined when absent', async () => {
      const deliveredInput = { tapAgeMs: 9000, note: 'Left at reception' }
      await service.markAsDelivered(deliveryId, courierId, deliveredInput)

      expect(mockDeliveryDomainService.markAsDelivered).toHaveBeenCalledWith(
        deliveryId,
        expect.anything(),
        expect.objectContaining({
          tapAgeMs: 9000,
          receivedAt: expect.any(Date),
        })
      )

      await service.markAsDelivered(deliveryId, courierId, {})
      expect(mockDeliveryDomainService.markAsDelivered).toHaveBeenLastCalledWith(
        deliveryId,
        expect.anything(),
        undefined
      )
    })
  })

  describe('Pickup note and drop off note storage (Spec 0009, AC-12)', () => {
    test('stores pickup note only when delivery status was NOT PICKED_UP before and IS PICKED_UP after', async () => {
      // Normal transition: was DISPATCHED before, becomes PICKED_UP after
      mockDeliveryDomainService.getById.mockResolvedValueOnce({
        id: deliveryId,
        courierId,
        status: EnumDeliveryStatus.DISPATCHED,
      } as any)
      mockDeliveryDomainService.markAsPickedUp.mockResolvedValueOnce({
        id: deliveryId,
        courierId,
        status: EnumDeliveryStatus.PICKED_UP,
      } as any)

      await service.markAsPickedUp(deliveryId, courierId, { note: 'Buzzer 3A' })

      expect(mockLocationNoteDomainService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          note: 'Buzzer 3A',
          deliveryId,
          courierId,
        })
      )
    })

    test('does NOT store pickup note on a repeat (delivery was already PICKED_UP before)', async () => {
      // Repeat call after lost response: already PICKED_UP
      mockDeliveryDomainService.getById.mockResolvedValueOnce({
        id: deliveryId,
        courierId,
        status: EnumDeliveryStatus.PICKED_UP,
      } as any)
      mockDeliveryDomainService.markAsPickedUp.mockResolvedValueOnce({
        id: deliveryId,
        courierId,
        status: EnumDeliveryStatus.PICKED_UP,
      } as any)

      await service.markAsPickedUp(deliveryId, courierId, { note: 'Buzzer 3A repeat' })

      expect(mockLocationNoteDomainService.create).not.toHaveBeenCalled()
    })

    test('does NOT store pickup note if step failed to move delivery to PICKED_UP', async () => {
      mockDeliveryDomainService.getById.mockResolvedValueOnce({
        id: deliveryId,
        courierId,
        status: EnumDeliveryStatus.CREATED,
      } as any)
      mockDeliveryDomainService.markAsPickedUp.mockResolvedValueOnce({
        id: deliveryId,
        courierId,
        status: EnumDeliveryStatus.CREATED, // Didn't transition
      } as any)

      await service.markAsPickedUp(deliveryId, courierId, { note: 'Buzzer 3A' })

      expect(mockLocationNoteDomainService.create).not.toHaveBeenCalled()
    })

    test('stores drop off note only when delivery status was NOT DROPPED_OFF before and IS DROPPED_OFF after', async () => {
      // Normal transition: was ARRIVED_AT_DROPOFF before, becomes DROPPED_OFF after
      mockDeliveryDomainService.getById.mockResolvedValueOnce({
        id: deliveryId,
        courierId,
        status: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
      } as any)
      mockDeliveryDomainService.markAsDelivered.mockResolvedValueOnce({
        id: deliveryId,
        courierId,
        status: EnumDeliveryStatus.DROPPED_OFF,
      } as any)

      await service.markAsDelivered(deliveryId, courierId, { note: 'Left with concierge' })

      expect(mockLocationNoteDomainService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          note: 'Left with concierge',
          deliveryId,
          courierId,
        })
      )
    })

    test('does NOT store drop off note on a repeat (delivery was already DROPPED_OFF before)', async () => {
      // Repeat call: already DROPPED_OFF
      mockDeliveryDomainService.getById.mockResolvedValueOnce({
        id: deliveryId,
        courierId,
        status: EnumDeliveryStatus.DROPPED_OFF,
      } as any)
      mockDeliveryDomainService.markAsDelivered.mockResolvedValueOnce({
        id: deliveryId,
        courierId,
        status: EnumDeliveryStatus.DROPPED_OFF,
      } as any)

      await service.markAsDelivered(deliveryId, courierId, { note: 'Left with concierge repeat' })

      expect(mockLocationNoteDomainService.create).not.toHaveBeenCalled()
    })

    test('does NOT store drop off note if step failed to move delivery to DROPPED_OFF', async () => {
      mockDeliveryDomainService.getById.mockResolvedValueOnce({
        id: deliveryId,
        courierId,
        status: EnumDeliveryStatus.PICKED_UP,
      } as any)
      mockDeliveryDomainService.markAsDelivered.mockResolvedValueOnce({
        id: deliveryId,
        courierId,
        status: EnumDeliveryStatus.PICKED_UP, // Didn't transition
      } as any)

      await service.markAsDelivered(deliveryId, courierId, { note: 'Left with concierge' })

      expect(mockLocationNoteDomainService.create).not.toHaveBeenCalled()
    })
  })

  describe('cancelDelivery (Spec 0015 decision 32.14)', () => {
    it('answers 409 ConflictException and never calls domain cancelDelivery', async () => {
      mockDeliveryDomainService.getById.mockResolvedValueOnce({
        id: deliveryId,
        courierId,
        status: EnumDeliveryStatus.PICKED_UP,
      } as any)

      await expect(service.cancelDelivery(deliveryId, courierId)).rejects.toThrow(
        new ConflictException('A rider cannot cancel a job. Report an issue or call dispatch.')
      )

      expect(mockDeliveryDomainService.cancelDelivery).not.toHaveBeenCalled()
    })

    it('answers 404 DeliveryNotFoundException when delivery does not belong to courier or is not found', async () => {
      mockDeliveryDomainService.getById.mockResolvedValueOnce(null)

      await expect(service.cancelDelivery('del-other', courierId)).rejects.toThrow(DeliveryNotFoundException)
      expect(mockDeliveryDomainService.cancelDelivery).not.toHaveBeenCalled()
    })
  })
})
