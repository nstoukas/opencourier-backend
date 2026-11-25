import { ConflictException } from '@nestjs/common'
import {
  EnumCourierStatus,
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
  Prisma,
} from '@prisma/types'
import { DeliveryCantBeAcceptedException, OfferHasEndedException } from 'src/errors'
import { DeliveryDomainService } from 'src/domains/delivery/delivery.domain.service'
import { eventText } from 'src/domains/delivery-event/event-text'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { ADD_ON_NOT_AUTOMATIC_SENTENCE } from 'src/domains/delivery/add-on'
import {
  MAX_DELIVERIES_HELD,
  STACK_CHANGED_SENTENCE,
  THIRD_DELIVERY_REFUSED_SENTENCE,
} from 'src/domains/delivery/stack'
import { DeliveryEventService } from './delivery-event.service'

// Spec 0048 (row 80): stacked orders assignment, pay safety, lifecycle, and third delivery refusal.
// Covers:
// - AC-4: stack offer formation, shared offerGroupId, OFFERED events with kind STACK and sequence
// - AC-5: group accept (both taken), race refusal (409 STACK_CHANGED_SENTENCE), group decline and expiry
// - AC-8 (amended by decision 128.0): an automatic accept takes a pair, both ACCEPTED messages marked automatic
// - AC-9: safety rule (each delivery paid its own full fee from stored quote, never reduced)
// - AC-11 / Cross check 10: third delivery refusal (409 THIRD_DELIVERY_REFUSED_SENTENCE on hand offer/reassign)
describe('Stacked orders assignment & lifecycle (spec 0048, row 80)', () => {
  const courierId = 'courier-r80'
  const partnerId = 'partner-kitchen-1'
  const offerGroupId = 'grp-stack-123'
  const offeredAt = new Date('2026-11-23T11:00:00.000Z')
  const offerExpiresAt = new Date('2026-11-23T11:01:00.000Z')

  let deliveryEventService: DeliveryEventService
  let deliveryDomainService: DeliveryDomainService

  let mockDeliveryRepo: any
  let mockDeliveryEventRepo: any
  let mockCourierRepo: any
  let mockCacheService: any
  let mockOfferPushService: any
  let mockDispatchStopRepo: any
  let mockCalculationService: any
  let mockConfigService: any
  let mockWebsocketDispatcher: any
  let mockBullMQService: any
  let mockOfferReasonRepo: any
  let mockCompensationRepo: any

  const makeDelivery = (id: string, opts: Partial<DeliveryEntity> = {}): DeliveryEntity =>
    new DeliveryEntity({
      id,
      partnerId,
      pickupLocationId: 'loc-p1',
      dropoffLocationId: `loc-d-${id}`,
      status: EnumDeliveryStatus.ASSIGNING_COURIER,
      matchedCourierId: courierId,
      courierId: null,
      offeredAt,
      offerExpiresAt,
      offerGroupId,
      boxUnits: 30,
      totalCompensation: 450, // 4.50 EUR from stored quote
      currencyCode: 'EUR',
      ...opts,
    } as any)

  beforeEach(() => {
    mockDeliveryRepo = {
      findById: jest.fn(),
      findByIdOrThrow: jest.fn(),
      findOpenGroupMembers: jest.fn(),
      findTakenGroupMembers: jest.fn(),
      takeOfferGroup: jest.fn(),
      updateIfMatches: jest.fn(),
      claimOfferWithinBox: jest.fn(),
      claimStackWithinBox: jest.fn(),
      findTakenNotAccepted: jest.fn().mockResolvedValue([]),
      settleStopSequence: jest.fn().mockResolvedValue(0),
      releaseOpenGroupPartners: jest.fn().mockResolvedValue(1),
      holdsSiblingLeg: jest.fn().mockResolvedValue(false),
    }

    mockDeliveryEventRepo = {
      create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
      findLatestOfTypes: jest.fn(),
    }

    mockCourierRepo = {
      findById: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({ id, userId: `user-${id}`, status: EnumCourierStatus.ONLINE, deactivatedAt: null })
      ),
      findByIdOrThrow: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({ id, userId: `user-${id}`, status: EnumCourierStatus.ONLINE, deactivatedAt: null })
      ),
      heldDeliveryCount: jest.fn().mockResolvedValue(0),
      liveDeliveryCount: jest.fn().mockResolvedValue(0),
      heldBoxUnits: jest.fn().mockResolvedValue(0),
      getCurrentLocation: jest.fn().mockResolvedValue({ latitude: 39.36, longitude: 22.94 }),
      isDeactivatedWaitingForLock: jest.fn().mockResolvedValue(false),
      hasActiveSos: jest.fn().mockResolvedValue(false),
      clearLocationIfOfflineAndFree: jest.fn().mockResolvedValue(undefined),
    }

    mockCacheService = {
      get: jest.fn().mockResolvedValue(null),
      getOrDefault: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    }

    mockOfferPushService = {
      sendOfferPush: jest.fn().mockResolvedValue(undefined),
      newOffer: jest.fn().mockResolvedValue(undefined),
      offerEnded: jest.fn().mockResolvedValue(undefined),
    }

    mockDispatchStopRepo = {
      findOn: jest.fn().mockResolvedValue(null),
    }

    mockCalculationService = {
      calculateDeliveryAmountsForMatchedCourier: jest.fn().mockImplementation(async ({ deliveryId }: any) => ({
        totalCost: 500,
        totalCompensation: deliveryId === 'del-1' ? 420 : 380, // Unique per-delivery quote pay
        fee: 50,
        feePercentage: 10,
      })),
    }

    mockConfigService = {
      instanceConfig: {
        getOfferExpiryEnabled: jest.fn().mockResolvedValue(true),
        getOfferExpirySeconds: jest.fn().mockResolvedValue(60),
        getOfferSkipMinutes: jest.fn().mockResolvedValue(20),
        getStackPairBlockMinutes: jest.fn().mockResolvedValue(20),
        getStackingEnabled: jest.fn().mockResolvedValue(true),
        getBoxDefaultSize: jest.fn().mockResolvedValue('MEDIUM'),
        getBoxUnitsSmall: jest.fn().mockResolvedValue(30),
        getBoxUnitsMedium: jest.fn().mockResolvedValue(50),
        getBoxUnitsLarge: jest.fn().mockResolvedValue(100),
        getReassignmentPayoutPolicies: jest.fn().mockResolvedValue({ FULL_COMPENSATION: 100 }),
        getReassignmentPayoutDefaultPolicy: jest.fn().mockResolvedValue('FULL_COMPENSATION'),
      },
    }

    mockWebsocketDispatcher = {
      dispatchDeliveryStatusUpdate: jest.fn(),
      dispatchDeliveryStatusUpdated: jest.fn(),
      sendOfferToCourier: jest.fn().mockResolvedValue(undefined),
      sendOfferEnded: jest.fn().mockResolvedValue(undefined),
    }

    mockBullMQService = {
      addJob: jest.fn().mockResolvedValue(undefined),
      removeDelayedJobsWithIdPrefix: jest.fn().mockResolvedValue(undefined),
    }

    mockOfferReasonRepo = {
      create: jest.fn().mockResolvedValue({ id: 'reason-1' }),
    }

    mockCompensationRepo = {
      create: jest.fn().mockResolvedValue({ id: 'comp-1' }),
      deleteById: jest.fn().mockResolvedValue(undefined),
    }

    const mockRemovalRequestRepo = {
      closeOpenForDelivery: jest.fn().mockResolvedValue(undefined),
      findApprovedUnsettled: jest.fn().mockResolvedValue([]),
    }

    deliveryEventService = new DeliveryEventService(
      { get: jest.fn() } as any,
      mockWebsocketDispatcher,
      mockCourierRepo,
      mockDeliveryRepo,
      mockDeliveryEventRepo,
      { registerTaskHandler: jest.fn() } as any,
      { registerTaskHandler: jest.fn() } as any,
      { sendWebhookIfSubscribed: jest.fn().mockResolvedValue(undefined) } as any,
      { findCourierForDelivery: jest.fn() } as any,
      mockCalculationService,
      mockBullMQService,
      mockConfigService,
      mockCacheService,
      mockOfferPushService,
      mockDispatchStopRepo,
      { getDurationMatrix: jest.fn() } as any,
      mockCompensationRepo,
      { findById: jest.fn() } as any,
      mockRemovalRequestRepo as any,
      mockOfferReasonRepo,
      undefined,
      undefined
    )

    deliveryDomainService = new DeliveryDomainService(
      mockDeliveryRepo,
      { emit: jest.fn() } as any,
      mockCacheService,
      deliveryEventService,
      mockCourierRepo,
      mockCompensationRepo,
      mockConfigService,
      { findById: jest.fn().mockResolvedValue(null) } as any
    )
  })

  // =========================================================================
  // AC-8: Automatic accept takes a pair (decision 128.0; add ons stay refused, see add-on.active.spec.ts)
  // =========================================================================
  describe('AC-8: automatic accept of a pair', () => {
    it('accepts both orders of a grouped offer on automatic: true, each ACCEPTED message marked automatic and naming the other order', async () => {
      const del1 = makeDelivery('del-1')
      const del2 = makeDelivery('del-2')
      mockDeliveryRepo.findByIdOrThrow
        .mockResolvedValueOnce(del1) // Initial read
        .mockResolvedValueOnce(new DeliveryEntity({ ...del1, status: EnumDeliveryStatus.ACCEPTED, courierId })) // verification del-1
        .mockResolvedValueOnce(new DeliveryEntity({ ...del2, status: EnumDeliveryStatus.ACCEPTED, courierId })) // verification del-2
      mockDeliveryRepo.findTakenGroupMembers.mockResolvedValueOnce([del1, del2])
      mockDeliveryRepo.takeOfferGroup.mockResolvedValueOnce(true)
      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent').mockResolvedValue(undefined)

      const result = await deliveryDomainService.acceptDelivery('del-1', courierId, true)

      expect(result.id).toBe('del-1')
      expect(mockDeliveryRepo.takeOfferGroup).toHaveBeenCalledWith(offerGroupId, courierId, offeredAt)
      expect(mockDeliveryRepo.findTakenGroupMembers).toHaveBeenCalledWith(offerGroupId, courierId, offeredAt)
      expect(processSpy).toHaveBeenCalledTimes(2)
      expect(processSpy).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          deliveryId: 'del-1',
          type: EnumDeliveryEventType.ACCEPTED,
          courierId,
          messageCode: 'ACCEPTED_TOGETHER_AUTOMATICALLY',
          messageParams: { courierId, deliveryId: 'del-1', otherDeliveryId: 'del-2' },
          message: expect.stringContaining('(accepted automatically)'),
        })
      )
      expect(processSpy).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          message: expect.stringContaining('del-2'),
        })
      )
      expect(processSpy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          deliveryId: 'del-2',
          type: EnumDeliveryEventType.ACCEPTED,
          courierId,
          messageCode: 'ACCEPTED_TOGETHER_AUTOMATICALLY',
          messageParams: { courierId, deliveryId: 'del-2', otherDeliveryId: 'del-1' },
          message: expect.stringContaining('(accepted automatically)'),
        })
      )
      expect(processSpy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          message: expect.stringContaining('del-1'),
        })
      )
    })

    it('refuses an accept carrying automatic: true on an add on offer with 409 ADD_ON_NOT_AUTOMATIC_SENTENCE', async () => {
      const addOn = makeDelivery('del-addon', {
        offerGroupId: null,
        stopSequence: [
          { stop: 'PICKUP', deliveryId: 'job-held-1' },
          { stop: 'PICKUP', deliveryId: 'del-addon' },
          { stop: 'DROPOFF', deliveryId: 'job-held-1' },
          { stop: 'DROPOFF', deliveryId: 'del-addon' },
        ],
      })
      mockDeliveryRepo.findByIdOrThrow.mockResolvedValueOnce(addOn)

      const call = deliveryDomainService.acceptDelivery('del-addon', courierId, true)

      await expect(call).rejects.toBeInstanceOf(ConflictException)
      await expect(call).rejects.toMatchObject({
        message: ADD_ON_NOT_AUTOMATIC_SENTENCE,
      })
      expect(mockDeliveryRepo.takeOfferGroup).not.toHaveBeenCalled()
      expect(mockDeliveryRepo.updateIfMatches).not.toHaveBeenCalled()
    })

    it('refuses an automatic accept with 409 STACK_CHANGED when stack changed before take (takeOfferGroup fails)', async () => {
      const del1 = makeDelivery('del-1')
      mockDeliveryRepo.findByIdOrThrow.mockResolvedValueOnce(del1)
      mockDeliveryRepo.takeOfferGroup.mockResolvedValueOnce(false)
      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent')

      const call = deliveryDomainService.acceptDelivery('del-1', courierId, true)

      await expect(call).rejects.toBeInstanceOf(ConflictException)
      await expect(call).rejects.toMatchObject({
        message: STACK_CHANGED_SENTENCE,
      })
      expect(mockDeliveryRepo.takeOfferGroup).toHaveBeenCalledWith(offerGroupId, courierId, offeredAt)
      expect(mockDeliveryRepo.findTakenGroupMembers).not.toHaveBeenCalled()
      expect(processSpy).not.toHaveBeenCalled()
    })

    it('reads partner order after takeOfferGroup via findTakenGroupMembers, so both orders get ACCEPTED event even if earlier read saw one', async () => {
      const del1 = makeDelivery('del-1')
      const del2 = makeDelivery('del-2')
      mockDeliveryRepo.findByIdOrThrow
        .mockResolvedValueOnce(del1) // Initial read
        .mockResolvedValueOnce(new DeliveryEntity({ ...del1, status: EnumDeliveryStatus.ACCEPTED, courierId })) // verification del-1
        .mockResolvedValueOnce(new DeliveryEntity({ ...del2, status: EnumDeliveryStatus.ACCEPTED, courierId })) // verification del-2

      // Verify findTakenGroupMembers is called after takeOfferGroup
      const stepOrder: string[] = []
      mockDeliveryRepo.takeOfferGroup.mockImplementationOnce(async () => {
        stepOrder.push('takeOfferGroup')
        return true
      })
      mockDeliveryRepo.findTakenGroupMembers.mockImplementationOnce(async () => {
        stepOrder.push('findTakenGroupMembers')
        return [del1, del2]
      })
      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent').mockResolvedValue(undefined)

      await deliveryDomainService.acceptDelivery('del-1', courierId, true)

      expect(stepOrder).toEqual(['takeOfferGroup', 'findTakenGroupMembers'])
      expect(processSpy).toHaveBeenCalledTimes(2)
      expect(processSpy).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          deliveryId: 'del-1',
          type: EnumDeliveryEventType.ACCEPTED,
          messageParams: expect.objectContaining({ otherDeliveryId: 'del-2' }),
        })
      )
      expect(processSpy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          deliveryId: 'del-2',
          type: EnumDeliveryEventType.ACCEPTED,
          messageParams: expect.objectContaining({ otherDeliveryId: 'del-1' }),
        })
      )
    })

    it('records ACCEPTED_AUTOMATICALLY when findTakenGroupMembers returns only the single taken delivery', async () => {
      const del1 = makeDelivery('del-1')
      mockDeliveryRepo.findByIdOrThrow
        .mockResolvedValueOnce(del1)
        .mockResolvedValueOnce(new DeliveryEntity({ ...del1, status: EnumDeliveryStatus.ACCEPTED, courierId }))
      mockDeliveryRepo.findTakenGroupMembers.mockResolvedValueOnce([del1])
      mockDeliveryRepo.takeOfferGroup.mockResolvedValueOnce(true)
      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent').mockResolvedValue(undefined)

      await deliveryDomainService.acceptDelivery('del-1', courierId, true)

      expect(processSpy).toHaveBeenCalledTimes(1)
      expect(processSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-1',
          type: EnumDeliveryEventType.ACCEPTED,
          messageCode: 'ACCEPTED_AUTOMATICALLY',
          messageParams: { courierId, deliveryId: 'del-1' },
          message: expect.stringContaining('(accepted automatically)'),
        })
      )
    })
  })

  // =========================================================================
  // AC-5: Group accept, race refusal, rollback, and sweep completion
  // =========================================================================
  describe('AC-5: group accept', () => {
    it('records ACCEPTED_TOGETHER naming the other order on a manual accept (automatic: false) of a pair', async () => {
      const del1 = makeDelivery('del-1')
      const del2 = makeDelivery('del-2')
      mockDeliveryRepo.findByIdOrThrow
        .mockResolvedValueOnce(del1) // Initial read
        .mockResolvedValueOnce(new DeliveryEntity({ ...del1, status: EnumDeliveryStatus.ACCEPTED, courierId })) // verification del-1
        .mockResolvedValueOnce(new DeliveryEntity({ ...del2, status: EnumDeliveryStatus.ACCEPTED, courierId })) // verification del-2

      mockDeliveryRepo.findTakenGroupMembers.mockResolvedValueOnce([del1, del2])
      mockDeliveryRepo.takeOfferGroup.mockResolvedValueOnce(true)

      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent').mockResolvedValue(undefined)

      const result = await deliveryDomainService.acceptDelivery('del-1', courierId, false)

      expect(result.id).toBe('del-1')
      expect(mockDeliveryRepo.takeOfferGroup).toHaveBeenCalledWith(offerGroupId, courierId, offeredAt)
      expect(processSpy).toHaveBeenCalledTimes(2)
      expect(processSpy).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          deliveryId: 'del-1',
          type: EnumDeliveryEventType.ACCEPTED,
          courierId,
          messageCode: 'ACCEPTED_TOGETHER',
          messageParams: { courierId, deliveryId: 'del-1', otherDeliveryId: 'del-2' },
          message: expect.stringContaining('offered together with delivery del-2'),
        })
      )
      expect(processSpy).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          message: expect.not.stringContaining('(accepted automatically)'),
        })
      )
      expect(processSpy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          deliveryId: 'del-2',
          type: EnumDeliveryEventType.ACCEPTED,
          courierId,
          messageCode: 'ACCEPTED_TOGETHER',
          messageParams: { courierId, deliveryId: 'del-2', otherDeliveryId: 'del-1' },
          message: expect.stringContaining('offered together with delivery del-1'),
        })
      )
      expect(processSpy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          message: expect.not.stringContaining('(accepted automatically)'),
        })
      )
    })

    it('accepting either delivery accepts both in one transaction, emitting ACCEPTED events for both', async () => {
      const del1 = makeDelivery('del-1')
      const del2 = makeDelivery('del-2')
      mockDeliveryRepo.findByIdOrThrow
        .mockResolvedValueOnce(del1) // Initial read
        .mockResolvedValueOnce(new DeliveryEntity({ ...del1, status: EnumDeliveryStatus.ACCEPTED, courierId })) // verification del-1
        .mockResolvedValueOnce(new DeliveryEntity({ ...del2, status: EnumDeliveryStatus.ACCEPTED, courierId })) // verification del-2

      mockDeliveryRepo.findTakenGroupMembers.mockResolvedValueOnce([del1, del2])
      mockDeliveryRepo.takeOfferGroup.mockResolvedValueOnce(true)

      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent').mockResolvedValue(undefined)

      const result = await (deliveryDomainService as any).acceptStack(del1, courierId)

      expect(result.id).toBe('del-1')
      expect(mockDeliveryRepo.takeOfferGroup).toHaveBeenCalledWith(offerGroupId, courierId, offeredAt)
      expect(processSpy).toHaveBeenCalledTimes(2)
      expect(processSpy).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          deliveryId: 'del-1',
          type: EnumDeliveryEventType.ACCEPTED,
          courierId,
        })
      )
      expect(processSpy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          deliveryId: 'del-2',
          type: EnumDeliveryEventType.ACCEPTED,
          courierId,
        })
      )
    })

    it('answers 409 STACK_CHANGED_SENTENCE and nothing changes when takeOfferGroup misses (partner taken or ended)', async () => {
      const del1 = makeDelivery('del-1')
      mockDeliveryRepo.findByIdOrThrow.mockResolvedValueOnce(del1)
      // Missed race: partner was claimed/ended meanwhile, exactly 2 rows did not match
      mockDeliveryRepo.takeOfferGroup.mockResolvedValueOnce(false)

      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent')

      const call = deliveryDomainService.acceptDelivery('del-1', courierId, false)

      await expect(call).rejects.toBeInstanceOf(ConflictException)
      await expect(call).rejects.toMatchObject({
        message: STACK_CHANGED_SENTENCE,
      })
      expect(mockDeliveryRepo.findTakenGroupMembers).not.toHaveBeenCalled()
      expect(processSpy).not.toHaveBeenCalled()
    })

    it('gives both offers back with deadlines and re-arms timers if first ACCEPTED event does not take', async () => {
      const del1 = makeDelivery('del-1')
      const del2 = makeDelivery('del-2')
      mockDeliveryRepo.findTakenGroupMembers.mockResolvedValueOnce([del1, del2])
      mockDeliveryRepo.takeOfferGroup.mockResolvedValueOnce(true)

      // First accept does not transition
      jest.spyOn(deliveryEventService, 'processDeliveryEvent').mockResolvedValue(undefined)
      mockDeliveryRepo.findByIdOrThrow.mockResolvedValueOnce(
        new DeliveryEntity({ ...del1, status: EnumDeliveryStatus.ASSIGNING_COURIER, courierId })
      )
      mockDeliveryRepo.updateIfMatches.mockResolvedValue(true)
      const rearmSpy = jest.spyOn(deliveryEventService, 'rearmOfferExpiry').mockResolvedValue(undefined)

      const call = (deliveryDomainService as any).acceptStack(del1, courierId)

      await expect(call).rejects.toBeInstanceOf(DeliveryCantBeAcceptedException)
      // Both given back
      expect(mockDeliveryRepo.updateIfMatches).toHaveBeenCalledTimes(2)
      expect(rearmSpy).toHaveBeenCalledTimes(2)
    })

    it('completeTakenAccepts: completes taken stack accepts whose second event did not land (cross check 8, row 172)', async () => {
      const delTaken = makeDelivery('del-unaccepted-partner', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        updatedAt: new Date(),
      })
      mockDeliveryRepo.findTakenNotAccepted.mockResolvedValueOnce([delTaken])
      mockDeliveryRepo.findById.mockResolvedValueOnce(
        new DeliveryEntity({ ...delTaken, status: EnumDeliveryStatus.ACCEPTED })
      )
      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent').mockResolvedValue(undefined)

      const completed = await deliveryEventService.completeTakenAccepts(new Date())

      expect(completed).toBe(1)
      expect(processSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-unaccepted-partner',
          type: EnumDeliveryEventType.ACCEPTED,
          actor: EnumEventActor.SYSTEM,
          courierId,
          source: EnumDeliveryEventSource.OPENCOURIER,
          messageCode: 'ACCEPTED_BY_SWEEP',
          messageParams: { courierId, deliveryId: 'del-unaccepted-partner' },
        })
      )
    })

    it('completeTakenAccepts: completes taken single accept (offerGroupId null) with ACCEPTED_ALONE_BY_SWEEP (row 172)', async () => {
      const delSingleTaken = makeDelivery('del-single-unaccepted', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        offerGroupId: null,
        updatedAt: new Date(),
      })
      mockDeliveryRepo.findTakenNotAccepted.mockResolvedValueOnce([delSingleTaken])
      mockDeliveryRepo.findById.mockResolvedValueOnce(
        new DeliveryEntity({ ...delSingleTaken, status: EnumDeliveryStatus.ACCEPTED })
      )
      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent').mockResolvedValue(undefined)

      const completed = await deliveryEventService.completeTakenAccepts(new Date())

      expect(completed).toBe(1)
      expect(processSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-single-unaccepted',
          type: EnumDeliveryEventType.ACCEPTED,
          actor: EnumEventActor.SYSTEM,
          courierId,
          source: EnumDeliveryEventSource.OPENCOURIER,
          messageCode: 'ACCEPTED_ALONE_BY_SWEEP',
          messageParams: { courierId, deliveryId: 'del-single-unaccepted' },
        })
      )
    })

    it('completeTakenAccepts: gives single order back to waiting when dispatch is stopped (row 172)', async () => {
      const delSingle = makeDelivery('del-single-stopped', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        offerGroupId: null,
        updatedAt: new Date(),
      })
      mockDeliveryRepo.findTakenNotAccepted.mockResolvedValueOnce([delSingle])
      mockDispatchStopRepo.findOn.mockResolvedValueOnce({ id: 'stop-active' })
      mockDeliveryRepo.updateIfMatches.mockResolvedValueOnce(true)
      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent')
      const rearmSpy = jest.spyOn(deliveryEventService as any, 'ensureBackstopIfStillWaiting').mockResolvedValue(undefined)
      const settleSpy = jest.spyOn(deliveryEventService as any, 'settleStackStops')

      const completed = await deliveryEventService.completeTakenAccepts(new Date())

      expect(completed).toBe(0)
      expect(processSpy).not.toHaveBeenCalled()
      expect(mockDeliveryRepo.updateIfMatches).toHaveBeenCalledWith(
        'del-single-stopped',
        { status: EnumDeliveryStatus.ASSIGNING_COURIER, courierId },
        expect.objectContaining({
          courierId: null,
          matchedCourierId: null,
          offeredAt: null,
          offerExpiresAt: null,
          offerGroupId: null,
          stopSequence: Prisma.DbNull,
        })
      )
      expect(rearmSpy).toHaveBeenCalledWith('del-single-stopped')
      expect(settleSpy).not.toHaveBeenCalled()
      expect(mockDeliveryRepo.settleStopSequence).not.toHaveBeenCalled()
      rearmSpy.mockRestore()
      settleSpy.mockRestore()
    })

    it('completeTakenAccepts: gives single order back to waiting when rider is deactivated (row 172)', async () => {
      const delSingle = makeDelivery('del-single-deactivated', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        offerGroupId: null,
        updatedAt: new Date(),
      })
      mockDeliveryRepo.findTakenNotAccepted.mockResolvedValueOnce([delSingle])
      mockCourierRepo.isDeactivatedWaitingForLock.mockResolvedValueOnce(true)
      mockDeliveryRepo.updateIfMatches.mockResolvedValueOnce(true)
      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent')
      const rearmSpy = jest.spyOn(deliveryEventService as any, 'ensureBackstopIfStillWaiting').mockResolvedValue(undefined)
      const settleSpy = jest.spyOn(deliveryEventService as any, 'settleStackStops')

      const completed = await deliveryEventService.completeTakenAccepts(new Date())

      expect(completed).toBe(0)
      expect(processSpy).not.toHaveBeenCalled()
      expect(mockDeliveryRepo.updateIfMatches).toHaveBeenCalledWith(
        'del-single-deactivated',
        { status: EnumDeliveryStatus.ASSIGNING_COURIER, courierId },
        expect.objectContaining({
          courierId: null,
          matchedCourierId: null,
          offeredAt: null,
          offerExpiresAt: null,
          offerGroupId: null,
          stopSequence: Prisma.DbNull,
        })
      )
      expect(rearmSpy).toHaveBeenCalledWith('del-single-deactivated')
      expect(settleSpy).not.toHaveBeenCalled()
      expect(mockDeliveryRepo.settleStopSequence).not.toHaveBeenCalled()
      rearmSpy.mockRestore()
      settleSpy.mockRestore()
    })

    it('completeTakenAccepts: gives single order back to waiting when accept has kept failing for > 10 min (row 172)', async () => {
      const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000)
      const delSingle = makeDelivery('del-single-giving-up', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        offerGroupId: null,
        updatedAt: elevenMinutesAgo,
      })
      mockDeliveryRepo.findTakenNotAccepted.mockResolvedValueOnce([delSingle])
      mockDeliveryRepo.updateIfMatches.mockResolvedValueOnce(true)
      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent')
      const rearmSpy = jest.spyOn(deliveryEventService as any, 'ensureBackstopIfStillWaiting').mockResolvedValue(undefined)
      const settleSpy = jest.spyOn(deliveryEventService as any, 'settleStackStops')

      const completed = await deliveryEventService.completeTakenAccepts(new Date())

      expect(completed).toBe(0)
      expect(processSpy).not.toHaveBeenCalled()
      expect(mockDeliveryRepo.updateIfMatches).toHaveBeenCalledWith(
        'del-single-giving-up',
        { status: EnumDeliveryStatus.ASSIGNING_COURIER, courierId },
        expect.objectContaining({
          courierId: null,
          matchedCourierId: null,
          offeredAt: null,
          offerExpiresAt: null,
          offerGroupId: null,
          stopSequence: Prisma.DbNull,
        })
      )
      expect(rearmSpy).toHaveBeenCalledWith('del-single-giving-up')
      expect(settleSpy).not.toHaveBeenCalled()
      expect(mockDeliveryRepo.settleStopSequence).not.toHaveBeenCalled()
      rearmSpy.mockRestore()
      settleSpy.mockRestore()
    })

    it('completeTakenAccepts: gives offer back to waiting when dispatch is stopped (review of row 80, ruling 6)', async () => {
      const delTaken = makeDelivery('del-stopped', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        updatedAt: new Date(),
      })
      mockDeliveryRepo.findTakenNotAccepted.mockResolvedValueOnce([delTaken])
      mockDispatchStopRepo.findOn.mockResolvedValueOnce({ id: 'stop-active' })
      mockDeliveryRepo.updateIfMatches.mockResolvedValueOnce(true)
      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent')

      const completed = await deliveryEventService.completeTakenAccepts(new Date())

      expect(completed).toBe(0)
      expect(processSpy).not.toHaveBeenCalled()
      expect(mockDeliveryRepo.updateIfMatches).toHaveBeenCalledWith(
        'del-stopped',
        { status: EnumDeliveryStatus.ASSIGNING_COURIER, courierId },
        expect.objectContaining({
          courierId: null,
          matchedCourierId: null,
          offeredAt: null,
          offerExpiresAt: null,
          offerGroupId: null,
          stopSequence: Prisma.DbNull,
        })
      )
      // agy review of row 80 (c04c08f): clears partner's 4-stop sequence so it does not stay with a stale pair route
      expect(mockDeliveryRepo.settleStopSequence).toHaveBeenCalledWith('grp-stack-123')
    })

    it('completeTakenAccepts: gives offer back to waiting when rider is deactivated (review of row 80, ruling 6)', async () => {
      const delTaken = makeDelivery('del-deactivated', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        updatedAt: new Date(),
      })
      mockDeliveryRepo.findTakenNotAccepted.mockResolvedValueOnce([delTaken])
      mockCourierRepo.isDeactivatedWaitingForLock.mockResolvedValueOnce(true)
      mockDeliveryRepo.updateIfMatches.mockResolvedValueOnce(true)
      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent')

      const completed = await deliveryEventService.completeTakenAccepts(new Date())

      expect(completed).toBe(0)
      expect(processSpy).not.toHaveBeenCalled()
      expect(mockDeliveryRepo.updateIfMatches).toHaveBeenCalledWith(
        'del-deactivated',
        { status: EnumDeliveryStatus.ASSIGNING_COURIER, courierId },
        expect.objectContaining({
          courierId: null,
          matchedCourierId: null,
          offeredAt: null,
          offerExpiresAt: null,
          offerGroupId: null,
          stopSequence: Prisma.DbNull,
        })
      )
      // agy review of row 80 (c04c08f): clears partner's 4-stop sequence
      expect(mockDeliveryRepo.settleStopSequence).toHaveBeenCalledWith('grp-stack-123')
    })

    it('completeTakenAccepts: gives offer back to waiting when accept has kept failing for > 10 min (review of row 80, ruling 6)', async () => {
      const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000)
      const delTaken = makeDelivery('del-giving-up', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        updatedAt: elevenMinutesAgo,
      })
      mockDeliveryRepo.findTakenNotAccepted.mockResolvedValueOnce([delTaken])
      mockDeliveryRepo.updateIfMatches.mockResolvedValueOnce(true)
      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent')

      const completed = await deliveryEventService.completeTakenAccepts(new Date())

      expect(completed).toBe(0)
      expect(processSpy).not.toHaveBeenCalled()
      expect(mockDeliveryRepo.updateIfMatches).toHaveBeenCalledWith(
        'del-giving-up',
        { status: EnumDeliveryStatus.ASSIGNING_COURIER, courierId },
        expect.objectContaining({
          courierId: null,
          matchedCourierId: null,
          offeredAt: null,
          offerExpiresAt: null,
          offerGroupId: null,
          stopSequence: Prisma.DbNull,
        })
      )
      // agy review of row 80 (c04c08f): clears partner's 4-stop sequence
      expect(mockDeliveryRepo.settleStopSequence).toHaveBeenCalledWith('grp-stack-123')
    })

    it('completeTakenAccepts: settles partner stop sequence when uncompleted taken stack accept is given back (review of row 80, c04c08f)', async () => {
      const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000)
      const delTaken = makeDelivery('del-give-back-settle', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        offerGroupId: 'grp-stack-settle-1',
        updatedAt: elevenMinutesAgo,
      })
      mockDeliveryRepo.findTakenNotAccepted.mockResolvedValueOnce([delTaken])
      mockDeliveryRepo.updateIfMatches.mockResolvedValueOnce(true)
      mockDeliveryRepo.settleStopSequence.mockResolvedValueOnce(1)
      const rearmSpy = jest.spyOn(deliveryEventService as any, 'ensureBackstopIfStillWaiting').mockResolvedValue(undefined)
      const settleSpy = jest.spyOn(deliveryEventService as any, 'settleStackStops')

      const completed = await deliveryEventService.completeTakenAccepts(new Date())

      expect(completed).toBe(0)
      expect(mockDeliveryRepo.updateIfMatches).toHaveBeenCalledWith(
        'del-give-back-settle',
        { status: EnumDeliveryStatus.ASSIGNING_COURIER, courierId },
        expect.objectContaining({
          courierId: null,
          matchedCourierId: null,
          offeredAt: null,
          offerExpiresAt: null,
          offerGroupId: null,
          stopSequence: Prisma.DbNull,
        })
      )
      expect(settleSpy).toHaveBeenCalledWith('grp-stack-settle-1', 'del-give-back-settle')
      expect(mockDeliveryRepo.settleStopSequence).toHaveBeenCalledWith('grp-stack-settle-1')
      expect(rearmSpy).toHaveBeenCalledWith('del-give-back-settle')
      rearmSpy.mockRestore()
      settleSpy.mockRestore()
    })

    it('completeTakenAccepts: skips settleStopSequence when delivery has null offerGroupId', async () => {
      const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000)
      const delTaken = makeDelivery('del-no-group', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        offerGroupId: null,
        updatedAt: elevenMinutesAgo,
      })
      mockDeliveryRepo.findTakenNotAccepted.mockResolvedValueOnce([delTaken])
      mockDeliveryRepo.updateIfMatches.mockResolvedValueOnce(true)
      const settleSpy = jest.spyOn(deliveryEventService as any, 'settleStackStops')

      await deliveryEventService.completeTakenAccepts(new Date())

      expect(settleSpy).not.toHaveBeenCalled()
      expect(mockDeliveryRepo.settleStopSequence).not.toHaveBeenCalled()
      settleSpy.mockRestore()
    })

    it('completeTakenAccepts: does not settleStopSequence when updateIfMatches returns false', async () => {
      const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000)
      const delTaken = makeDelivery('del-race-lost', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        offerGroupId: 'grp-race-lost',
        updatedAt: elevenMinutesAgo,
      })
      mockDeliveryRepo.findTakenNotAccepted.mockResolvedValueOnce([delTaken])
      // Missed race: updateIfMatches returned false
      mockDeliveryRepo.updateIfMatches.mockResolvedValueOnce(false)
      const settleSpy = jest.spyOn(deliveryEventService as any, 'settleStackStops')

      await deliveryEventService.completeTakenAccepts(new Date())

      expect(settleSpy).not.toHaveBeenCalled()
      expect(mockDeliveryRepo.settleStopSequence).not.toHaveBeenCalled()
      settleSpy.mockRestore()
    })

    it('completeTakenAccepts: catches settleStopSequence error and continues without failing the sweep', async () => {
      const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000)
      const delTaken = makeDelivery('del-error-settle', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId,
        offerGroupId: 'grp-error',
        updatedAt: elevenMinutesAgo,
      })
      mockDeliveryRepo.findTakenNotAccepted.mockResolvedValueOnce([delTaken])
      mockDeliveryRepo.updateIfMatches.mockResolvedValueOnce(true)
      mockDeliveryRepo.settleStopSequence.mockRejectedValueOnce(new Error('DB failure during stop sequence settle'))

      // Must not throw
      const completed = await deliveryEventService.completeTakenAccepts(new Date())
      expect(completed).toBe(0)
    })
  })

  // =========================================================================
  // AC-5: Group decline & expiry
  // =========================================================================
  describe('AC-5: group decline and expiry', () => {
    it('declineStack: ends both deliveries, skip lists rider for each, emits REJECTED for both, and sets pair block', async () => {
      const del1 = makeDelivery('del-1')
      const del2 = makeDelivery('del-2')
      mockDeliveryRepo.findOpenGroupMembers.mockResolvedValueOnce([del1, del2])
      mockDeliveryRepo.updateIfMatches.mockResolvedValue(true)
      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent').mockResolvedValue(undefined)

      await deliveryEventService.declineStack(del1, courierId)

      // Both deliveries cleared in conditional update with offerGroupId null and stopSequence DbNull
      expect(mockDeliveryRepo.updateIfMatches).toHaveBeenCalledTimes(2)
      expect(mockDeliveryRepo.updateIfMatches).toHaveBeenCalledWith(
        'del-1',
        expect.objectContaining({ matchedCourierId: courierId }),
        expect.objectContaining({ matchedCourierId: null, offerGroupId: null, stopSequence: Prisma.DbNull })
      )
      expect(mockDeliveryRepo.updateIfMatches).toHaveBeenCalledWith(
        'del-2',
        expect.objectContaining({ matchedCourierId: courierId }),
        expect.objectContaining({ matchedCourierId: null, offerGroupId: null, stopSequence: Prisma.DbNull })
      )

      // 20-minute pair block set in Redis
      expect(mockCacheService.save).toHaveBeenCalledWith('stack-pair-block-del-1-del-2', true, 20 * 60)

      // Both get REJECTED events mentioning the other order
      expect(processSpy).toHaveBeenCalledTimes(2)
      expect(processSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-1',
          type: EnumDeliveryEventType.REJECTED,
          courierId,
        })
      )
      expect(processSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-2',
          type: EnumDeliveryEventType.REJECTED,
          courierId,
        })
      )
    })

    it('declineStack throws OfferHasEndedException if offer was already ended or has no offerGroupId', async () => {
      const singleDel = makeDelivery('del-single', { offerGroupId: null })
      await expect(deliveryEventService.declineStack(singleDel, courierId)).rejects.toBeInstanceOf(OfferHasEndedException)
    })

    it('endOffer on expired stack: ends both deliveries, emits OFFER_EXPIRED for both, and sets pair block', async () => {
      const del1 = makeDelivery('del-1')
      const del2 = makeDelivery('del-2')
      mockDeliveryRepo.findById.mockResolvedValueOnce(del1)
      mockDeliveryRepo.findOpenGroupMembers.mockResolvedValueOnce([del1, del2])
      mockDeliveryRepo.updateIfMatches.mockResolvedValue(true)
      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent').mockResolvedValue(undefined)

      const endedCount = await (deliveryEventService as any).endOffer({
        deliveryId: 'del-1',
        courierId,
        offeredAt,
        reason: 'EXPIRED',
        text: eventText('OFFER_EXPIRED_AFTER', { seconds: 60 }),
      })

      expect(endedCount).toBe(2)
      expect(mockCacheService.save).toHaveBeenCalledWith('stack-pair-block-del-1-del-2', true, 20 * 60)
      expect(processSpy).toHaveBeenCalledTimes(2)
      expect(processSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-1',
          type: EnumDeliveryEventType.OFFER_EXPIRED,
          courierId,
        })
      )
      expect(processSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-2',
          type: EnumDeliveryEventType.OFFER_EXPIRED,
          courierId,
        })
      )
    })
  })

  // =========================================================================
  // AC-9: Safety rule - full fee per delivery in a stack
  // =========================================================================
  describe('AC-9: safety rule (full fee per delivery)', () => {
    it('each delivery in a stack is paid its own stored quote amount, never discounted or split', async () => {
      const first = makeDelivery('del-1')
      const second = makeDelivery('del-2')

      const courier = { id: courierId }
      const match = {
        courier,
        delivery: first,
        pickupLocation: { latitude: 39.36, longitude: 22.94 },
        travelSeconds: 120,
        reason: { kind: 'FAIRNESS', values: {} },
      }
      const plan = {
        partner: second,
        sequence: {
          stops: [
            { deliveryId: 'del-1', stop: 'PICKUP' as const },
            { deliveryId: 'del-2', stop: 'PICKUP' as const },
            { deliveryId: 'del-1', stop: 'DROPOFF' as const },
            { deliveryId: 'del-2', stop: 'DROPOFF' as const },
          ],
          delaySeconds: { 'del-1': 50, 'del-2': 70 },
          totalSeconds: 300,
        },
      }

      mockDeliveryRepo.claimStackWithinBox.mockResolvedValueOnce('CLAIMED')
      mockDeliveryRepo.findByIdOrThrow.mockImplementation(async (id: string) => (id === 'del-1' ? first : second))

      await (deliveryEventService as any).offerStack(match, plan, 'First order')

      expect(mockCalculationService.calculateDeliveryAmountsForMatchedCourier).toHaveBeenCalledWith({
        deliveryId: 'del-1',
        courierId,
      })
      expect(mockCalculationService.calculateDeliveryAmountsForMatchedCourier).toHaveBeenCalledWith({
        deliveryId: 'del-2',
        courierId,
      })

      // Claimed with respective full compensations (del-1: 420 cents, del-2: 380 cents)
      const claimArgs = mockDeliveryRepo.claimStackWithinBox.mock.calls[0]
      expect(claimArgs[1].data.totalCompensation).toBe(420)
      expect(claimArgs[2].data.totalCompensation).toBe(380)

      // Neither fee is reduced or halved
      expect(claimArgs[1].data.totalCompensation).not.toBeLessThan(420)
      expect(claimArgs[2].data.totalCompensation).not.toBeLessThan(380)
    })

    it('offerStack returns ALONE if calculating amounts for second delivery throws (review of row 80, ruling 4)', async () => {
      const first = makeDelivery('del-1')
      const second = makeDelivery('del-2')
      const courier = { id: courierId }
      const match = {
        courier,
        delivery: first,
        pickupLocation: { latitude: 39.36, longitude: 22.94 },
        travelSeconds: 120,
        reason: { kind: 'FAIRNESS', values: {} },
      }
      const plan = {
        partner: second,
        sequence: {
          stops: [
            { deliveryId: 'del-1', stop: 'PICKUP' as const },
            { deliveryId: 'del-2', stop: 'PICKUP' as const },
            { deliveryId: 'del-1', stop: 'DROPOFF' as const },
            { deliveryId: 'del-2', stop: 'DROPOFF' as const },
          ],
          delaySeconds: { 'del-1': 50, 'del-2': 70 },
          totalSeconds: 300,
        },
      }

      mockCalculationService.calculateDeliveryAmountsForMatchedCourier.mockImplementation(async ({ deliveryId }: any) => {
        if (deliveryId === 'del-2') throw new Error('Missing quote for second delivery')
        return { totalCost: 500, totalCompensation: 420, fee: 50, feePercentage: 10 }
      })

      const result = await (deliveryEventService as any).offerStack(match, plan, 'First order')

      expect(result).toBe('ALONE')
      expect(mockDeliveryRepo.claimStackWithinBox).not.toHaveBeenCalled()
    })

    it('offerStack emits OFFERED event for BOTH deliveries in the pair (Binding value 1, gap 3)', async () => {
      const first = makeDelivery('del-1')
      const second = makeDelivery('del-2')
      const courier = { id: courierId }
      const match = {
        courier,
        delivery: first,
        pickupLocation: { latitude: 39.36, longitude: 22.94 },
        travelSeconds: 120,
        reason: { kind: 'FAIRNESS', values: {} },
      }
      const plan = {
        partner: second,
        sequence: {
          stops: [
            { deliveryId: 'del-1', stop: 'PICKUP' as const },
            { deliveryId: 'del-2', stop: 'PICKUP' as const },
            { deliveryId: 'del-1', stop: 'DROPOFF' as const },
            { deliveryId: 'del-2', stop: 'DROPOFF' as const },
          ],
          delaySeconds: { 'del-1': 50, 'del-2': 70 },
          totalSeconds: 300,
        },
      }

      mockDeliveryRepo.claimStackWithinBox.mockResolvedValueOnce('CLAIMED')
      mockDeliveryRepo.findByIdOrThrow.mockImplementation(async (id: string) => (id === 'del-1' ? first : second))

      const saveOfferedSpy = jest.spyOn(deliveryEventService as any, 'saveOfferedEvent').mockResolvedValue(undefined)

      const result = await (deliveryEventService as any).offerStack(match, plan, 'Note 1')

      expect(result).toBe('OFFERED')
      // Binding value 1: both deliveries must have their OFFERED DeliveryEvent saved
      expect(saveOfferedSpy).toHaveBeenCalledTimes(2)
      expect(saveOfferedSpy).toHaveBeenNthCalledWith(
        1,
        'del-1',
        courierId,
        EnumEventActor.SYSTEM,
        expect.any(Date),
        null,
        expect.arrayContaining([
          expect.objectContaining({
            part: 'STACK_PAIRED',
            params: expect.objectContaining({ otherDeliveryId: 'del-2' }),
          }),
        ]),
        expect.objectContaining({ kind: 'STACK', values: expect.objectContaining({ partnerDeliveryId: 'del-2' }) })
      )
      expect(saveOfferedSpy).toHaveBeenNthCalledWith(
        2,
        'del-2',
        courierId,
        EnumEventActor.SYSTEM,
        expect.any(Date),
        null,
        expect.arrayContaining([
          expect.objectContaining({
            part: 'STACK_PAIRED',
            params: expect.objectContaining({ otherDeliveryId: 'del-1' }),
          }),
        ]),
        expect.objectContaining({ kind: 'STACK', values: expect.objectContaining({ partnerDeliveryId: 'del-1' }) })
      )
      saveOfferedSpy.mockRestore()
    })
  })

  // =========================================================================
  // AC-11 / Cross check 10: Third delivery refusal
  // =========================================================================
  describe('AC-11: third delivery refusal (max 2 held)', () => {
    it('refuseIfCourierHoldsTwo throws 409 THIRD_DELIVERY_REFUSED_SENTENCE when rider already holds 2 deliveries', async () => {
      mockCourierRepo.liveDeliveryCount.mockResolvedValueOnce(MAX_DELIVERIES_HELD)

      const call = deliveryEventService.refuseIfCourierHoldsTwo(courierId, 'del-new')

      await expect(call).rejects.toBeInstanceOf(ConflictException)
      await expect(call).rejects.toMatchObject({
        message: THIRD_DELIVERY_REFUSED_SENTENCE,
      })
    })

    it('refuseIfCourierHoldsTwo allows rider holding 0 or 1 delivery', async () => {
      mockCourierRepo.liveDeliveryCount.mockResolvedValueOnce(1)
      await expect(deliveryEventService.refuseIfCourierHoldsTwo(courierId, 'del-new')).resolves.toBeUndefined()
    })

    it('admin hand offer throws 409 THIRD_DELIVERY_REFUSED_SENTENCE even if confirmOverCapacity is true', async () => {
      mockCourierRepo.liveDeliveryCount.mockResolvedValueOnce(2)
      mockDeliveryRepo.findByIdOrThrow.mockResolvedValueOnce(
        new DeliveryEntity({ id: 'del-3', status: EnumDeliveryStatus.CREATED, boxUnits: 30 } as any)
      )

      const call = deliveryDomainService.submitDeliveryEvent(
        {
          deliveryId: 'del-3',
          eventType: EnumDeliveryEventType.ACCEPTED,
          courierId,
          confirmOverCapacity: true, // Attempt override
        } as any,
        'by hand',
        { id: 'admin-1', username: 'coordinator' } as any
      )

      await expect(call).rejects.toBeInstanceOf(ConflictException)
      await expect(call).rejects.toMatchObject({
        message: THIRD_DELIVERY_REFUSED_SENTENCE,
      })
    })

    it('admin reassignment throws 409 THIRD_DELIVERY_REFUSED_SENTENCE when target courier holds 2 deliveries', async () => {
      mockCourierRepo.liveDeliveryCount.mockResolvedValueOnce(2)
      mockDeliveryRepo.findByIdOrThrow.mockResolvedValueOnce(
        new DeliveryEntity({
          id: 'del-reassign',
          status: EnumDeliveryStatus.ACCEPTED,
          courierId: 'courier-old',
          boxUnits: 30,
        } as any)
      )

      const call = deliveryDomainService.reassignDelivery('del-reassign', courierId)

      await expect(call).rejects.toBeInstanceOf(ConflictException)
      await expect(call).rejects.toMatchObject({
        message: THIRD_DELIVERY_REFUSED_SENTENCE,
      })
      expect(mockCompensationRepo.create).not.toHaveBeenCalled()
    })

    it('third hand offer to a rider with 1 ongoing job and 1 taken order in mid-accept is refused with 409 (review of row 80, critical)', async () => {
      // liveDeliveryCount counts ongoing deliveries + taken deliveries in ASSIGNING_COURIER = 2
      mockCourierRepo.liveDeliveryCount.mockResolvedValueOnce(2)
      mockDeliveryRepo.findByIdOrThrow.mockResolvedValueOnce(
        new DeliveryEntity({ id: 'del-third', status: EnumDeliveryStatus.CREATED, boxUnits: 25 } as any)
      )

      const call = deliveryDomainService.submitDeliveryEvent(
        {
          deliveryId: 'del-third',
          eventType: EnumDeliveryEventType.ACCEPTED,
          courierId,
        } as any,
        'by hand',
        { id: 'admin-1', username: 'coordinator' } as any
      )

      await expect(call).rejects.toBeInstanceOf(ConflictException)
      await expect(call).rejects.toMatchObject({
        message: THIRD_DELIVERY_REFUSED_SENTENCE,
      })
    })
  })

  // =========================================================================
  // Decision 80.5: Releasing open group partners
  // =========================================================================
  describe('decision 80.5: partner leaving open stack', () => {
    it('when one order of an open stack leaves, the other order is released to stay offered alone', async () => {
      mockDeliveryRepo.releaseOpenGroupPartners.mockResolvedValueOnce(1)

      await (deliveryEventService as any).releaseStackPartners(offerGroupId, 'del-1')

      expect(mockDeliveryRepo.releaseOpenGroupPartners).toHaveBeenCalledWith(offerGroupId, 'del-1')
    })
  })
})
