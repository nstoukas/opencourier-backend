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
    } as unknown as jest.Mocked<CourierRepository>

    mockDeliveryRepository = {
      findByIdOrThrow: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<DeliveryRepository>

    mockDeliveryEventRepository = {
      create: jest.fn().mockResolvedValue({ id: 'evt-1' } as any),
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
      mockDeliveryCalculationService
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
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValueOnce({
        id: 'del-success',
        status: EnumDeliveryStatus.ON_THE_WAY,
        partnerId: null,
        courierId: null,
      } as any)

      mockDeliveryRepository.update.mockResolvedValueOnce({
        id: 'del-success',
        status: EnumDeliveryStatus.DROPPED_OFF,
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
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValueOnce({
        id: 'del-offer',
        status: EnumDeliveryStatus.CREATED,
        partnerId: 'partner-1',
        courierId: null,
        matchedCourierId: null,
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

      // This flow updates the Delivery three times (matched courier, amounts, status),
      // so mockResolvedValue — not ...Once — or the later calls return undefined.
      mockDeliveryRepository.update.mockResolvedValue({
        id: 'del-offer',
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        partnerId: 'partner-1',
        matchedCourierId: 'courier-1',
      } as any)

      await service.offerDeliveryToCourierAsAdmin('del-offer', 'courier-1', 'Admin offer note')

      // Assert CONFIRMED event is created with oldStatus: CREATED and newStatus: ASSIGNING_COURIER
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledTimes(1)
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
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
    })
  })
})
