import { EnumDeliveryIssueReason, EnumDeliveryStatus, EnumRemovalRequestStatus } from '@prisma/types'
import { ConflictException } from '@nestjs/common'
import { DeliveryRestApiCourierService } from './delivery.courier.rest-api.service'
import { DeliveryDomainService } from 'src/domains/delivery/delivery.domain.service'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { DeliveryIssueDomainService } from 'src/domains/delivery-issue/delivery-issue.domain.service'
import { LocationNoteDomainService } from 'src/domains/location-note/location-note.domain.service'
import { DeliveryNotFoundException, OfferHasEndedException } from 'src/errors'
import { DeliveryIssueWithCourier } from 'src/persistence/repositories/delivery-issue.repository'

describe('DeliveryRestApiCourierService', () => {
  let service: DeliveryRestApiCourierService
  let mockDeliveryDomainService: jest.Mocked<DeliveryDomainService>
  let mockDeliveryEventService: jest.Mocked<DeliveryEventService>
  let mockLocationNoteDomainService: jest.Mocked<LocationNoteDomainService>
  let mockDeliveryIssueDomainService: jest.Mocked<DeliveryIssueDomainService>
  let mockRemovalRequestRepo: any
  let mockDeliveryRepository: any

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
      acceptDelivery: jest.fn(),
      rejectDelivery: jest.fn(),
    } as unknown as jest.Mocked<DeliveryDomainService>

    mockDeliveryEventService = {
      offerAnswerTargets: jest.fn(),
      tellPhonesOfferAnswered: jest.fn(),
    } as unknown as jest.Mocked<DeliveryEventService>

    mockLocationNoteDomainService = {
      notesForJobs: jest.fn().mockResolvedValue(new Map()),
      createForStop: jest.fn().mockResolvedValue({ id: 'note-1' } as any),
    } as unknown as jest.Mocked<LocationNoteDomainService>

    mockDeliveryRepository = {
      findByIdOrThrowWithLocations: jest.fn().mockResolvedValue({
        id: deliveryId,
        pickupLocationId: 'loc-pickup-1',
        dropoffLocationId: 'loc-dropoff-1',
        pickupLocation: { latitude: 39.36, longitude: 22.94 },
        dropoffLocation: { latitude: 39.37, longitude: 22.95 },
        dropoffCorrectedLatitude: null,
        dropoffCorrectedLongitude: null,
      }),
    }

    mockDeliveryIssueDomainService = {
      report: jest.fn().mockResolvedValue(mockStoredIssue),
      listForDelivery: jest.fn(),
    } as unknown as jest.Mocked<DeliveryIssueDomainService>

    mockRemovalRequestRepo = {
      findNewestByCourierForDeliveries: jest.fn().mockResolvedValue([]),
    }

    service = new DeliveryRestApiCourierService(
      mockDeliveryDomainService,
      mockLocationNoteDomainService,
      mockDeliveryIssueDomainService,
      {} as any,
      mockRemovalRequestRepo,
      undefined,
      mockDeliveryRepository,
      mockDeliveryEventService
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
      await expect(service.reportIssue('del-other-courier', courierId, input)).rejects.toThrow('Delivery not found')

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
      mockDeliveryDomainService.markAsDispatched.mockResolvedValue({
        ...assignedDelivery,
        status: EnumDeliveryStatus.DISPATCHED,
      } as any)
      mockDeliveryDomainService.courierArrivedAtPickup.mockResolvedValue({
        ...assignedDelivery,
        status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
      } as any)
      mockDeliveryDomainService.markAsPickedUp.mockResolvedValue({
        ...assignedDelivery,
        status: EnumDeliveryStatus.PICKED_UP,
      } as any)
      mockDeliveryDomainService.courierArrivedAtDropOff.mockResolvedValue({
        ...assignedDelivery,
        status: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
      } as any)
      mockDeliveryDomainService.markAsDelivered.mockResolvedValue({
        ...assignedDelivery,
        status: EnumDeliveryStatus.DROPPED_OFF,
      } as any)
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
      expect(mockDeliveryDomainService.courierArrivedAtPickup).toHaveBeenLastCalledWith(
        deliveryId,
        undefined,
        undefined
      )
    })

    test('courierArrivedAtPickup passes detected boolean and tapAgeMs to domain service (Spec 0021 AC-4)', async () => {
      await service.courierArrivedAtPickup(deliveryId, courierId, { tapAgeMs: 1500, detected: true })
      expect(mockDeliveryDomainService.courierArrivedAtPickup).toHaveBeenLastCalledWith(
        deliveryId,
        expect.objectContaining({ tapAgeMs: 1500 }),
        true
      )

      await service.courierArrivedAtPickup(deliveryId, courierId, { detected: false })
      expect(mockDeliveryDomainService.courierArrivedAtPickup).toHaveBeenLastCalledWith(deliveryId, undefined, false)
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
      expect(mockDeliveryDomainService.courierArrivedAtDropOff).toHaveBeenLastCalledWith(
        deliveryId,
        undefined,
        undefined
      )
    })

    test('courierArrivedAtDropOff passes detected boolean and tapAgeMs to domain service (Spec 0021 AC-4)', async () => {
      await service.courierArrivedAtDropOff(deliveryId, courierId, { tapAgeMs: 2500, detected: true })
      expect(mockDeliveryDomainService.courierArrivedAtDropOff).toHaveBeenLastCalledWith(
        deliveryId,
        expect.objectContaining({ tapAgeMs: 2500 }),
        true
      )

      await service.courierArrivedAtDropOff(deliveryId, courierId, { detected: false })
      expect(mockDeliveryDomainService.courierArrivedAtDropOff).toHaveBeenLastCalledWith(deliveryId, undefined, false)
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

  describe('Pickup note and drop off note storage (Spec 0009, AC-12, spec 0053)', () => {
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

      expect(mockLocationNoteDomainService.createForStop).toHaveBeenCalledWith(
        expect.objectContaining({
          note: 'Buzzer 3A',
          stop: 'PICKUP',
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

      expect(mockLocationNoteDomainService.createForStop).not.toHaveBeenCalled()
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

      expect(mockLocationNoteDomainService.createForStop).not.toHaveBeenCalled()
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

      expect(mockLocationNoteDomainService.createForStop).toHaveBeenCalledWith(
        expect.objectContaining({
          note: 'Left with concierge',
          stop: 'DROPOFF',
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

      expect(mockLocationNoteDomainService.createForStop).not.toHaveBeenCalled()
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

      expect(mockLocationNoteDomainService.createForStop).not.toHaveBeenCalled()
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

  describe('getMyInProgressDeliveriesWithNotes - removalRequest (Spec 0035 AC-11)', () => {
    const makeDelivery = (id: string, status = EnumDeliveryStatus.DISPATCHED) => ({
      id,
      courierId,
      status,
      dropoffLocationId: 'loc-drop-1',
      pickupLocationId: 'loc-pick-1',
      pickupLocation: { street: 'Pickup St' },
      dropoffLocation: { street: 'Dropoff St' },
      pickupLocationNotes: [],
      dropoffLocationNotes: [],
    })

    test('calls findNewestByCourierForDeliveries and includes removalRequest only when OPEN or DECLINED', async () => {
      mockDeliveryDomainService.getMany = jest.fn().mockResolvedValue({
        data: [
          makeDelivery('del-open'),
          makeDelivery('del-declined'),
          makeDelivery('del-withdrawn'),
          makeDelivery('del-approved'),
          makeDelivery('del-closed'),
        ],
        pagination: {},
      })

      mockRemovalRequestRepo.findNewestByCourierForDeliveries = jest.fn().mockResolvedValue([
        {
          id: 'req-open',
          deliveryId: 'del-open',
          courierId,
          status: EnumRemovalRequestStatus.OPEN,
          label: 'Moped breakdown',
          paidToRider: true,
          decisionNote: null,
          createdAt: new Date('2026-11-09T10:00:00Z'),
        },
        {
          id: 'req-declined',
          deliveryId: 'del-declined',
          courierId,
          status: EnumRemovalRequestStatus.DECLINED,
          label: 'Customer unreachable',
          paidToRider: false,
          decisionNote: 'Wait another 5 mins',
          createdAt: new Date('2026-11-09T10:05:00Z'),
        },
        {
          id: 'req-withdrawn',
          deliveryId: 'del-withdrawn',
          courierId,
          status: EnumRemovalRequestStatus.WITHDRAWN,
          label: 'Food not ready',
          paidToRider: true,
          decisionNote: null,
          createdAt: new Date('2026-11-09T10:10:00Z'),
        },
        {
          id: 'req-approved',
          deliveryId: 'del-approved',
          courierId,
          status: EnumRemovalRequestStatus.APPROVED,
          label: 'Personal emergency',
          paidToRider: true,
          decisionNote: null,
          createdAt: new Date('2026-11-09T10:15:00Z'),
        },
        {
          id: 'req-closed',
          deliveryId: 'del-closed',
          courierId,
          status: EnumRemovalRequestStatus.CLOSED,
          label: 'Other',
          paidToRider: true,
          decisionNote: null,
          createdAt: new Date('2026-11-09T10:20:00Z'),
        },
      ])

      const result = await service.getMyInProgressDeliveriesWithNotes(courierId)

      expect(mockRemovalRequestRepo.findNewestByCourierForDeliveries).toHaveBeenCalledWith(courierId, [
        'del-open',
        'del-declined',
        'del-withdrawn',
        'del-approved',
        'del-closed',
      ])

      const delOpen = result.data.find((d) => d.id === 'del-open')
      expect(delOpen?.removalRequest).toEqual(
        expect.objectContaining({
          id: 'req-open',
          status: EnumRemovalRequestStatus.OPEN,
          label: 'Moped breakdown',
          paidToRider: true,
        })
      )

      const delDeclined = result.data.find((d) => d.id === 'del-declined')
      expect(delDeclined?.removalRequest).toEqual(
        expect.objectContaining({
          id: 'req-declined',
          status: EnumRemovalRequestStatus.DECLINED,
          label: 'Customer unreachable',
          paidToRider: false,
          decisionNote: 'Wait another 5 mins',
        })
      )

      // WITHDRAWN, APPROVED, CLOSED are NOT shown (null)
      const delWithdrawn = result.data.find((d) => d.id === 'del-withdrawn')
      expect(delWithdrawn?.removalRequest).toBeNull()

      const delApproved = result.data.find((d) => d.id === 'del-approved')
      expect(delApproved?.removalRequest).toBeNull()

      const delClosed = result.data.find((d) => d.id === 'del-closed')
      expect(delClosed?.removalRequest).toBeNull()
    })

    test('newest wins: when multiple requests exist for delivery, newest entry in array determines visibility', async () => {
      mockDeliveryDomainService.getMany = jest.fn().mockResolvedValue({
        data: [makeDelivery('del-multi-1'), makeDelivery('del-multi-2')],
        pagination: {},
      })

      // Delivery 1 has newest = OPEN, older = DECLINED
      // Delivery 2 has newest = WITHDRAWN, older = OPEN
      mockRemovalRequestRepo.findNewestByCourierForDeliveries = jest.fn().mockResolvedValue([
        {
          id: 'req-new-open',
          deliveryId: 'del-multi-1',
          status: EnumRemovalRequestStatus.OPEN,
          label: 'Food not ready',
          paidToRider: true,
          createdAt: new Date('2026-11-09T11:00:00Z'),
        },
        {
          id: 'req-old-declined',
          deliveryId: 'del-multi-1',
          status: EnumRemovalRequestStatus.DECLINED,
          label: 'Food not ready',
          paidToRider: true,
          createdAt: new Date('2026-11-09T10:00:00Z'),
        },
        {
          id: 'req-new-withdrawn',
          deliveryId: 'del-multi-2',
          status: EnumRemovalRequestStatus.WITHDRAWN,
          label: 'Unsafe drop off',
          paidToRider: true,
          createdAt: new Date('2026-11-09T11:00:00Z'),
        },
        {
          id: 'req-old-open',
          deliveryId: 'del-multi-2',
          status: EnumRemovalRequestStatus.OPEN,
          label: 'Unsafe drop off',
          paidToRider: true,
          createdAt: new Date('2026-11-09T10:00:00Z'),
        },
      ])

      const result = await service.getMyInProgressDeliveriesWithNotes(courierId)

      const del1 = result.data.find((d) => d.id === 'del-multi-1')
      expect(del1?.removalRequest?.id).toBe('req-new-open')

      // For delivery 2, newest is WITHDRAWN so removalRequest is null (even though older was OPEN)
      const del2 = result.data.find((d) => d.id === 'del-multi-2')
      expect(del2?.removalRequest).toBeNull()
    })
  })

  describe('acceptDelivery and rejectDelivery - silences other phones (Scope row 154)', () => {
    const fakeTargets = {
      courierId,
      deliveryIds: [deliveryId],
      offeredAt: new Date('2026-11-24T12:00:00.000Z'),
    }

    test('acceptDelivery reads offerAnswerTargets before answer and tells other phones after accept succeeds', async () => {
      const callSequence: string[] = []
      mockDeliveryEventService.offerAnswerTargets.mockImplementation(async () => {
        callSequence.push('offerAnswerTargets')
        return fakeTargets
      })
      const acceptedDelivery = { id: deliveryId, courierId, status: EnumDeliveryStatus.ACCEPTED } as any
      mockDeliveryDomainService.acceptDelivery.mockImplementation(async () => {
        callSequence.push('domain:acceptDelivery')
        return acceptedDelivery
      })

      const result = await service.acceptDelivery(deliveryId, courierId, false)

      // Targets read before domain accept
      expect(callSequence).toEqual(['offerAnswerTargets', 'domain:acceptDelivery'])
      expect(mockDeliveryEventService.offerAnswerTargets).toHaveBeenCalledWith(deliveryId, courierId)
      expect(mockDeliveryDomainService.acceptDelivery).toHaveBeenCalledWith(deliveryId, courierId, false)
      expect(mockDeliveryEventService.tellPhonesOfferAnswered).toHaveBeenCalledWith(fakeTargets)
      expect(result).toBe(acceptedDelivery)
    })

    test('acceptDelivery refused answer (OfferHasEndedException) sends nothing to phones', async () => {
      mockDeliveryEventService.offerAnswerTargets.mockResolvedValue(fakeTargets)
      mockDeliveryDomainService.acceptDelivery.mockRejectedValue(new OfferHasEndedException())

      await expect(service.acceptDelivery(deliveryId, courierId)).rejects.toThrow(OfferHasEndedException)

      expect(mockDeliveryEventService.tellPhonesOfferAnswered).not.toHaveBeenCalled()
    })

    test('acceptDelivery does not tell phones when offerAnswerTargets returns null', async () => {
      mockDeliveryEventService.offerAnswerTargets.mockResolvedValue(null)
      const acceptedDelivery = { id: deliveryId, courierId, status: EnumDeliveryStatus.ACCEPTED } as any
      mockDeliveryDomainService.acceptDelivery.mockResolvedValue(acceptedDelivery)

      const result = await service.acceptDelivery(deliveryId, courierId)

      expect(mockDeliveryEventService.tellPhonesOfferAnswered).not.toHaveBeenCalled()
      expect(result).toBe(acceptedDelivery)
    })

    test('acceptDelivery does not wait for tellPhonesOfferAnswered (fire-and-forget)', async () => {
      mockDeliveryEventService.offerAnswerTargets.mockResolvedValue(fakeTargets)
      let tellPhonesStarted = false
      let tellPhonesFinished = false
      mockDeliveryEventService.tellPhonesOfferAnswered.mockImplementation(async () => {
        tellPhonesStarted = true
        await new Promise((resolve) => setImmediate(resolve))
        tellPhonesFinished = true
      })
      const acceptedDelivery = { id: deliveryId, courierId, status: EnumDeliveryStatus.ACCEPTED } as any
      mockDeliveryDomainService.acceptDelivery.mockResolvedValue(acceptedDelivery)

      const result = await service.acceptDelivery(deliveryId, courierId)

      expect(result).toBe(acceptedDelivery)
      expect(tellPhonesStarted).toBe(true)
      expect(tellPhonesFinished).toBe(false)
      expect(mockDeliveryEventService.tellPhonesOfferAnswered).toHaveBeenCalledWith(fakeTargets)
    })

    test('acceptDelivery succeeds when deliveryEventService is undefined', async () => {
      const serviceWithoutEvents = new DeliveryRestApiCourierService(
        mockDeliveryDomainService,
        mockLocationNoteDomainService,
        mockDeliveryIssueDomainService,
        {} as any,
        mockRemovalRequestRepo,
        undefined,
        mockDeliveryRepository,
        undefined
      )
      const acceptedDelivery = { id: deliveryId, courierId, status: EnumDeliveryStatus.ACCEPTED } as any
      mockDeliveryDomainService.acceptDelivery.mockResolvedValue(acceptedDelivery)

      const result = await serviceWithoutEvents.acceptDelivery(deliveryId, courierId)

      expect(result).toBe(acceptedDelivery)
    })

    test('rejectDelivery reads offerAnswerTargets before answer and tells other phones after decline succeeds', async () => {
      const callSequence: string[] = []
      mockDeliveryEventService.offerAnswerTargets.mockImplementation(async () => {
        callSequence.push('offerAnswerTargets')
        return fakeTargets
      })
      const rejectedDelivery = { id: deliveryId, courierId: null, status: EnumDeliveryStatus.ASSIGNING_COURIER } as any
      mockDeliveryDomainService.rejectDelivery.mockImplementation(async () => {
        callSequence.push('domain:rejectDelivery')
        return rejectedDelivery
      })

      const result = await service.rejectDelivery(deliveryId, courierId)

      // Targets read before domain reject
      expect(callSequence).toEqual(['offerAnswerTargets', 'domain:rejectDelivery'])
      expect(mockDeliveryEventService.offerAnswerTargets).toHaveBeenCalledWith(deliveryId, courierId)
      expect(mockDeliveryDomainService.rejectDelivery).toHaveBeenCalledWith(deliveryId, courierId)
      expect(mockDeliveryEventService.tellPhonesOfferAnswered).toHaveBeenCalledWith(fakeTargets)
      expect(result).toBe(rejectedDelivery)
    })

    test('rejectDelivery refused answer (OfferHasEndedException) sends nothing to phones', async () => {
      mockDeliveryEventService.offerAnswerTargets.mockResolvedValue(fakeTargets)
      mockDeliveryDomainService.rejectDelivery.mockRejectedValue(new OfferHasEndedException())

      await expect(service.rejectDelivery(deliveryId, courierId)).rejects.toThrow(OfferHasEndedException)

      expect(mockDeliveryEventService.tellPhonesOfferAnswered).not.toHaveBeenCalled()
    })

    test('rejectDelivery does not tell phones when offerAnswerTargets returns null', async () => {
      mockDeliveryEventService.offerAnswerTargets.mockResolvedValue(null)
      const rejectedDelivery = { id: deliveryId, courierId: null, status: EnumDeliveryStatus.ASSIGNING_COURIER } as any
      mockDeliveryDomainService.rejectDelivery.mockResolvedValue(rejectedDelivery)

      const result = await service.rejectDelivery(deliveryId, courierId)

      expect(mockDeliveryEventService.tellPhonesOfferAnswered).not.toHaveBeenCalled()
      expect(result).toBe(rejectedDelivery)
    })
  })
})
