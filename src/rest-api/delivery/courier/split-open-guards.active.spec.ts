import { ConflictException } from '@nestjs/common'
import { EnumDeliveryStatus, EnumSplitRequestStatus } from '@prisma/types'
import { SPLIT_SENTENCES } from 'src/domains/split/split'
import { DeliveryRestApiCourierService } from './delivery.courier.rest-api.service'
import { InProgressDeliveryCourierDto } from './dtos/in-progress-delivery.courier.dto'
import { LeaveWaitCourierService } from './leave-wait.courier.service'

// Spec 0047, cross check 6: while a split request is OPEN the rider's Picked up and spec 0033's leave wait
// answer 409, because the answer may change what the rider carries. Also AC-2 and AC-7: the rider's job
// list carries their split request, with the time they may leave.
describe('what an open split request blocks, and what the rider sees (spec 0047)', () => {
  const DELIVERY_ID = 'del-1'
  const COURIER_ID = 'rider-1'
  const FLAGGED_AT = new Date('2026-11-21T12:00:00.000Z')
  const openRequest = {
    id: 'split-1',
    deliveryId: DELIVERY_ID,
    courierId: COURIER_ID,
    status: EnumSplitRequestStatus.OPEN,
    proposedLegs: [{ boxSize: 'LARGE' }, { boxSize: 'SMALL' }],
    finalLegs: null,
    openFor: DELIVERY_ID,
    createdAt: FLAGGED_AT,
    answeredAt: null,
    answeredByUserId: null,
    adminNote: null,
  }

  describe('Picked up', () => {
    function setup(open: object | null) {
      const deliveryDomainService = {
        getById: jest.fn().mockResolvedValue({ id: DELIVERY_ID, courierId: COURIER_ID, status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION }),
        markAsPickedUp: jest.fn().mockResolvedValue({ id: DELIVERY_ID, status: EnumDeliveryStatus.PICKED_UP }),
      }
      const splitRequestRepository = { findOpenForDelivery: jest.fn().mockResolvedValue(open) }
      const service = new DeliveryRestApiCourierService(
        deliveryDomainService as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        splitRequestRepository as any
      )
      return { service, deliveryDomainService, splitRequestRepository }
    }

    it('is 409 with a sentence while a request is OPEN, and the delivery is not picked up', async () => {
      const { service, deliveryDomainService, splitRequestRepository } = setup(openRequest)

      const attempt = service.markAsPickedUp(DELIVERY_ID, COURIER_ID, {} as any)

      await expect(attempt).rejects.toBeInstanceOf(ConflictException)
      await expect(attempt).rejects.toThrow(SPLIT_SENTENCES.pickupBlocked)
      expect(splitRequestRepository.findOpenForDelivery).toHaveBeenCalledWith(DELIVERY_ID)
      expect(deliveryDomainService.markAsPickedUp).not.toHaveBeenCalled()
    })

    it('goes through as before when no request is open (answered, or never asked)', async () => {
      const { service, deliveryDomainService } = setup(null)

      await service.markAsPickedUp(DELIVERY_ID, COURIER_ID, {} as any)

      expect(deliveryDomainService.markAsPickedUp).toHaveBeenCalledTimes(1)
      expect(deliveryDomainService.markAsPickedUp.mock.calls[0][0]).toBe(DELIVERY_ID)
    })
  })

  describe("spec 0033's leave wait", () => {
    function setup(open: object | null) {
      const deliveryRepository = {
        findById: jest.fn().mockResolvedValue({
          id: DELIVERY_ID,
          courierId: COURIER_ID,
          status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
          // Long past the ordinary limit, so only the open split request can be what refuses.
          arrivedAtPickupAt: new Date('2020-01-01T10:00:00.000Z'),
          promisedReadyAt: new Date('2020-01-01T10:00:00.000Z'),
        }),
      }
      const deliveryEventService = { occurredAtForCourierTap: jest.fn(), leaveWait: jest.fn().mockResolvedValue(true) }
      const splitRequestRepository = { findOpenForDelivery: jest.fn().mockResolvedValue(open) }
      const service = new LeaveWaitCourierService(
        deliveryRepository as any,
        { instanceConfig: { getWaitLimitMinutes: jest.fn().mockResolvedValue(10) } } as any,
        deliveryEventService as any,
        splitRequestRepository as any
      )
      return { service, deliveryEventService, splitRequestRepository }
    }

    it('is 409 with a sentence while a request is OPEN, and the rider is not taken off the delivery', async () => {
      const { service, deliveryEventService, splitRequestRepository } = setup(openRequest)

      const attempt = service.leave(DELIVERY_ID, COURIER_ID)

      await expect(attempt).rejects.toBeInstanceOf(ConflictException)
      await expect(attempt).rejects.toThrow(SPLIT_SENTENCES.leaveWaitBlocked)
      expect(splitRequestRepository.findOpenForDelivery).toHaveBeenCalledWith(DELIVERY_ID)
      expect(deliveryEventService.leaveWait).not.toHaveBeenCalled()
    })

    it('goes through as before when no request is open', async () => {
      const { service, deliveryEventService } = setup(null)
      await service.leave(DELIVERY_ID, COURIER_ID)
      expect(deliveryEventService.leaveWait).toHaveBeenCalledTimes(1)
    })
  })

  describe("the rider's job list carries their split request (AC-2, AC-7)", () => {
    const job = (id: string) => ({
      id,
      courierId: COURIER_ID,
      status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
      dropoffLocationId: 'loc-drop',
      pickupLocationId: 'loc-pick',
      pickupLocation: {},
      dropoffLocation: {},
    })
    const requestOn = (deliveryId: string, status: EnumSplitRequestStatus) => ({ ...openRequest, id: `split-${deliveryId}`, deliveryId, status })

    function setup(requests: object[]) {
      const deliveryDomainService = {
        getMany: jest.fn().mockResolvedValue({
          data: ['del-open', 'del-refused', 'del-confirmed', 'del-left', 'del-void', 'del-none'].map(job),
          pagination: {},
        }),
      }
      const splitRequestRepository = { findNewestByCourierForDeliveries: jest.fn().mockResolvedValue(requests) }
      const service = new DeliveryRestApiCourierService(
        deliveryDomainService as any,
        { getManyByLocationIds: jest.fn().mockResolvedValue([]) } as any,
        { getCountsByNoteIds: jest.fn().mockResolvedValue({}), getReactionByCourierOnNoteIds: jest.fn().mockResolvedValue({}) } as any,
        {} as any,
        {} as any,
        { findNewestByCourierForDeliveries: jest.fn().mockResolvedValue([]) } as any,
        splitRequestRepository as any
      )
      return { service, splitRequestRepository }
    }

    it('shows the request while OPEN, REFUSED or CONFIRMED, and nothing once LEFT or VOID or when there is none', async () => {
      const { service, splitRequestRepository } = setup([
        requestOn('del-open', EnumSplitRequestStatus.OPEN),
        requestOn('del-refused', EnumSplitRequestStatus.REFUSED),
        requestOn('del-confirmed', EnumSplitRequestStatus.CONFIRMED),
        requestOn('del-left', EnumSplitRequestStatus.LEFT),
        requestOn('del-void', EnumSplitRequestStatus.VOID),
      ])

      const result = await service.getMyInProgressDeliveriesWithNotes(COURIER_ID)

      // Only this rider's requests are asked for.
      expect(splitRequestRepository.findNewestByCourierForDeliveries).toHaveBeenCalledWith(COURIER_ID, [
        'del-open',
        'del-refused',
        'del-confirmed',
        'del-left',
        'del-void',
        'del-none',
      ])
      const shown = Object.fromEntries(result.data.map((delivery: any) => [delivery.id, delivery.splitRequest?.status ?? null]))
      expect(shown).toEqual({
        'del-open': EnumSplitRequestStatus.OPEN,
        'del-refused': EnumSplitRequestStatus.REFUSED,
        'del-confirmed': EnumSplitRequestStatus.CONFIRMED,
        'del-left': null,
        'del-void': null,
        'del-none': null,
      })
    })
  })

  describe('the job card DTO works out when the rider may leave (AC-2)', () => {
    // The smallest delivery the DTO's constructor accepts.
    const rawJob = (splitRequest: object | null) =>
      ({
        id: DELIVERY_ID,
        status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
        courierId: COURIER_ID,
        pickupLocation: {},
        dropoffLocation: {},
        pickupLocationNotes: [],
        dropoffLocationNotes: [],
        splitRequest,
      } as any)

    it("leaveFrom is the flag time plus the co-op's splitAnswerMinutes", () => {
      const dto = new InProgressDeliveryCourierDto(rawJob({ ...openRequest, answeredByUserId: 'admin-user-9' }), {
        leaveMinutes: 10,
        freeMinutes: 5,
        payOn: true,
        splitAnswerMinutes: 7,
      })

      expect(dto.splitRequest).toMatchObject({ id: 'split-1', status: EnumSplitRequestStatus.OPEN, createdAt: FLAGGED_AT })
      expect(dto.splitRequest?.leaveFrom).toEqual(new Date('2026-11-21T12:07:00.000Z'))
      // The rider never learns which admin answered.
      expect(JSON.stringify(dto.splitRequest)).not.toContain('admin-user-9')
    })

    it('is null when the job has no split request', () => {
      const dto = new InProgressDeliveryCourierDto(rawJob(null), { leaveMinutes: 10, freeMinutes: 5, payOn: true, splitAnswerMinutes: 7 })
      expect(dto.splitRequest).toBeNull()
    })
  })
})
