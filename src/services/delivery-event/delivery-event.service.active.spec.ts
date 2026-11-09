import { ConfigService } from '@nestjs/config'
import {
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
} from '@prisma/types'
import { DeliveryEventService } from './delivery-event.service'
import { WebsocketDispatcher } from '../websocket/models/WebsocketDispatcher'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { DeliveryEventRepository } from 'src/persistence/repositories/delivery-event.repository'
import { TaskBusScheduler } from '../taskBus/models/TaskBusScheduler'
import { TaskBusService } from '../taskBus/taskBus.service'
import { PartnerWebhookService } from '../partner-webhooks/partner-webhooks.service'
import { DeliveryMatchingService } from '../delivery-matching/delivery-matching.service'
import { DeliveryCalculationService } from '../delivery-calculation/delivery-calculation.service'
import { DeliveryDispatchedEvent, DeliveryDroppedOffEvent, DeliveryEvent } from 'src/shared-types'
import { BullMQService } from 'src/integrations/bullMQ/bullMQ.service'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { CacheService } from '../cache/cache.service'
import { OfferPushService } from '../pushNotification/offer-push.service'
import { TAP_AGE_WORTH_A_LOOK_MS } from 'src/domains/delivery-event/utils/occurred-at.util'
import { CantUpdateDeliveryStatusError } from 'src/errors'
import { SOS_SENTENCES } from 'src/domains/sos/sos-incident-state'

describe('DeliveryEventService', () => {
  let service: DeliveryEventService

  // Mocks for all 10 constructor dependencies
  let mockConfigService: jest.Mocked<ConfigService>
  let mockWebsocketDispatcher: jest.Mocked<WebsocketDispatcher>
  let mockCourierRepository: jest.Mocked<CourierRepository>
  let mockDeliveryRepository: jest.Mocked<DeliveryRepository>
  let mockDeliveryEventRepository: jest.Mocked<DeliveryEventRepository>
  let mockTaskScheduler: jest.Mocked<TaskBusScheduler>
  let mockTaskBusService: jest.Mocked<TaskBusService>
  let mockPartnerWebhookService: jest.Mocked<PartnerWebhookService>
  let mockDeliveryMatchingService: jest.Mocked<DeliveryMatchingService>
  let mockDeliveryCalculationService: jest.Mocked<DeliveryCalculationService>

  beforeEach(() => {
    // Instantiate plain-object mocks with jest.fn() for all dependencies
    mockConfigService = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>

    mockWebsocketDispatcher = {
      sendOfferToCourier: jest.fn().mockResolvedValue(undefined),
      dispatchDeliveryStatusUpdated: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<WebsocketDispatcher>

    mockCourierRepository = {
      findByIdOrThrow: jest.fn(),
      updateById: jest.fn().mockResolvedValue({} as any),
      hasActiveSos: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<CourierRepository>

    mockDeliveryRepository = {
      findByIdOrThrow: jest.fn(),
      update: jest.fn().mockResolvedValue({ id: 'del-1', partnerId: null, courierId: null } as any),
      updateIfMatches: jest.fn().mockResolvedValue(true),
      findIdsWaitingForCourierOldestFirst: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<DeliveryRepository>

    mockDeliveryEventRepository = {
      create: jest.fn().mockResolvedValue({ id: 'evt-1' } as any),
      findLatestJobStepOccurredAt: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<DeliveryEventRepository>

    mockTaskScheduler = {
      scheduleTask: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<TaskBusScheduler>

    mockTaskBusService = {
      registerTaskHandler: jest.fn(),
    } as unknown as jest.Mocked<TaskBusService>

    mockPartnerWebhookService = {
      sendDeliveryUpdatePartnerWebhook: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<PartnerWebhookService>

    mockDeliveryMatchingService = {
      matchDeliveryToCourier: jest.fn(),
    } as unknown as jest.Mocked<DeliveryMatchingService>

    mockDeliveryCalculationService = {
      calculateDeliveryAmountsForMatchedCourier: jest.fn(),
    } as unknown as jest.Mocked<DeliveryCalculationService>

    service = new DeliveryEventService(
      mockConfigService,
      mockWebsocketDispatcher,
      mockCourierRepository,
      mockDeliveryRepository,
      mockDeliveryEventRepository,
      mockTaskScheduler,
      mockTaskBusService,
      mockPartnerWebhookService,
      mockDeliveryMatchingService,
      mockDeliveryCalculationService,
      // Spec 0002 added three dependencies (job timers, settings, skip list).
      { addJob: jest.fn(), removeDelayedJobsWithIdPrefix: jest.fn() } as unknown as BullMQService,
      {
        instanceConfig: {
          getOfferExpiryEnabled: jest.fn().mockResolvedValue(false),
          getOfferTimingEnabled: jest.fn().mockResolvedValue(false),
          getOfferExpirySeconds: jest.fn().mockResolvedValue(60),
          getNoCourierRetrySeconds: jest.fn().mockResolvedValue(30),
        },
      } as unknown as ConfigDomainService,
      { getOrDefault: jest.fn().mockResolvedValue([]), save: jest.fn() } as unknown as CacheService,
      // Spec 0003 added the offer push service; push is not under test here.
      { newOffer: jest.fn(), offerEnded: jest.fn() } as unknown as OfferPushService,
      // No dispatch stop is on in these tests (spec 0014).
      { findOn: jest.fn().mockResolvedValue(null) } as any,
      { getRoute: jest.fn() } as any,
      {} as any,
      {} as any
    )
  })

  describe('processDeliveryEvent', () => {
    // Test Plan Case 1: Failure path records the statuses the right way round (the regression test)
    test('records oldStatus and newStatus in correct order when delivery status transition fails', async () => {
      // Setup delivery sitting in ASSIGNING_COURIER with no assigned courierId
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValueOnce({
        id: 'del-1',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId: null,
      } as any)

      // Event attempting transition to DISPATCHED
      const dispatchedEvent: DeliveryDispatchedEvent = {
        deliveryId: 'del-1',
        type: EnumDeliveryEventType.DISPATCHED,
        actor: EnumEventActor.ADMIN,
        source: EnumDeliveryEventSource.OPENCOURIER,
        message: 'Attempting dispatch without courier',
      }

      await service.processDeliveryEvent(dispatchedEvent)

      // Assert deliveryEventRepository.create received oldStatus: ASSIGNING_COURIER, newStatus: DISPATCHED
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledTimes(1)
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          newStatus: EnumDeliveryStatus.DISPATCHED,
          transitionSuccessful: false,
        })
      )
    })

    // Test Plan Case 2: The failure row carries error message and event's own fields
    test('stores thrown error message and original event metadata on failed delivery event creation', async () => {
      // Setup delivery in ASSIGNING_COURIER without courierId
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValueOnce({
        id: 'del-123',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId: null,
      } as any)

      const dispatchedEvent: DeliveryDispatchedEvent = {
        deliveryId: 'del-123',
        type: EnumDeliveryEventType.DISPATCHED,
        actor: EnumEventActor.PARTNER,
        source: EnumDeliveryEventSource.OPENCOURIER,
        message: 'Original dispatch attempt',
      }

      await service.processDeliveryEvent(dispatchedEvent)

      // Assert all event fields and the thrown error message are preserved
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledTimes(1)
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith({
        deliveryId: 'del-123',
        type: EnumDeliveryEventType.DISPATCHED,
        actor: EnumEventActor.PARTNER,
        eventSource: EnumDeliveryEventSource.OPENCOURIER,
        message: 'Courier ID is required for dispatching', // Message from thrown NotFoundException
        oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
        newStatus: EnumDeliveryStatus.DISPATCHED,
        transitionSuccessful: false,
      })
    })

    // Test Plan Case 3: A Delivery that cannot be loaded writes null statuses, not invented ones
    test('stores null oldStatus and newStatus when delivery record cannot be loaded', async () => {
      // Simulate Prisma / repository record-not-found error
      const notFoundErr = Object.assign(new Error('Record not found'), { name: 'NotFoundError' })
      mockDeliveryRepository.findByIdOrThrow.mockRejectedValueOnce(notFoundErr)

      const dispatchedEvent: DeliveryDispatchedEvent = {
        deliveryId: 'del-missing',
        type: EnumDeliveryEventType.DISPATCHED,
        actor: EnumEventActor.ADMIN,
        source: EnumDeliveryEventSource.OPENCOURIER,
      }

      await service.processDeliveryEvent(dispatchedEvent)

      // Assert statuses are null rather than arbitrary fallbacks
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledTimes(1)
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-missing',
          oldStatus: null,
          newStatus: null,
          transitionSuccessful: false,
          message: 'Delivery with ID del-missing does not exist',
        })
      )
    })

    // Test Plan Case 4: Success path is pinned so a future edit cannot swap that one instead
    test('records oldStatus and newStatus correctly on successful status transition', async () => {
      // Setup delivery in ON_THE_WAY status with no partnerId/courierId (avoids notification side-effects)
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: 'del-success',
        status: EnumDeliveryStatus.ON_THE_WAY,
        partnerId: null,
        courierId: null,
      } as any)

      const droppedOffEvent: DeliveryDroppedOffEvent = {
        deliveryId: 'del-success',
        type: EnumDeliveryEventType.DROPPED_OFF,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
        deliveredData: {}, // required by the type; the proof-of-delivery image is irrelevant here
      }

      await service.processDeliveryEvent(droppedOffEvent)

      // Assert status was updated conditionally (decision 32.17)
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        'del-success',
        { status: EnumDeliveryStatus.ON_THE_WAY },
        expect.objectContaining({
          status: EnumDeliveryStatus.DROPPED_OFF,
        })
      )

      // Assert event was saved with transitionSuccessful: true and correct oldStatus -> newStatus
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledTimes(1)
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-success',
          oldStatus: EnumDeliveryStatus.ON_THE_WAY,
          newStatus: EnumDeliveryStatus.DROPPED_OFF,
          transitionSuccessful: true,
        })
      )
    })

    // Test Plan Case 6: A silently-dropped event still writes nothing
    test('does not save event or update delivery when state machine defines no valid transition', async () => {
      // Terminal status DROPPED_OFF has no transition defined for ACCEPTED
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValueOnce({
        id: 'del-terminal',
        status: EnumDeliveryStatus.DROPPED_OFF,
      } as any)

      const invalidEvent: DeliveryEvent = {
        deliveryId: 'del-terminal',
        type: EnumDeliveryEventType.ACCEPTED,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
      }

      await service.processDeliveryEvent(invalidEvent)

      // No event created and no delivery update attempted
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalled()
      expect(mockDeliveryRepository.update).not.toHaveBeenCalled()
    })
  })

  describe('offerDeliveryToCourierAsAdmin', () => {
    // Test Plan Case 5: The admin offer audit row is unchanged
    test('records CREATED as oldStatus and ASSIGNING_COURIER as newStatus on admin offer audit event', async () => {
      // Setup delivery in CREATED status
      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce({
          id: 'del-offer',
          status: EnumDeliveryStatus.CREATED,
          partnerId: 'partner-1',
          courierId: null,
          matchedCourierId: null,
          offeredAt: null,
        } as any)
        .mockResolvedValueOnce({
          id: 'del-offer',
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          partnerId: 'partner-1',
          courierId: null,
          matchedCourierId: 'courier-1',
          offeredAt: new Date(),
          offerExpiresAt: null,
        } as any)

      mockCourierRepository.findByIdOrThrow.mockResolvedValueOnce({
        id: 'courier-1',
        userId: 'user-courier-1',
      } as any)

      mockDeliveryCalculationService.calculateDeliveryAmountsForMatchedCourier.mockResolvedValueOnce({
        totalCost: 1000,
        totalCompensation: 800,
        fee: 200,
        feePercentage: 20,
      } as any)

      // Admin offer uses conditional updateIfMatches (row 61 review)
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(true)

      await service.offerDeliveryToCourierAsAdmin('del-offer', 'courier-1', 'Admin offer note')

      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        'del-offer',
        expect.objectContaining({
          status: EnumDeliveryStatus.CREATED,
          courierId: null,
          matchedCourierId: null,
        }),
        expect.objectContaining({
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: 'courier-1',
          offerExpiresAt: null,
        })
      )

      // Assert CONFIRMED and OFFERED events are created (spec 0002: admin offer writes CONFIRMED and OFFERED)
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledTimes(2)
      expect(mockDeliveryEventRepository.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          deliveryId: 'del-offer',
          type: EnumDeliveryEventType.CONFIRMED,
          actor: EnumEventActor.ADMIN,
          eventSource: EnumDeliveryEventSource.OPENCOURIER, // the column is eventSource; the event field is source
          oldStatus: EnumDeliveryStatus.CREATED,
          newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          transitionSuccessful: true,
          message: 'Admin offered delivery to courier courier-1: Admin offer note',
        })
      )
      expect(mockDeliveryEventRepository.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          deliveryId: 'del-offer',
          type: EnumDeliveryEventType.OFFERED,
          actor: EnumEventActor.ADMIN,
          courierId: 'courier-1',
          eventSource: EnumDeliveryEventSource.OPENCOURIER,
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          transitionSuccessful: true,
          message: 'Offered to courier courier-1, no deadline',
        })
      )
    })
  })

  describe('occurredAtForCourierTap (Spec 0009, AC-7)', () => {
    test('returns receivedAt minus tapAgeMs without clamping when tap age is within bounds', async () => {
      const deliveryCreatedAt = new Date('2026-10-31T10:00:00.000Z')
      const delivery = { id: 'del-tap-unclamped', createdAt: deliveryCreatedAt }
      const receivedAt = new Date('2026-10-31T12:00:00.000Z')
      const tapAgeMs = 15 * 60 * 1000 // 15 mins
      const tap = { receivedAt, tapAgeMs }

      // Latest job step happened at 11:00 (well before tap time 11:45)
      const latestJobStepTime = new Date('2026-10-31T11:00:00.000Z')
      mockDeliveryEventRepository.findLatestJobStepOccurredAt.mockResolvedValue(latestJobStepTime)

      const result = await service.occurredAtForCourierTap(delivery, tap)

      // 12:00 minus 15 mins = 11:45. Floor is 11:00. No clamping!
      const expected = new Date('2026-10-31T11:45:00.000Z')
      expect(result).toEqual(expected)
      expect(result.getTime()).toBe(receivedAt.getTime() - tapAgeMs)
    })

    test('uses latest successful job step occurredAt as floor when present', async () => {
      const delivery = { id: 'del-tap-1', createdAt: new Date('2026-10-31T10:00:00.000Z') }
      const tap = {
        receivedAt: new Date('2026-10-31T12:00:00.000Z'),
        tapAgeMs: 30 * 60 * 1000, // 30 mins ago = 11:30
      }
      // Latest job step happened at 11:45
      const latestJobStepTime = new Date('2026-10-31T11:45:00.000Z')
      mockDeliveryEventRepository.findLatestJobStepOccurredAt.mockResolvedValue(latestJobStepTime)

      const result = await service.occurredAtForCourierTap(delivery, tap)

      expect(mockDeliveryEventRepository.findLatestJobStepOccurredAt).toHaveBeenCalledWith('del-tap-1')
      // Floor (11:45) is later than tapped (11:30), so clamped to floor
      expect(result).toEqual(latestJobStepTime)
    })

    test('falls back to delivery.createdAt as floor when no successful job step event exists', async () => {
      const deliveryCreatedAt = new Date('2026-10-31T11:45:00.000Z')
      const delivery = { id: 'del-tap-2', createdAt: deliveryCreatedAt }
      const tap = {
        receivedAt: new Date('2026-10-31T12:00:00.000Z'),
        tapAgeMs: 30 * 60 * 1000, // 30 mins ago = 11:30
      }
      mockDeliveryEventRepository.findLatestJobStepOccurredAt.mockResolvedValue(null)

      const result = await service.occurredAtForCourierTap(delivery, tap)

      expect(mockDeliveryEventRepository.findLatestJobStepOccurredAt).toHaveBeenCalledWith('del-tap-2')
      // Falls back to createdAt as floor (11:45), clamping 11:30 up to 11:45
      expect(result).toEqual(deliveryCreatedAt)
    })

    test('logs a warning when tapAgeMs is above one hour (TAP_AGE_WORTH_A_LOOK_MS), holding delivery id and no personal data', async () => {
      const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {})
      const delivery = { id: 'del-tap-warn', createdAt: new Date('2026-10-31T10:00:00.000Z') }
      mockDeliveryEventRepository.findLatestJobStepOccurredAt.mockResolvedValue(null)

      // 65 minutes > TAP_AGE_WORTH_A_LOOK_MS (60 minutes)
      const tap = {
        receivedAt: new Date('2026-10-31T12:00:00.000Z'),
        tapAgeMs: 65 * 60 * 1000,
      }

      await service.occurredAtForCourierTap(delivery, tap)

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Delivery del-tap-warn: a rider\'s step arrived 65 min after its tap')
      )
      const logMessage = warnSpy.mock.calls[0]?.[0] as string
      // Confirm message holds delivery id and no personal data
      expect(logMessage).toContain('del-tap-warn')
      expect(logMessage).not.toMatch(/name|phone|email|address|street|note/i)
      warnSpy.mockRestore()
    })

    test('does not log a warning when tapAgeMs is at or below one hour (TAP_AGE_WORTH_A_LOOK_MS)', async () => {
      const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {})
      const delivery = { id: 'del-tap-nowarn', createdAt: new Date('2026-10-31T10:00:00.000Z') }
      mockDeliveryEventRepository.findLatestJobStepOccurredAt.mockResolvedValue(null)

      // Exactly 60 minutes (= TAP_AGE_WORTH_A_LOOK_MS)
      await service.occurredAtForCourierTap(delivery, {
        receivedAt: new Date('2026-10-31T12:00:00.000Z'),
        tapAgeMs: TAP_AGE_WORTH_A_LOOK_MS,
      })

      // 30 minutes (< TAP_AGE_WORTH_A_LOOK_MS)
      await service.occurredAtForCourierTap(delivery, {
        receivedAt: new Date('2026-10-31T12:00:00.000Z'),
        tapAgeMs: 30 * 60 * 1000,
      })

      expect(warnSpy).not.toHaveBeenCalled()
      warnSpy.mockRestore()
    })
  })

  describe('Late step with no legal transition (Spec 0009, Decision 20.13)', () => {
    test('event carrying occurredAt with no legal transition saves a failed row and performs no other side effects', async () => {
      // Delivery was cancelled by admin meanwhile
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: 'del-cancelled',
        status: EnumDeliveryStatus.CANCELED,
        courierId: 'courier-1',
        partnerId: null,
      } as any)

      const tapTime = new Date('2026-10-31T11:55:00.000Z')
      const event: DeliveryDroppedOffEvent = {
        deliveryId: 'del-cancelled',
        type: EnumDeliveryEventType.DROPPED_OFF,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
        occurredAt: tapTime,
        deliveredData: {},
      }

      await service.processDeliveryEvent(event)

      // Saved as failed row with transitionSuccessful: false, oldStatus: CANCELED, same occurredAt
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledTimes(1)
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-cancelled',
          type: EnumDeliveryEventType.DROPPED_OFF,
          occurredAt: tapTime,
          transitionSuccessful: false,
          oldStatus: EnumDeliveryStatus.CANCELED,
          message: expect.stringContaining('No transition from CANCELED via DROPPED_OFF'),
        })
      )

      // Nothing else happens: no status update, no webhook, no websocket dispatch
      expect(mockDeliveryRepository.update).not.toHaveBeenCalled()
      expect(mockWebsocketDispatcher.dispatchDeliveryStatusUpdated).not.toHaveBeenCalled()
      expect(mockPartnerWebhookService.sendDeliveryUpdatePartnerWebhook).not.toHaveBeenCalled()
    })

    test('same event WITHOUT occurredAt with no legal transition is dropped with no row saved', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: 'del-cancelled-notap',
        status: EnumDeliveryStatus.CANCELED,
        courierId: 'courier-1',
        partnerId: null,
      } as any)

      const event: DeliveryDroppedOffEvent = {
        deliveryId: 'del-cancelled-notap',
        type: EnumDeliveryEventType.DROPPED_OFF,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
        deliveredData: {},
      }

      await service.processDeliveryEvent(event)

      // Event is silently dropped with no row saved
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalled()
      expect(mockDeliveryRepository.update).not.toHaveBeenCalled()
      expect(mockWebsocketDispatcher.dispatchDeliveryStatusUpdated).not.toHaveBeenCalled()
      expect(mockPartnerWebhookService.sendDeliveryUpdatePartnerWebhook).not.toHaveBeenCalled()
    })
  })

  describe('saveDeliveryEvent writes occurredAt on success and failure rows (Spec 0009, AC-4, AC-7, AC-9)', () => {
    test('writes occurredAt to repository create call on successful transition when present', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: 'del-success',
        status: EnumDeliveryStatus.ACCEPTED,
        courierId: 'courier-1',
        partnerId: null,
      } as any)

      const tapTime = new Date('2026-10-31T11:58:00.000Z')
      const event: DeliveryDispatchedEvent = {
        deliveryId: 'del-success',
        type: EnumDeliveryEventType.DISPATCHED,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
        occurredAt: tapTime,
      }

      await service.processDeliveryEvent(event)

      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-success',
          type: EnumDeliveryEventType.DISPATCHED,
          occurredAt: tapTime,
          transitionSuccessful: true,
        })
      )
    })

    test('leaves occurredAt out of repository create call when event has none', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: 'del-no-tap',
        status: EnumDeliveryStatus.ACCEPTED,
        courierId: 'courier-1',
        partnerId: null,
      } as any)

      const event: DeliveryDispatchedEvent = {
        deliveryId: 'del-no-tap',
        type: EnumDeliveryEventType.DISPATCHED,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
      }

      await service.processDeliveryEvent(event)

      const createCall = mockDeliveryEventRepository.create.mock.calls[0]?.[0]
      expect(createCall).toBeDefined()
      expect(createCall?.occurredAt).toBeUndefined()
    })

    test('writes occurredAt to repository create call on failed (catch) transition row when present', async () => {
      // Transition from ASSIGNING_COURIER to DISPATCHED without courierId throws NotFoundException, hitting catch block
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: 'del-failed',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId: null,
        partnerId: null,
      } as any)

      const tapTime = new Date('2026-10-31T11:58:00.000Z')
      const event: DeliveryDispatchedEvent = {
        deliveryId: 'del-failed',
        type: EnumDeliveryEventType.DISPATCHED,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
        occurredAt: tapTime,
      }

      await service.processDeliveryEvent(event)

      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-failed',
          type: EnumDeliveryEventType.DISPATCHED,
          occurredAt: tapTime,
          transitionSuccessful: false,
        })
      )
    })
  })

  describe('pickupReadyAt and dropoffReadyAt use occurredAt (Spec 0009, AC-12)', () => {
    test('at PICKED_UP, pickupReadyAt is event occurredAt when present', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: 'del-pickup',
        status: EnumDeliveryStatus.DISPATCHED,
        courierId: 'courier-1',
        partnerId: null,
      } as any)

      const tapTime = new Date('2026-10-31T11:50:00.000Z')
      const event: DeliveryEvent = {
        deliveryId: 'del-pickup',
        type: EnumDeliveryEventType.PICKED_UP,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
        occurredAt: tapTime,
      }

      await service.processDeliveryEvent(event)

      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        'del-pickup',
        { status: EnumDeliveryStatus.DISPATCHED },
        expect.objectContaining({
          status: EnumDeliveryStatus.PICKED_UP,
          pickupReadyAt: tapTime,
        })
      )
    })

    test('at PICKED_UP without occurredAt, pickupReadyAt falls back to current time', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: 'del-pickup-now',
        status: EnumDeliveryStatus.DISPATCHED,
        courierId: 'courier-1',
        partnerId: null,
      } as any)

      const before = Date.now()
      const event: DeliveryEvent = {
        deliveryId: 'del-pickup-now',
        type: EnumDeliveryEventType.PICKED_UP,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
      }

      await service.processDeliveryEvent(event)

      const updateCall = mockDeliveryRepository.updateIfMatches.mock.calls.find(
        (call: any) => call[0] === 'del-pickup-now' && (call[2] as any)?.status === EnumDeliveryStatus.PICKED_UP
      )
      expect(updateCall).toBeDefined()
      const pickupReadyAt = (updateCall?.[2] as any)?.pickupReadyAt as Date
      expect(pickupReadyAt).toBeInstanceOf(Date)
      expect(pickupReadyAt.getTime()).toBeGreaterThanOrEqual(before)
      expect(pickupReadyAt.getTime()).toBeLessThanOrEqual(Date.now())
    })

    test('at DROPPED_OFF, dropoffReadyAt is event occurredAt when present', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: 'del-dropoff',
        status: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
        courierId: 'courier-1',
        partnerId: null,
      } as any)

      const tapTime = new Date('2026-10-31T11:55:00.000Z')
      const event: DeliveryDroppedOffEvent = {
        deliveryId: 'del-dropoff',
        type: EnumDeliveryEventType.DROPPED_OFF,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
        occurredAt: tapTime,
        deliveredData: {},
      }

      await service.processDeliveryEvent(event)

      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        'del-dropoff',
        { status: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION },
        expect.objectContaining({
          status: EnumDeliveryStatus.DROPPED_OFF,
          dropoffReadyAt: tapTime,
        })
      )
    })

    test('at DROPPED_OFF without occurredAt, dropoffReadyAt falls back to current time', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        id: 'del-dropoff-now',
        status: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
        courierId: 'courier-1',
        partnerId: null,
      } as any)

      const before = Date.now()
      const event: DeliveryDroppedOffEvent = {
        deliveryId: 'del-dropoff-now',
        type: EnumDeliveryEventType.DROPPED_OFF,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
        deliveredData: {},
      }

      await service.processDeliveryEvent(event)

      const updateCall = mockDeliveryRepository.updateIfMatches.mock.calls.find(
        (call: any) => call[0] === 'del-dropoff-now' && (call[2] as any)?.status === EnumDeliveryStatus.DROPPED_OFF
      )
      expect(updateCall).toBeDefined()
      const dropoffReadyAt = (updateCall?.[2] as any)?.dropoffReadyAt as Date
      expect(dropoffReadyAt).toBeInstanceOf(Date)
      expect(dropoffReadyAt.getTime()).toBeGreaterThanOrEqual(before)
      expect(dropoffReadyAt.getTime()).toBeLessThanOrEqual(Date.now())
    })
  })

  describe('recordDropoffPointCorrectedEvent and saveDeliveryEvent courierId (Spec 0016 AC-9, AC-11)', () => {
    test('writes courierId for DROPOFF_POINT_CORRECTED event and keeps oldStatus = newStatus = current status', async () => {
      const deliveryId = 'del-dropoff-corr-1'
      const courierId = 'courier-r31-1'
      const status = EnumDeliveryStatus.PICKED_UP

      await service.recordDropoffPointCorrectedEvent(
        {
          deliveryId,
          type: EnumDeliveryEventType.DROPOFF_POINT_CORRECTED,
          actor: EnumEventActor.COURIER,
          source: EnumDeliveryEventSource.OPENCOURIER,
          courierId,
          message:
            'Drop off pin moved 141 m by the rider, from 39.36400, 22.94800 to 39.36500, 22.94900; saved customer updated',
        },
        status
      )

      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          type: EnumDeliveryEventType.DROPOFF_POINT_CORRECTED,
          actor: EnumEventActor.COURIER,
          eventSource: EnumDeliveryEventSource.OPENCOURIER,
          courierId: 'courier-r31-1',
          transitionSuccessful: true,
          oldStatus: EnumDeliveryStatus.PICKED_UP,
          newStatus: EnumDeliveryStatus.PICKED_UP,
          message:
            'Drop off pin moved 141 m by the rider, from 39.36400, 22.94800 to 39.36500, 22.94900; saved customer updated',
        })
      )
    })
  })

  describe('refuseIfCourierInSos (Pin 7, Spec 0022 AC-7)', () => {
    test('throws CantUpdateDeliveryStatusError (409) with fixed sentence when courier has an active SOS', async () => {
      mockCourierRepository.hasActiveSos.mockResolvedValueOnce(true)

      await expect(service.refuseIfCourierInSos('courier-sos-1')).rejects.toThrow(
        new CantUpdateDeliveryStatusError(SOS_SENTENCES.courierInSos)
      )
      expect(mockCourierRepository.hasActiveSos).toHaveBeenCalledWith('courier-sos-1')
    })

    test('resolves without error when courier has no active SOS', async () => {
      mockCourierRepository.hasActiveSos.mockResolvedValueOnce(false)

      await expect(service.refuseIfCourierInSos('courier-free-1')).resolves.toBeUndefined()
      expect(mockCourierRepository.hasActiveSos).toHaveBeenCalledWith('courier-free-1')
    })
  })
})
