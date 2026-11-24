import {
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
  Prisma,
} from '@prisma/types'
import { DeliveryEventService } from './delivery-event.service'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { DeliveryEventEntity } from 'src/domains/delivery-event/entities/delivery-event.entity'
import { DELIVERY_ONGOING_STATUSES } from 'src/shared-types/stateMachine'

// Scope row 149: The job records when its add on leaves (backend half, GA).
// Covers:
// - Clause 1: When an add on leaves a job it joined (cancelled, failed, handed back,
//   reassigned, removed, returned to waiting by dispatch stop), the JOB's trail gets
//   exactly one ADD_ON_LEFT event naming the add on with rider ID, saved with job status
//   as old and new, actor SYSTEM.
// - Clause 2: Nothing is written for a delivery that never joined a job.
// - Clause 3: Nothing twice for one parting (deduplication / idempotency).
// - Clause 4: A test fails if a parting writes nothing on the job.
// - Decision 149.5: Nothing is written when the job already ended or went to another rider.
// - Review fix: Only a move OUT of an ongoing status counts (OFFERED, OFFER_EXPIRED,
//   NO_COURIER_AVAILABLE on former add on waiting again write nothing).
// - Normal DROPPED_OFF of add on writes nothing.
// - recheckAddOnAfterJoin: An add on no longer ongoing right after the join is recorded
//   gets ADD_ON_LEFT.
describe('The job records when its add on leaves (scope row 149, ADD_ON_LEFT)', () => {
  const courierId = 'courier-r149'
  const otherCourierId = 'courier-other-99'
  const jobId = 'job-parent-100'
  const addOnId = 'del-add-on-200'
  const joinCreatedAt = new Date('2026-11-24T12:00:00.000Z')

  let service: DeliveryEventService
  let mockDeliveryRepo: any
  let mockDeliveryEventRepo: any
  let mockRemovalRequestRepo: any
  let mockConfigDomainService: any

  const makeDelivery = (id: string, opts: Partial<DeliveryEntity> = {}): DeliveryEntity =>
    new DeliveryEntity({
      id,
      partnerId: 'partner-kitchen-1',
      pickupLocationId: 'loc-p1',
      dropoffLocationId: `loc-d-${id}`,
      status: EnumDeliveryStatus.ACCEPTED,
      courierId,
      matchedCourierId: null,
      offeredAt: new Date(),
      offerExpiresAt: new Date(),
      offerGroupId: 'group-1',
      boxUnits: 20,
      totalCompensation: 350,
      totalCost: 450,
      fee: 40,
      feePercentage: 10,
      currencyCode: 'EUR',
      ...opts,
    } as any)

  const makeJoinEvent = (overrides: Partial<DeliveryEventEntity> = {}): DeliveryEventEntity =>
    new DeliveryEventEntity({
      id: 'evt-join-1',
      deliveryId: jobId,
      type: EnumDeliveryEventType.ADD_ON_JOINED,
      actor: EnumEventActor.SYSTEM,
      eventSource: EnumDeliveryEventSource.OPENCOURIER,
      courierId,
      oldStatus: EnumDeliveryStatus.ACCEPTED,
      newStatus: EnumDeliveryStatus.ACCEPTED,
      transitionSuccessful: true,
      message: `Delivery ${addOnId} was added to this job as one more order on the way; courier ${courierId} has taken both`,
      messageCode: 'ADD_ON_JOINED',
      messageParams: { courierId, addOnId },
      occurredAt: joinCreatedAt,
      createdAt: joinCreatedAt,
      updatedAt: joinCreatedAt,
      ...overrides,
    } as any)

  beforeEach(() => {
    mockDeliveryRepo = {
      findById: jest.fn().mockImplementation(async (id: string) => {
        if (id === jobId) {
          return makeDelivery(jobId, { status: EnumDeliveryStatus.ACCEPTED, courierId })
        }
        if (id === addOnId) {
          return makeDelivery(addOnId, { status: EnumDeliveryStatus.ACCEPTED, courierId })
        }
        return null
      }),
      findByIdOrThrow: jest.fn(),
      updateIfMatches: jest.fn().mockResolvedValue(true),
      joinAcceptedAddOn: jest.fn().mockResolvedValue(EnumDeliveryStatus.ACCEPTED),
    }

    mockDeliveryEventRepo = {
      create: jest.fn().mockImplementation(async (data: any) => ({ id: 'evt-created-1', ...data })),
      findLatestAddOnJoinOf: jest.fn().mockImplementation(async (id: string) => {
        if (id === addOnId) return makeJoinEvent()
        return null
      }),
      hasAddOnLeftSince: jest.fn().mockResolvedValue(false),
      findLatestOfTypes: jest.fn().mockResolvedValue(null),
      hasSuccessfulEvent: jest.fn().mockResolvedValue(false),
    }

    mockRemovalRequestRepo = {
      closeOpenForDelivery: jest.fn().mockResolvedValue(undefined),
    }

    mockConfigDomainService = {
      instanceConfig: {
        getHandBackSeconds: jest.fn().mockResolvedValue(300),
      },
    }

    const mockTaskBusService = {
      registerTaskHandler: jest.fn(),
    }

    service = new DeliveryEventService(
      {} as any, // configService
      {} as any, // websocketDispatcher
      { clearLocationIfOfflineAndFree: jest.fn().mockResolvedValue(undefined) } as any, // courierRepository
      mockDeliveryRepo,
      mockDeliveryEventRepo,
      {} as any, // taskScheduler
      mockTaskBusService as any,
      { sendDeliveryUpdatePartnerWebhook: jest.fn().mockResolvedValue(undefined) } as any, // partnerWebhookService
      {} as any, // deliveryMatchingService
      {} as any, // deliveryCalculationService
      {} as any, // bullMQService
      mockConfigDomainService,
      {} as any, // cacheService
      {} as any, // offerPushService
      {} as any, // dispatchStopRepository
      {} as any, // osrmRoutingService
      {} as any, // courierCompensationRepository
      { deleteUnbilledSplitLegCharge: jest.fn().mockResolvedValue({ removed: false }) } as any, // partnerChargeRepository
      mockRemovalRequestRepo
    )
  })

  // --------------------------------------------------------------------------
  // Clause 1 & Clause 4: The job records when its add on leaves
  // --------------------------------------------------------------------------
  describe('Clause 1 & 4: Exactly one ADD_ON_LEFT event on the job naming the add on with rider ID', () => {
    test.each([
      ['cancelled', EnumDeliveryEventType.CANCELED, EnumDeliveryStatus.ACCEPTED, EnumDeliveryStatus.CANCELED],
      ['failed', EnumDeliveryEventType.FAILED, EnumDeliveryStatus.ACCEPTED, EnumDeliveryStatus.FAILED],
      [
        'handed back',
        EnumDeliveryEventType.HANDED_BACK,
        EnumDeliveryStatus.DISPATCHED,
        EnumDeliveryStatus.ASSIGNING_COURIER,
      ],
      [
        'reassigned',
        EnumDeliveryEventType.REASSIGNED,
        EnumDeliveryStatus.DISPATCHED,
        EnumDeliveryStatus.ASSIGNING_COURIER,
      ],
      [
        'removed before pickup',
        EnumDeliveryEventType.REMOVAL_APPROVED,
        EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
        EnumDeliveryStatus.ASSIGNING_COURIER,
      ],
      [
        'returned to waiting by dispatch stop',
        EnumDeliveryEventType.RETURNED_TO_WAITING,
        EnumDeliveryStatus.ACCEPTED,
        EnumDeliveryStatus.ASSIGNING_COURIER,
      ],
    ])(
      'when an add on leaves by being %s, records ADD_ON_LEFT on the job with all required fields',
      async (_reason, eventType, oldStatus, newStatus) => {
        // Trigger saveDeliveryEvent representing the add on's transition out of an ongoing status
        await (service as any).saveDeliveryEvent(
          {
            deliveryId: addOnId,
            type: eventType,
            actor: EnumEventActor.SYSTEM,
            source: EnumDeliveryEventSource.OPENCOURIER,
          },
          {
            transitionSuccessful: true,
            oldStatus,
            newStatus,
          }
        )

        // Find the ADD_ON_LEFT call on the deliveryEventRepository.create spy
        const addOnLeftCalls = mockDeliveryEventRepo.create.mock.calls.filter(
          ([arg]: [any]) => arg.type === EnumDeliveryEventType.ADD_ON_LEFT
        )

        // (1) Exactly one ADD_ON_LEFT event written
        expect(addOnLeftCalls).toHaveLength(1)
        const [eventArg] = addOnLeftCalls[0]

        // (1) Written on the JOB's trail
        expect(eventArg.deliveryId).toBe(jobId)

        // (1) Carries rider's id in courierId column (stored on the job's record)
        expect(eventArg.courierId).toBe(courierId)

        // (1) Saved with the job's own status as old and new
        expect(eventArg.oldStatus).toBe(EnumDeliveryStatus.ACCEPTED)
        expect(eventArg.newStatus).toBe(EnumDeliveryStatus.ACCEPTED)
        expect(eventArg.transitionSuccessful).toBe(true)

        // (1) Actor SYSTEM and source OPENCOURIER
        expect(eventArg.actor).toBe(EnumEventActor.SYSTEM)
        expect(eventArg.eventSource).toBe(EnumDeliveryEventSource.OPENCOURIER)

        // (1) Names the add on in messageParams
        expect(eventArg.messageParams).toEqual({ courierId, addOnId })
        expect(eventArg.messageCode).toBe('ADD_ON_LEFT')

        // (1) Rendered English sentence matches exact spec text
        expect(eventArg.message).toBe(
          `Delivery ${addOnId} was taken off this job; courier ${courierId} no longer has it`
        )
      }
    )

    test('Clause 4: A test fails if a parting writes nothing on the job', async () => {
      // Simulate parting
      await (service as any).saveDeliveryEvent(
        {
          deliveryId: addOnId,
          type: EnumDeliveryEventType.CANCELED,
          actor: EnumEventActor.PARTNER,
          source: EnumDeliveryEventSource.OPENCOURIER,
        },
        {
          transitionSuccessful: true,
          oldStatus: EnumDeliveryStatus.ACCEPTED,
          newStatus: EnumDeliveryStatus.CANCELED,
        }
      )

      // Must have called create with ADD_ON_LEFT on the job
      expect(mockDeliveryEventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: jobId,
          type: EnumDeliveryEventType.ADD_ON_LEFT,
          courierId,
          newStatus: EnumDeliveryStatus.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ACCEPTED,
        })
      )
    })
  })

  // --------------------------------------------------------------------------
  // Clause 2: Nothing is written for a delivery that never joined a job
  // --------------------------------------------------------------------------
  describe('Clause 2: Nothing is written for a delivery that never joined a job', () => {
    test('when a non-add-on delivery is cancelled, no ADD_ON_LEFT event is emitted', async () => {
      const independentDeliveryId = 'del-independent-999'
      mockDeliveryEventRepo.findLatestAddOnJoinOf.mockResolvedValueOnce(null)

      await (service as any).saveDeliveryEvent(
        {
          deliveryId: independentDeliveryId,
          type: EnumDeliveryEventType.CANCELED,
          actor: EnumEventActor.ADMIN,
          source: EnumDeliveryEventSource.OPENCOURIER,
        },
        {
          transitionSuccessful: true,
          oldStatus: EnumDeliveryStatus.ACCEPTED,
          newStatus: EnumDeliveryStatus.CANCELED,
        }
      )

      expect(mockDeliveryEventRepo.findLatestAddOnJoinOf).toHaveBeenCalledWith(independentDeliveryId)
      const leftCalls = mockDeliveryEventRepo.create.mock.calls.filter(
        ([arg]: [any]) => arg.type === EnumDeliveryEventType.ADD_ON_LEFT
      )
      expect(leftCalls).toHaveLength(0)
    })

    test('when latest join event has no courierId, writes nothing', async () => {
      mockDeliveryEventRepo.findLatestAddOnJoinOf.mockResolvedValueOnce(makeJoinEvent({ courierId: null as any }))

      await (service as any).saveDeliveryEvent(
        {
          deliveryId: addOnId,
          type: EnumDeliveryEventType.CANCELED,
          actor: EnumEventActor.ADMIN,
          source: EnumDeliveryEventSource.OPENCOURIER,
        },
        {
          transitionSuccessful: true,
          oldStatus: EnumDeliveryStatus.ACCEPTED,
          newStatus: EnumDeliveryStatus.CANCELED,
        }
      )

      const leftCalls = mockDeliveryEventRepo.create.mock.calls.filter(
        ([arg]: [any]) => arg.type === EnumDeliveryEventType.ADD_ON_LEFT
      )
      expect(leftCalls).toHaveLength(0)
    })
  })

  // --------------------------------------------------------------------------
  // Clause 3: Nothing twice for one parting (deduplication)
  // --------------------------------------------------------------------------
  describe('Clause 3: Nothing twice for one parting (e.g. hand back then cancel)', () => {
    test('when hasAddOnLeftSince returns true, does not write a second ADD_ON_LEFT event', async () => {
      // Simulate that an ADD_ON_LEFT event was already recorded for this parting
      mockDeliveryEventRepo.hasAddOnLeftSince.mockResolvedValueOnce(true)

      await (service as any).saveDeliveryEvent(
        {
          deliveryId: addOnId,
          type: EnumDeliveryEventType.CANCELED,
          actor: EnumEventActor.ADMIN,
          source: EnumDeliveryEventSource.OPENCOURIER,
        },
        {
          transitionSuccessful: true,
          oldStatus: EnumDeliveryStatus.ACCEPTED,
          newStatus: EnumDeliveryStatus.CANCELED,
        }
      )

      expect(mockDeliveryEventRepo.hasAddOnLeftSince).toHaveBeenCalledWith(jobId, addOnId, joinCreatedAt)
      const leftCalls = mockDeliveryEventRepo.create.mock.calls.filter(
        ([arg]: [any]) => arg.type === EnumDeliveryEventType.ADD_ON_LEFT
      )
      expect(leftCalls).toHaveLength(0)
    })
  })

  // --------------------------------------------------------------------------
  // Decision 149.5: Job ended or went to another rider before add on left
  // --------------------------------------------------------------------------
  describe('Decision 149.5: Job status and rider checks', () => {
    test.each([EnumDeliveryStatus.DROPPED_OFF, EnumDeliveryStatus.CANCELED, EnumDeliveryStatus.FAILED])(
      'writes nothing when job already ended with status %s before add on left',
      async (jobEndedStatus) => {
        mockDeliveryRepo.findById.mockImplementation(async (id: string) => {
          if (id === jobId) return makeDelivery(jobId, { status: jobEndedStatus, courierId })
          return null
        })

        await (service as any).saveDeliveryEvent(
          {
            deliveryId: addOnId,
            type: EnumDeliveryEventType.CANCELED,
            actor: EnumEventActor.ADMIN,
            source: EnumDeliveryEventSource.OPENCOURIER,
          },
          {
            transitionSuccessful: true,
            oldStatus: EnumDeliveryStatus.ACCEPTED,
            newStatus: EnumDeliveryStatus.CANCELED,
          }
        )

        const leftCalls = mockDeliveryEventRepo.create.mock.calls.filter(
          ([arg]: [any]) => arg.type === EnumDeliveryEventType.ADD_ON_LEFT
        )
        expect(leftCalls).toHaveLength(0)
      }
    )

    test('writes nothing when job was reassigned to another rider before add on left', async () => {
      mockDeliveryRepo.findById.mockImplementation(async (id: string) => {
        if (id === jobId) {
          // Job is held by otherCourierId now, while join was with courierId
          return makeDelivery(jobId, { status: EnumDeliveryStatus.ACCEPTED, courierId: otherCourierId })
        }
        return null
      })

      await (service as any).saveDeliveryEvent(
        {
          deliveryId: addOnId,
          type: EnumDeliveryEventType.CANCELED,
          actor: EnumEventActor.ADMIN,
          source: EnumDeliveryEventSource.OPENCOURIER,
        },
        {
          transitionSuccessful: true,
          oldStatus: EnumDeliveryStatus.ACCEPTED,
          newStatus: EnumDeliveryStatus.CANCELED,
        }
      )

      const leftCalls = mockDeliveryEventRepo.create.mock.calls.filter(
        ([arg]: [any]) => arg.type === EnumDeliveryEventType.ADD_ON_LEFT
      )
      expect(leftCalls).toHaveLength(0)
    })

    test('writes nothing when job is not found in database', async () => {
      mockDeliveryRepo.findById.mockImplementation(async (id: string) => {
        if (id === jobId) return null
        return null
      })

      await (service as any).saveDeliveryEvent(
        {
          deliveryId: addOnId,
          type: EnumDeliveryEventType.CANCELED,
          actor: EnumEventActor.ADMIN,
          source: EnumDeliveryEventSource.OPENCOURIER,
        },
        {
          transitionSuccessful: true,
          oldStatus: EnumDeliveryStatus.ACCEPTED,
          newStatus: EnumDeliveryStatus.CANCELED,
        }
      )

      const leftCalls = mockDeliveryEventRepo.create.mock.calls.filter(
        ([arg]: [any]) => arg.type === EnumDeliveryEventType.ADD_ON_LEFT
      )
      expect(leftCalls).toHaveLength(0)
    })
  })

  // --------------------------------------------------------------------------
  // The Review Fix: Only a move OUT of an ongoing status counts
  // --------------------------------------------------------------------------
  describe('Review fix: Only a move OUT of an ongoing status counts', () => {
    test.each([
      ['OFFERED', EnumDeliveryEventType.OFFERED],
      ['OFFER_EXPIRED', EnumDeliveryEventType.OFFER_EXPIRED],
      ['NO_COURIER_AVAILABLE', EnumDeliveryEventType.NO_COURIER_AVAILABLE],
    ])(
      'events on former add on waiting again (%s) with oldStatus ASSIGNING_COURIER write nothing',
      async (_label, eventType) => {
        await (service as any).saveDeliveryEvent(
          {
            deliveryId: addOnId,
            type: eventType,
            actor: EnumEventActor.SYSTEM,
            source: EnumDeliveryEventSource.OPENCOURIER,
          },
          {
            transitionSuccessful: true,
            oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
            newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          }
        )

        // Must not even query findLatestAddOnJoinOf
        expect(mockDeliveryEventRepo.findLatestAddOnJoinOf).not.toHaveBeenCalled()
        const leftCalls = mockDeliveryEventRepo.create.mock.calls.filter(
          ([arg]: [any]) => arg.type === EnumDeliveryEventType.ADD_ON_LEFT
        )
        expect(leftCalls).toHaveLength(0)
      }
    )

    test('event with undefined oldStatus writes nothing', async () => {
      await (service as any).saveDeliveryEvent(
        {
          deliveryId: addOnId,
          type: EnumDeliveryEventType.CANCELED,
          actor: EnumEventActor.ADMIN,
          source: EnumDeliveryEventSource.OPENCOURIER,
        },
        {
          transitionSuccessful: true,
          oldStatus: undefined,
          newStatus: EnumDeliveryStatus.CANCELED,
        }
      )

      expect(mockDeliveryEventRepo.findLatestAddOnJoinOf).not.toHaveBeenCalled()
    })

    test('event with transitionSuccessful: false writes nothing', async () => {
      await (service as any).saveDeliveryEvent(
        {
          deliveryId: addOnId,
          type: EnumDeliveryEventType.CANCELED,
          actor: EnumEventActor.ADMIN,
          source: EnumDeliveryEventSource.OPENCOURIER,
        },
        {
          transitionSuccessful: false,
          oldStatus: EnumDeliveryStatus.ACCEPTED,
          newStatus: EnumDeliveryStatus.CANCELED,
        }
      )

      expect(mockDeliveryEventRepo.findLatestAddOnJoinOf).not.toHaveBeenCalled()
    })

    test('normal status move between ongoing statuses (e.g. ARRIVED to PICKED_UP) writes nothing', async () => {
      await (service as any).saveDeliveryEvent(
        {
          deliveryId: addOnId,
          type: EnumDeliveryEventType.PICKED_UP,
          actor: EnumEventActor.COURIER,
          source: EnumDeliveryEventSource.OPENCOURIER,
        },
        {
          transitionSuccessful: true,
          oldStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
          newStatus: EnumDeliveryStatus.PICKED_UP,
        }
      )

      expect(mockDeliveryEventRepo.findLatestAddOnJoinOf).not.toHaveBeenCalled()
    })

    test('normal DROPPED_OFF of the add on writes nothing', async () => {
      await (service as any).saveDeliveryEvent(
        {
          deliveryId: addOnId,
          type: EnumDeliveryEventType.DROPPED_OFF,
          actor: EnumEventActor.COURIER,
          source: EnumDeliveryEventSource.OPENCOURIER,
        },
        {
          transitionSuccessful: true,
          oldStatus: EnumDeliveryStatus.ON_THE_WAY,
          newStatus: EnumDeliveryStatus.DROPPED_OFF,
        }
      )

      expect(mockDeliveryEventRepo.findLatestAddOnJoinOf).not.toHaveBeenCalled()
      const leftCalls = mockDeliveryEventRepo.create.mock.calls.filter(
        ([arg]: [any]) => arg.type === EnumDeliveryEventType.ADD_ON_LEFT
      )
      expect(leftCalls).toHaveLength(0)
    })
  })

  // --------------------------------------------------------------------------
  // recheckAddOnAfterJoin: Add on left between join commit and join record
  // --------------------------------------------------------------------------
  describe('recheckAddOnAfterJoin', () => {
    test('records ADD_ON_LEFT if add on is no longer ongoing right after the join', async () => {
      // Simulate add on was cancelled during join race
      mockDeliveryRepo.findById.mockImplementation(async (id: string) => {
        if (id === addOnId) {
          return makeDelivery(addOnId, { status: EnumDeliveryStatus.CANCELED, courierId })
        }
        if (id === jobId) {
          return makeDelivery(jobId, { status: EnumDeliveryStatus.ACCEPTED, courierId })
        }
        return null
      })

      await (service as any).recheckAddOnAfterJoin(addOnId)

      // ADD_ON_LEFT written on the job
      expect(mockDeliveryEventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: jobId,
          type: EnumDeliveryEventType.ADD_ON_LEFT,
          courierId,
          newStatus: EnumDeliveryStatus.ACCEPTED,
          oldStatus: EnumDeliveryStatus.ACCEPTED,
        })
      )
    })

    test('writes nothing if add on is still ongoing after join', async () => {
      mockDeliveryRepo.findById.mockImplementation(async (id: string) => {
        if (id === addOnId) {
          return makeDelivery(addOnId, { status: EnumDeliveryStatus.ACCEPTED, courierId })
        }
        return null
      })

      await (service as any).recheckAddOnAfterJoin(addOnId)

      expect(mockDeliveryEventRepo.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.ADD_ON_LEFT })
      )
    })

    test('writes nothing if add on is DROPPED_OFF after join', async () => {
      mockDeliveryRepo.findById.mockImplementation(async (id: string) => {
        if (id === addOnId) {
          return makeDelivery(addOnId, { status: EnumDeliveryStatus.DROPPED_OFF, courierId })
        }
        return null
      })

      await (service as any).recheckAddOnAfterJoin(addOnId)

      expect(mockDeliveryEventRepo.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.ADD_ON_LEFT })
      )
    })

    test('never throws when repository findById rejects and logs the error', async () => {
      mockDeliveryRepo.findById.mockRejectedValueOnce(new Error('DB connection drop'))
      const loggerSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})

      await expect((service as any).recheckAddOnAfterJoin(addOnId)).resolves.not.toThrow()
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`Could not check add on ${addOnId} again after its join`))
      )
    })
  })

  // --------------------------------------------------------------------------
  // Integration: settleAddOnLeavingOffer calls recheckAddOnAfterJoin
  // --------------------------------------------------------------------------
  describe('settleAddOnLeavingOffer integration', () => {
    test('calls recheckAddOnAfterJoin after recording join in settleAddOnLeavingOffer', async () => {
      const recheckSpy = jest.spyOn(service as any, 'recheckAddOnAfterJoin')

      const stops = [
        { deliveryId: jobId, stop: 'PICKUP' },
        { deliveryId: addOnId, stop: 'PICKUP' },
        { deliveryId: jobId, stop: 'DROPOFF' },
        { deliveryId: addOnId, stop: 'DROPOFF' },
      ]

      const addOnDelivery = makeDelivery(addOnId, {
        status: EnumDeliveryStatus.ACCEPTED,
        courierId,
        stopSequence: stops as any,
      })

      await (service as any).settleAddOnLeavingOffer(addOnDelivery)

      expect(recheckSpy).toHaveBeenCalledWith(addOnId)
    })
  })

  // --------------------------------------------------------------------------
  // Resilience in saveDeliveryEvent
  // --------------------------------------------------------------------------
  describe('Resilience in saveDeliveryEvent', () => {
    test('failure in recordAddOnLeftIfJoined is logged and never breaks original event saving', async () => {
      mockDeliveryEventRepo.findLatestAddOnJoinOf.mockRejectedValueOnce(new Error('Prisma error on join lookup'))
      const loggerSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})

      const result = await (service as any).saveDeliveryEvent(
        {
          deliveryId: addOnId,
          type: EnumDeliveryEventType.CANCELED,
          actor: EnumEventActor.ADMIN,
          source: EnumDeliveryEventSource.OPENCOURIER,
        },
        {
          transitionSuccessful: true,
          oldStatus: EnumDeliveryStatus.ACCEPTED,
          newStatus: EnumDeliveryStatus.CANCELED,
        }
      )

      // The original event save still returns the created record
      expect(result).toBeDefined()
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`Could not record that delivery ${addOnId} left its job`))
      )
    })

    test('saveDeliveryEvent stores courierId in the courierId column for ADD_ON_LEFT (riderId list)', async () => {
      const job = makeDelivery(jobId, { status: EnumDeliveryStatus.ACCEPTED, courierId })

      await (service as any).saveDeliveryEvent(
        {
          deliveryId: jobId,
          type: EnumDeliveryEventType.ADD_ON_LEFT,
          actor: EnumEventActor.SYSTEM,
          source: EnumDeliveryEventSource.OPENCOURIER,
          courierId,
          messageCode: 'ADD_ON_LEFT',
          messageParams: { courierId, addOnId },
        },
        {
          transitionSuccessful: true,
          oldStatus: job.status,
          newStatus: job.status,
        }
      )

      expect(mockDeliveryEventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.ADD_ON_LEFT,
          courierId,
        })
      )
    })
  })
})
