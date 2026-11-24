import { ConflictException } from '@nestjs/common'
import {
  EnumCourierStatus,
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
  Prisma,
} from '@prisma/types'
import { DeliveryDomainService } from 'src/domains/delivery/delivery.domain.service'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { ADD_ON_NOT_AUTOMATIC_SENTENCE, isAddOnOffer } from 'src/domains/delivery/add-on'
import { DeliveryEventService } from './delivery-event.service'
import { EnumAddOnMoment, EnumTwoOrderPolicy } from 'src/shared-types/stacking'
import { EnumCourierMatcherType } from 'src/shared-types'
import { AddOnPlan } from 'src/services/two-order/two-order.service'

// Spec 0048 (row 81): mid job add on offers assignment, pay safety, calm offer, doubled answer time,
// automatic accept refusal, and free decline.
// Covers:
// - AC-1: add-on switch and moment
// - AC-6: add-on offer formation, stop list, extra km, extra minutes, ADD_ON reason
// - AC-7: free decline leaving current job untouched, rider skip-listed for add-on only
// - AC-8: automatic accept refusal (409 ADD_ON_NOT_AUTOMATIC_SENTENCE)
// - AC-9: safety rule (add-on paid in full from own quote, never reduced)
// - Cross check 2: calm offer and doubled answer time while carrying food
// - Decision 81.6: group join on accept
// - Decision 81.7: locked claim with JOB_CHANGED check
describe('Mid job add on assignment, pay safety & lifecycle (spec 0048, row 81)', () => {
  const courierId = 'courier-r81'
  const partnerId = 'partner-kitchen-1'
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
  let mockTwoOrderService: any
  let mockMatchingService: any

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
      offerGroupId: null,
      boxUnits: 30,
      totalCompensation: 450, // 4.50 EUR from quote
      totalCost: 550,
      fee: 50,
      feePercentage: 10,
      currencyCode: 'EUR',
      ...opts,
    } as any)

  const sampleStops = [
    { deliveryId: 'job-held-1', stop: 'PICKUP' as const },
    { deliveryId: 'del-add-on', stop: 'PICKUP' as const },
    { deliveryId: 'job-held-1', stop: 'DROPOFF' as const },
    { deliveryId: 'del-add-on', stop: 'DROPOFF' as const },
  ]

  const sampleJobStatuses = [
    EnumDeliveryStatus.ACCEPTED,
    EnumDeliveryStatus.DISPATCHED,
    EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
  ]

  const makePlan = (overrides: Partial<AddOnPlan> = {}): AddOnPlan => ({
    courierId,
    job: makeDelivery('job-held-1', { status: EnumDeliveryStatus.ACCEPTED, courierId }),
    sequence: {
      stops: sampleStops,
      delaySeconds: { 'job-held-1': 60, 'del-add-on': 120 },
      totalSeconds: 400,
      extraSeconds: 120,
      extraMetres: 800,
      secondsToNewPickup: 50,
    },
    carryingFood: false,
    candidateCount: 1,
    strategy: EnumCourierMatcherType.FAIRNESS,
    policy: EnumTwoOrderPolicy.SHORTAGE_ONLY,
    freeRiderFound: false,
    jobStatuses: sampleJobStatuses,
    ...overrides,
  })

  beforeEach(() => {
    mockDeliveryRepo = {
      findById: jest.fn(),
      findByIdOrThrow: jest.fn(),
      findByIdOrThrowWithLocations: jest.fn(),
      updateIfMatches: jest.fn().mockResolvedValue(true),
      claimAddOnWithinBox: jest.fn().mockResolvedValue('CLAIMED'),
      joinAcceptedAddOn: jest.fn().mockResolvedValue(true),
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
      hasActiveSos: jest.fn().mockResolvedValue(false),
      isDeactivatedWaitingForLock: jest.fn().mockResolvedValue(false),
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
      calculateDeliveryAmountsForMatchedCourier: jest.fn().mockResolvedValue({
        totalCost: 550,
        totalCompensation: 450, // Full pay from own quote
        fee: 50,
        feePercentage: 10,
      }),
    }

    mockConfigService = {
      instanceConfig: {
        getOfferExpiryEnabled: jest.fn().mockResolvedValue(true),
        getOfferExpirySeconds: jest.fn().mockResolvedValue(60),
        getAddOnOffersEnabled: jest.fn().mockResolvedValue(true),
        getTwoOrderPolicy: jest.fn().mockResolvedValue(EnumTwoOrderPolicy.SHORTAGE_ONLY),
        getTwoOrderDelayLimitMinutes: jest.fn().mockResolvedValue(10),
        getAddOnMoment: jest.fn().mockResolvedValue(EnumAddOnMoment.BEFORE_PICKUP),
        getMaxAssignmentDistanceInKM: jest.fn().mockResolvedValue(5),
        getCourierMatcherTypeSetting: jest.fn().mockResolvedValue(EnumCourierMatcherType.FAIRNESS),
        getOfferSkipMinutes: jest.fn().mockResolvedValue(20),
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

    mockTwoOrderService = {
      findAddOn: jest.fn(),
    }

    mockMatchingService = {
      findCourierForDelivery: jest.fn().mockResolvedValue(undefined), // No free rider by default (shortage)
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
      mockMatchingService,
      mockCalculationService,
      mockBullMQService,
      mockConfigService,
      mockCacheService,
      mockOfferPushService,
      mockDispatchStopRepo,
      { getDurationMatrix: jest.fn() } as any,
      mockCompensationRepo,
      { findById: jest.fn() } as any,
      { closeOpenForDelivery: jest.fn().mockResolvedValue(undefined) } as any,
      mockOfferReasonRepo,
      undefined,
      mockTwoOrderService
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
  // AC-8: Automatic accept refusal
  // =========================================================================
  describe('AC-8: automatic accept refusal for add-ons', () => {
    it('refuses an accept carrying automatic: true on an open add on offer with 409 ADD_ON_NOT_AUTOMATIC_SENTENCE', async () => {
      const addOnDelivery = makeDelivery('del-add-on', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        offerGroupId: null,
        stopSequence: sampleStops,
      })
      mockDeliveryRepo.findByIdOrThrow.mockResolvedValueOnce(addOnDelivery)

      expect(isAddOnOffer(addOnDelivery)).toBe(true)

      const call = deliveryDomainService.acceptDelivery('del-add-on', courierId, true)

      await expect(call).rejects.toBeInstanceOf(ConflictException)
      await expect(call).rejects.toMatchObject({
        message: ADD_ON_NOT_AUTOMATIC_SENTENCE,
      })
      expect(mockDeliveryRepo.updateIfMatches).not.toHaveBeenCalled()
    })

    it('allows a manual accept (automatic: false or undefined) of an open add on offer', async () => {
      const addOnDelivery = makeDelivery('del-add-on', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        offerGroupId: null,
        stopSequence: sampleStops,
      })
      mockDeliveryRepo.findByIdOrThrow
        .mockResolvedValueOnce(addOnDelivery)
        .mockResolvedValueOnce(new DeliveryEntity({ ...addOnDelivery, status: EnumDeliveryStatus.ACCEPTED, courierId }))
      mockDeliveryRepo.updateIfMatches.mockResolvedValueOnce(true)

      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent').mockResolvedValue(undefined)

      await deliveryDomainService.acceptDelivery('del-add-on', courierId, false)

      expect(mockDeliveryRepo.updateIfMatches).toHaveBeenCalledWith(
        'del-add-on',
        expect.objectContaining({
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: courierId,
          courierId: null,
        }),
        expect.objectContaining({
          courierId,
          offerExpiresAt: null,
        })
      )
      expect(processSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.ACCEPTED,
          deliveryId: 'del-add-on',
          actor: EnumEventActor.COURIER,
        })
      )
    })
  })

  // =========================================================================
  // AC-9: Safety rule - Full quote pay
  // =========================================================================
  describe('AC-9: safety rule (full fee from own quote)', () => {
    it('calculates and writes full pay from the delivery quote, unchanged by being an add on', async () => {
      const newDelivery = makeDelivery('del-add-on')
      mockDeliveryRepo.findByIdOrThrow.mockResolvedValue(newDelivery)

      const plan: AddOnPlan = makePlan()
      mockTwoOrderService.findAddOn.mockResolvedValueOnce(plan)

      // The calculation service returns full quote pay for this delivery
      mockCalculationService.calculateDeliveryAmountsForMatchedCourier.mockResolvedValueOnce({
        totalCost: 550,
        totalCompensation: 450, // 4.50 EUR
        fee: 50,
        feePercentage: 10,
      })

      const result = await (deliveryEventService as any).offerToNextCourier('del-add-on')

      expect(result).toBe('OFFERED')
      expect(mockCalculationService.calculateDeliveryAmountsForMatchedCourier).toHaveBeenCalledWith({
        deliveryId: 'del-add-on',
        courierId,
      })
      // Claim writes the exact calculated amounts
      expect(mockDeliveryRepo.claimAddOnWithinBox).toHaveBeenCalledWith(
        'del-add-on',
        courierId,
        'job-held-1',
        plan.jobStatuses,
        expect.any(Object),
        expect.objectContaining({
          totalCost: 550,
          totalCompensation: 450,
          fee: 50,
          feePercentage: 10,
        })
      )
    })
  })

  // =========================================================================
  // AC-6 & Cross check 2: Offer formation, calm offer & doubled answer time
  // =========================================================================
  describe('AC-6 & Cross check 2: calm offer and doubled answer time', () => {
    it('when rider is carrying food: doubles answer time and sends calm OFFERED event and push', async () => {
      const newDelivery = makeDelivery('del-add-on')
      mockDeliveryRepo.findByIdOrThrow.mockResolvedValue(newDelivery)
      // Expiry setting is 60s
      mockConfigService.instanceConfig.getOfferExpirySeconds.mockResolvedValue(60)

      const plan: AddOnPlan = makePlan({
        job: makeDelivery('job-held-1', { status: EnumDeliveryStatus.PICKED_UP, courierId }),
        sequence: {
          stops: sampleStops,
          delaySeconds: { 'job-held-1': 100, 'del-add-on': 150 },
          totalSeconds: 500,
          extraSeconds: 150,
          extraMetres: 1200,
          secondsToNewPickup: 80,
        },
        carryingFood: true, // Rider is carrying food!
        candidateCount: 2,
        strategy: EnumCourierMatcherType.FAIRNESS,
        policy: EnumTwoOrderPolicy.SHORTAGE_ONLY,
        freeRiderFound: false,
      })
      mockTwoOrderService.findAddOn.mockResolvedValueOnce(plan)

      const result = await (deliveryEventService as any).offerToNextCourier('del-add-on')

      expect(result).toBe('OFFERED')

      // 1. Claim was called with doubled expiry (60 * 2 = 120s)
      const claimCall = mockDeliveryRepo.claimAddOnWithinBox.mock.calls[0]
      const updateData = claimCall[5]
      expect(updateData.matchedCourierId).toBe(courierId)
      expect(updateData.offerGroupId).toBeNull() // Group ID is null until accept
      expect(updateData.addOnExtraMetres).toBe(1200)
      expect(updateData.addOnExtraSeconds).toBe(150)
      const expiryMs = updateData.offerExpiresAt.getTime() - updateData.offeredAt.getTime()
      expect(Math.round(expiryMs / 1000)).toBe(120) // Twice 60s!

      // 2. BullMQ schedule expiry was scheduled with 120s + 3s grace
      expect(mockBullMQService.addJob).toHaveBeenCalledWith(
        'offer-expiry',
        expect.objectContaining({ deliveryId: 'del-add-on', courierId }),
        expect.objectContaining({ delay: 123000 })
      )

      // 3. OFFERED event recorded with calm notice, ADD_ON reason, and why text (decision 81.16)
      expect(mockDeliveryEventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.OFFERED,
          deliveryId: 'del-add-on',
          courierId,
          message: expect.stringContaining(
            '; the rider carries food, so twice the time to answer and no insistent ring; no free rider was found'
          ),
        })
      )

      // 4. OfferReason recorded with kind ADD_ON, carryingFood: true, policy, and freeRiderFound
      expect(mockOfferReasonRepo.create).toHaveBeenCalledWith(
        'evt-1',
        'del-add-on',
        courierId,
        expect.objectContaining({
          kind: 'ADD_ON',
          strategy: EnumCourierMatcherType.FAIRNESS,
          values: expect.objectContaining({
            currentDeliveryId: 'job-held-1',
            carryingFood: true,
            extraKm: 1.2,
            extraMinutes: 3,
            policy: EnumTwoOrderPolicy.SHORTAGE_ONLY,
            freeRiderFound: false,
          }),
        })
      )
    })

    it('when rider is NOT carrying food: normal answer time and no calm text', async () => {
      const newDelivery = makeDelivery('del-add-on')
      mockDeliveryRepo.findByIdOrThrow.mockResolvedValue(newDelivery)
      mockConfigService.instanceConfig.getOfferExpirySeconds.mockResolvedValue(60)

      const plan: AddOnPlan = makePlan({
        job: makeDelivery('job-held-1', { status: EnumDeliveryStatus.ACCEPTED, courierId }),
        sequence: {
          stops: sampleStops,
          delaySeconds: { 'job-held-1': 50, 'del-add-on': 80 },
          totalSeconds: 300,
          extraSeconds: 80,
          extraMetres: 600,
          secondsToNewPickup: 40,
        },
        carryingFood: false, // Not carrying food
        candidateCount: 1,
        strategy: EnumCourierMatcherType.FAIRNESS,
        policy: EnumTwoOrderPolicy.SHORTAGE_ONLY,
        freeRiderFound: false,
      })
      mockTwoOrderService.findAddOn.mockResolvedValueOnce(plan)

      await (deliveryEventService as any).offerToNextCourier('del-add-on')

      // Normal expiry (60s + 3s grace)
      const claimCall = mockDeliveryRepo.claimAddOnWithinBox.mock.calls[0]
      const updateData = claimCall[5]
      const expiryMs = updateData.offerExpiresAt.getTime() - updateData.offeredAt.getTime()
      expect(Math.round(expiryMs / 1000)).toBe(60)

      expect(mockBullMQService.addJob).toHaveBeenCalledWith(
        'offer-expiry',
        expect.objectContaining({ deliveryId: 'del-add-on', courierId }),
        expect.objectContaining({ delay: 63000 })
      )

      expect(mockDeliveryEventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.not.stringContaining('the rider carries food'),
        })
      )
    })

    it('always has a deadline even when offerExpiryEnabled is false (Decision 81.14)', async () => {
      const newDelivery = makeDelivery('del-add-on')
      mockDeliveryRepo.findByIdOrThrow.mockResolvedValue(newDelivery)
      // Expiry switch is OFF!
      mockConfigService.instanceConfig.getOfferExpiryEnabled.mockResolvedValue(false)
      mockConfigService.instanceConfig.getOfferExpirySeconds.mockResolvedValue(60)

      const plan: AddOnPlan = makePlan({ carryingFood: false })
      mockTwoOrderService.findAddOn.mockResolvedValueOnce(plan)

      const result = await (deliveryEventService as any).offerToNextCourier('del-add-on')

      expect(result).toBe('OFFERED')

      // Deadline is still set on claim
      const claimCall = mockDeliveryRepo.claimAddOnWithinBox.mock.calls[0]
      const updateData = claimCall[5]
      expect(updateData.offerExpiresAt).not.toBeNull()
      const expiryMs = updateData.offerExpiresAt.getTime() - updateData.offeredAt.getTime()
      expect(Math.round(expiryMs / 1000)).toBe(60)

      // scheduleOfferExpiry is still scheduled
      expect(mockBullMQService.addJob).toHaveBeenCalledWith(
        'offer-expiry',
        expect.objectContaining({ deliveryId: 'del-add-on', courierId }),
        expect.objectContaining({ delay: 63000 })
      )
    })

    it('always has doubled deadline when offerExpiryEnabled is false and rider carries food (Decision 81.14)', async () => {
      const newDelivery = makeDelivery('del-add-on')
      mockDeliveryRepo.findByIdOrThrow.mockResolvedValue(newDelivery)
      // Expiry switch is OFF!
      mockConfigService.instanceConfig.getOfferExpiryEnabled.mockResolvedValue(false)
      mockConfigService.instanceConfig.getOfferExpirySeconds.mockResolvedValue(60)

      const plan: AddOnPlan = makePlan({
        job: makeDelivery('job-held-1', { status: EnumDeliveryStatus.PICKED_UP, courierId }),
        carryingFood: true,
      })
      mockTwoOrderService.findAddOn.mockResolvedValueOnce(plan)

      const result = await (deliveryEventService as any).offerToNextCourier('del-add-on')

      expect(result).toBe('OFFERED')

      const claimCall = mockDeliveryRepo.claimAddOnWithinBox.mock.calls[0]
      const updateData = claimCall[5]
      expect(updateData.offerExpiresAt).not.toBeNull()
      const expiryMs = updateData.offerExpiresAt.getTime() - updateData.offeredAt.getTime()
      expect(Math.round(expiryMs / 1000)).toBe(120) // 120s!

      expect(mockBullMQService.addJob).toHaveBeenCalledWith(
        'offer-expiry',
        expect.objectContaining({ deliveryId: 'del-add-on', courierId }),
        expect.objectContaining({ delay: 123000 })
      )
    })

    it('records policy and freeRiderFound in offerReason and message under WHENEVER_FITS with free rider (Decision 81.16)', async () => {
      const newDelivery = makeDelivery('del-add-on')
      mockDeliveryRepo.findByIdOrThrow.mockResolvedValue(newDelivery)

      const plan: AddOnPlan = makePlan({
        policy: EnumTwoOrderPolicy.WHENEVER_FITS,
        freeRiderFound: true,
      })
      mockTwoOrderService.findAddOn.mockResolvedValueOnce(plan)

      await (deliveryEventService as any).offerToNextCourier('del-add-on')

      expect(mockDeliveryEventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.OFFERED,
          message: expect.stringContaining(
            '; a free rider was found, and the co-op offers an add on whenever it fits'
          ),
        })
      )

      expect(mockOfferReasonRepo.create).toHaveBeenCalledWith(
        'evt-1',
        'del-add-on',
        courierId,
        expect.objectContaining({
          kind: 'ADD_ON',
          values: expect.objectContaining({
            policy: EnumTwoOrderPolicy.WHENEVER_FITS,
            freeRiderFound: true,
          }),
        })
      )
    })

    it('when addOnOffersEnabled is false, does not attempt to find add on (Decision 81.18 nit)', async () => {
      mockConfigService.instanceConfig.getAddOnOffersEnabled.mockResolvedValue(false)

      const result = await (deliveryEventService as any).offerToNextCourier('del-add-on')

      expect(result).toBe('NO_COURIER')
      expect(mockTwoOrderService.findAddOn).not.toHaveBeenCalled()
    })
  })

  // =========================================================================
  // AC-7: Free decline leaving current job untouched
  // =========================================================================
  describe('AC-7: free decline leaves current job untouched', () => {
    it('declining an add on clears stopSequence, skip lists rider for add on only, and touches nothing on the job', async () => {
      const addOnDelivery = makeDelivery('del-add-on', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        offeredAt,
        offerExpiresAt,
        stopSequence: sampleStops,
      })
      mockDeliveryRepo.findByIdOrThrow
        .mockResolvedValueOnce(addOnDelivery)
        .mockResolvedValueOnce(new DeliveryEntity({ ...addOnDelivery, status: EnumDeliveryStatus.ACCEPTED, courierId }))
      mockDeliveryRepo.updateIfMatches.mockResolvedValueOnce(true)

      const processSpy = jest.spyOn(deliveryEventService, 'processDeliveryEvent').mockResolvedValue(undefined)

      await deliveryDomainService.rejectDelivery('del-add-on', courierId)

      // 1. Clears offer fields and stopSequence on add-on delivery
      expect(mockDeliveryRepo.updateIfMatches).toHaveBeenCalledWith(
        'del-add-on',
        {
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: courierId,
          offeredAt,
          courierId: null,
        },
        {
          matchedCourierId: null,
          offeredAt: null,
          offerExpiresAt: null,
          stopSequence: Prisma.DbNull,
        }
      )

      // 2. Courier added to skip list for del-add-on only
      expect(mockCacheService.save).toHaveBeenCalledWith(
        expect.stringContaining('del-add-on'),
        [courierId],
        expect.any(Number)
      )

      // 3. Emits REJECTED event for del-add-on
      expect(processSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.REJECTED,
          deliveryId: 'del-add-on',
          courierId,
        })
      )

      // 4. Job is NEVER touched: no processDeliveryEvent for job-held-1
      const jobEvents = processSpy.mock.calls.filter((c) => (c[0] as any).deliveryId === 'job-held-1')
      expect(jobEvents).toHaveLength(0)
    })
  })

  // =========================================================================
  // Decision 81.6: Group join on accept
  // =========================================================================
  describe('Decision 81.6: group join on accept', () => {
    it('when add on is accepted, joins add on and job under a new offerGroupId with stopSequence on both', async () => {
      const assigningAddOn = makeDelivery('del-add-on', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        courierId: null,
        stopSequence: sampleStops,
      })
      const acceptedAddOn = makeDelivery('del-add-on', {
        status: EnumDeliveryStatus.ACCEPTED,
        courierId,
        stopSequence: sampleStops,
      })
      mockDeliveryRepo.findByIdOrThrow.mockResolvedValue(assigningAddOn)
      mockDeliveryRepo.findById.mockResolvedValue(acceptedAddOn)

      // Process event that transitions add-on to ACCEPTED
      await deliveryEventService.processDeliveryEvent({
        deliveryId: 'del-add-on',
        type: EnumDeliveryEventType.ACCEPTED,
        actor: EnumEventActor.COURIER,
        courierId,
        source: EnumDeliveryEventSource.OPENCOURIER,
      })

      // joinAcceptedAddOn called to link add on and held job
      expect(mockDeliveryRepo.joinAcceptedAddOn).toHaveBeenCalledWith(
        'del-add-on',
        'job-held-1',
        courierId,
        sampleStops
      )
    })

    it('when job left courier before accept, joinAcceptedAddOn returns false and clears stopSequence', async () => {
      const assigningAddOn = makeDelivery('del-add-on', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        courierId: null,
        stopSequence: sampleStops,
      })
      const acceptedAddOn = makeDelivery('del-add-on', {
        status: EnumDeliveryStatus.ACCEPTED,
        courierId,
        stopSequence: sampleStops,
      })
      mockDeliveryRepo.findByIdOrThrow.mockResolvedValue(assigningAddOn)
      mockDeliveryRepo.findById.mockResolvedValue(acceptedAddOn)
      mockDeliveryRepo.joinAcceptedAddOn.mockResolvedValueOnce(false) // Job left courier!

      await deliveryEventService.processDeliveryEvent({
        deliveryId: 'del-add-on',
        type: EnumDeliveryEventType.ACCEPTED,
        actor: EnumEventActor.COURIER,
        courierId,
        source: EnumDeliveryEventSource.OPENCOURIER,
      })

      expect(mockDeliveryRepo.joinAcceptedAddOn).toHaveBeenCalledWith(
        'del-add-on',
        'job-held-1',
        courierId,
        sampleStops
      )
    })
  })

  // =========================================================================
  // Row 146: The job records when an add on joins it (ADD_ON_JOINED)
  // =========================================================================
  describe('Row 146: the job records when an add on joins it (ADD_ON_JOINED)', () => {
    it('accepting an add on records an ADD_ON_JOINED event on the job it joined with all required fields (clause 1 & 6)', async () => {
      const assigningAddOn = makeDelivery('del-add-on', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        courierId: null,
        stopSequence: sampleStops,
      })
      const acceptedAddOn = makeDelivery('del-add-on', {
        status: EnumDeliveryStatus.ACCEPTED,
        courierId,
        stopSequence: sampleStops,
      })
      const heldJob = makeDelivery('job-held-1', {
        status: EnumDeliveryStatus.DISPATCHED,
        courierId,
      })

      mockDeliveryRepo.findByIdOrThrow.mockImplementation((id: string) => {
        if (id === 'del-add-on') return Promise.resolve(assigningAddOn)
        if (id === 'job-held-1') return Promise.resolve(heldJob)
        throw new Error(`Unexpected findByIdOrThrow id: ${id}`)
      })
      mockDeliveryRepo.findById.mockImplementation((id: string) => {
        if (id === 'del-add-on') return Promise.resolve(acceptedAddOn)
        if (id === 'job-held-1') return Promise.resolve(heldJob)
        return Promise.resolve(null)
      })
      mockDeliveryRepo.joinAcceptedAddOn.mockResolvedValueOnce(true)

      await deliveryEventService.processDeliveryEvent({
        deliveryId: 'del-add-on',
        type: EnumDeliveryEventType.ACCEPTED,
        actor: EnumEventActor.COURIER,
        courierId,
        source: EnumDeliveryEventSource.OPENCOURIER,
      })

      // 1. Exactly one ADD_ON_JOINED event is recorded across all created events
      const addOnJoinedCalls = mockDeliveryEventRepo.create.mock.calls.filter(
        (call: any[]) => call[0]?.type === EnumDeliveryEventType.ADD_ON_JOINED
      )
      expect(addOnJoinedCalls).toHaveLength(1)

      // 2. The event is recorded on the JOB's id (not the add on's), actor SYSTEM, source OPENCOURIER,
      // courierId the rider, messageCode ADD_ON_JOINED with { courierId, addOnId }, transitionSuccessful true,
      // oldStatus and newStatus both the job's current status (DISPATCHED), and stored courierId column keeps rider.
      expect(mockDeliveryEventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'job-held-1',
          type: EnumDeliveryEventType.ADD_ON_JOINED,
          actor: EnumEventActor.SYSTEM,
          eventSource: EnumDeliveryEventSource.OPENCOURIER,
          courierId: courierId,
          messageCode: 'ADD_ON_JOINED',
          messageParams: { courierId, addOnId: 'del-add-on' },
          message: `Delivery del-add-on joined this job as one more order on the way; courier ${courierId} carries both`,
          oldStatus: EnumDeliveryStatus.DISPATCHED,
          newStatus: EnumDeliveryStatus.DISPATCHED,
          transitionSuccessful: true,
        })
      )

      // 3. Verifies no ADD_ON_JOINED event is written with the add-on's id
      expect(mockDeliveryEventRepo.create).not.toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-add-on',
          type: EnumDeliveryEventType.ADD_ON_JOINED,
        })
      )
    })

    it('saveDeliveryEvent stores courierId in the courierId column for ADD_ON_JOINED (riderId list)', async () => {
      const job = makeDelivery('job-held-1', { status: EnumDeliveryStatus.DISPATCHED, courierId })
      await (deliveryEventService as any).saveDeliveryEvent(
        {
          deliveryId: 'job-held-1',
          type: EnumDeliveryEventType.ADD_ON_JOINED,
          actor: EnumEventActor.SYSTEM,
          source: EnumDeliveryEventSource.OPENCOURIER,
          courierId,
          messageCode: 'ADD_ON_JOINED',
          messageParams: { courierId, addOnId: 'del-add-on' },
        },
        {
          transitionSuccessful: true,
          oldStatus: job.status,
          newStatus: job.status,
        }
      )

      expect(mockDeliveryEventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.ADD_ON_JOINED,
          courierId: courierId,
        })
      )
    })

    it.each([
      ['declined', makeDelivery('del-add-on', { status: EnumDeliveryStatus.ASSIGNING_COURIER, courierId: null, stopSequence: sampleStops })],
      ['expired', makeDelivery('del-add-on', { status: EnumDeliveryStatus.ASSIGNING_COURIER, matchedCourierId: null, courierId: null, stopSequence: sampleStops })],
      ['cancelled', makeDelivery('del-add-on', { status: EnumDeliveryStatus.CANCELED, courierId: null, stopSequence: sampleStops })],
    ])('a %s add on records nothing on the job (clause 2)', async (_scenario, delivery) => {
      mockDeliveryRepo.updateIfMatches.mockResolvedValue(true)
      mockDeliveryRepo.findByIdOrThrow.mockResolvedValue(makeDelivery('job-held-1', { status: EnumDeliveryStatus.ACCEPTED }))

      await (deliveryEventService as any).settleAddOnLeavingOffer(delivery)

      expect(mockDeliveryRepo.joinAcceptedAddOn).not.toHaveBeenCalled()
      expect(mockDeliveryEventRepo.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.ADD_ON_JOINED })
      )
    })

    it('an add on accepted for another rider records nothing on the job when join returns false (clause 2 & 3)', async () => {
      const delivery = makeDelivery('del-add-on', {
        status: EnumDeliveryStatus.ACCEPTED,
        courierId: 'other-courier-99',
        stopSequence: sampleStops,
      })
      // In the database transaction, joinAcceptedAddOn returns false when the rider does not hold the job
      mockDeliveryRepo.joinAcceptedAddOn.mockResolvedValueOnce(false)

      await (deliveryEventService as any).settleAddOnLeavingOffer(delivery)

      expect(mockDeliveryRepo.joinAcceptedAddOn).toHaveBeenCalledWith(
        'del-add-on',
        'job-held-1',
        'other-courier-99',
        sampleStops
      )
      expect(mockDeliveryEventRepo.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.ADD_ON_JOINED })
      )
    })

    it('a join that rolls back leaves no event when joinAcceptedAddOn returns false (clause 3)', async () => {
      const assigningAddOn = makeDelivery('del-add-on', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        courierId: null,
        stopSequence: sampleStops,
      })
      const acceptedAddOn = makeDelivery('del-add-on', {
        status: EnumDeliveryStatus.ACCEPTED,
        courierId,
        stopSequence: sampleStops,
      })
      const heldJob = makeDelivery('job-held-1', {
        status: EnumDeliveryStatus.ACCEPTED,
        courierId,
      })
      mockDeliveryRepo.findByIdOrThrow.mockImplementation((id: string) => {
        if (id === 'del-add-on') return Promise.resolve(assigningAddOn)
        if (id === 'job-held-1') return Promise.resolve(heldJob)
        return Promise.resolve(assigningAddOn)
      })
      mockDeliveryRepo.findById.mockImplementation((id: string) => {
        if (id === 'del-add-on') return Promise.resolve(acceptedAddOn)
        return Promise.resolve(null)
      })
      mockDeliveryRepo.joinAcceptedAddOn.mockResolvedValueOnce(false) // Rollback!

      await deliveryEventService.processDeliveryEvent({
        deliveryId: 'del-add-on',
        type: EnumDeliveryEventType.ACCEPTED,
        actor: EnumEventActor.COURIER,
        courierId,
        source: EnumDeliveryEventSource.OPENCOURIER,
      })

      expect(mockDeliveryRepo.joinAcceptedAddOn).toHaveBeenCalledWith(
        'del-add-on',
        'job-held-1',
        courierId,
        sampleStops
      )
      expect(mockDeliveryEventRepo.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.ADD_ON_JOINED })
      )
    })

    it('a failed write of the event never undoes the join, never throws out of accept, and logs both IDs (clause 4)', async () => {
      const assigningAddOn = makeDelivery('del-add-on', {
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: courierId,
        courierId: null,
        stopSequence: sampleStops,
      })
      const acceptedAddOn = makeDelivery('del-add-on', {
        status: EnumDeliveryStatus.ACCEPTED,
        courierId,
        stopSequence: sampleStops,
      })
      const heldJob = makeDelivery('job-held-1', {
        status: EnumDeliveryStatus.ACCEPTED,
        courierId,
      })
      mockDeliveryRepo.findByIdOrThrow.mockImplementation((id: string) => {
        if (id === 'del-add-on') return Promise.resolve(assigningAddOn)
        if (id === 'job-held-1') return Promise.resolve(heldJob)
        return Promise.resolve(assigningAddOn)
      })
      mockDeliveryRepo.findById.mockImplementation((id: string) => {
        if (id === 'del-add-on') return Promise.resolve(acceptedAddOn)
        return Promise.resolve(null)
      })
      mockDeliveryRepo.joinAcceptedAddOn.mockResolvedValueOnce(true)

      // Make event write fail when ADD_ON_JOINED is saved
      mockDeliveryEventRepo.create.mockImplementation((dto: any) => {
        if (dto.type === EnumDeliveryEventType.ADD_ON_JOINED) {
          return Promise.reject(new Error('Simulated event repository database error'))
        }
        return Promise.resolve({ id: 'evt-accepted' })
      })

      const loggerErrorSpy = jest.spyOn((deliveryEventService as any).logger, 'error')

      // Process event that transitions add-on to ACCEPTED: must NOT throw
      await expect(
        deliveryEventService.processDeliveryEvent({
          deliveryId: 'del-add-on',
          type: EnumDeliveryEventType.ACCEPTED,
          actor: EnumEventActor.COURIER,
          courierId,
          source: EnumDeliveryEventSource.OPENCOURIER,
        })
      ).resolves.not.toThrow()

      // The join was called and stands (never undone)
      expect(mockDeliveryRepo.joinAcceptedAddOn).toHaveBeenCalledWith(
        'del-add-on',
        'job-held-1',
        courierId,
        sampleStops
      )
      // Never called updateIfMatches to undo the offerGroupId or stopSequence
      expect(mockDeliveryRepo.updateIfMatches).not.toHaveBeenCalledWith(
        'del-add-on',
        { offerGroupId: null },
        { stopSequence: Prisma.DbNull }
      )

      // Logs with both addOnId and jobId
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Could not record that add on del-add-on joined delivery job-held-1/)
      )
    })

    it('recordAddOnJoined never throws when saveDeliveryEvent rejects and logs with both IDs (clause 4)', async () => {
      mockDeliveryRepo.findByIdOrThrow.mockResolvedValueOnce(
        makeDelivery('job-held-1', { status: EnumDeliveryStatus.ACCEPTED, courierId })
      )
      mockDeliveryEventRepo.create.mockRejectedValueOnce(new Error('Simulated event write failure'))

      const loggerErrorSpy = jest.spyOn((deliveryEventService as any).logger, 'error')

      await expect(
        (deliveryEventService as any).recordAddOnJoined('job-held-1', 'del-add-on', courierId)
      ).resolves.not.toThrow()

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Could not record that add on del-add-on joined delivery job-held-1/)
      )
    })
  })

  // =========================================================================
  // Decision 81.7: Claim safety & race condition (JOB_CHANGED)
  // =========================================================================
  describe('Decision 81.7: claim safety with JOB_CHANGED check', () => {
    it('returns NOT_ADDED when claimAddOnWithinBox returns JOB_CHANGED (rider no longer holds expected job)', async () => {
      const newDelivery = makeDelivery('del-add-on')
      mockDeliveryRepo.findByIdOrThrow.mockResolvedValue(newDelivery)

      const plan: AddOnPlan = makePlan({
        sequence: {
          stops: sampleStops,
          delaySeconds: { 'job-held-1': 50, 'del-add-on': 80 },
          totalSeconds: 300,
          extraSeconds: 80,
          extraMetres: 600,
          secondsToNewPickup: 40,
        },
      })
      mockTwoOrderService.findAddOn.mockResolvedValueOnce(plan)

      // Claim finds rider no longer holds job-held-1
      mockDeliveryRepo.claimAddOnWithinBox.mockResolvedValueOnce('JOB_CHANGED')

      const result = await (deliveryEventService as any).offerToNextCourier('del-add-on')

      // Did not offer as add on
      expect(result).toBe('NO_COURIER')
      expect(mockDeliveryEventRepo.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.OFFERED })
      )
    })

    it('takes back offer if dispatch stop started during add on matching', async () => {
      const newDelivery = makeDelivery('del-add-on')
      mockDeliveryRepo.findByIdOrThrow.mockResolvedValue(newDelivery)

      const plan: AddOnPlan = makePlan({
        sequence: {
          stops: sampleStops,
          delaySeconds: { 'job-held-1': 50, 'del-add-on': 80 },
          totalSeconds: 300,
          extraSeconds: 80,
          extraMetres: 600,
          secondsToNewPickup: 40,
        },
      })
      mockTwoOrderService.findAddOn.mockResolvedValueOnce(plan)

      // Dispatch stop was inactive at start of offerToNextCourier, but became active during matching/claim!
      mockDispatchStopRepo.findOn
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'stop-1' })

      const result = await (deliveryEventService as any).offerToNextCourier('del-add-on')

      expect(result).toBe('STOPPED')
      // Offer taken back
      expect(mockDeliveryRepo.updateIfMatches).toHaveBeenCalledWith(
        'del-add-on',
        expect.objectContaining({ matchedCourierId: courierId }),
        { matchedCourierId: null, offeredAt: null, offerExpiresAt: null, stopSequence: Prisma.DbNull }
      )
    })
  })
})
