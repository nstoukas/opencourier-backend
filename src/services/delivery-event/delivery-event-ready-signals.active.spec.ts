import { ConfigService } from '@nestjs/config'
import { EnumDeliveryEventSource, EnumDeliveryEventType, EnumDeliveryStatus, EnumEventActor } from '@prisma/types'
import { DeliveryEventService } from './delivery-event.service'
import { WebsocketDispatcher } from '../websocket/models/WebsocketDispatcher'
import { OfferPushService } from '../pushNotification/offer-push.service'
import { TaskBusScheduler } from '../taskBus/models/TaskBusScheduler'
import { TaskBusService } from '../taskBus/taskBus.service'
import { PartnerWebhookService } from '../partner-webhooks/partner-webhooks.service'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'

// Spec 0023: the restaurant's delay and food ready are recorded outside the state machine
// (recordReadyEvent), and the rider holding the job is told over the live connection and by push
// (notifyReadyUpdated, AC-6).
describe('DeliveryEventService ready signals (spec 0023)', () => {
  let service: DeliveryEventService
  let websocketDispatcher: any
  let offerPushService: any
  let courierRepository: any
  let deliveryRepository: any
  let deliveryEventRepository: any

  const readyAt = new Date('2026-11-03T12:18:00.000Z')
  const foodReadyAt = new Date('2026-11-03T12:10:00.000Z')

  const heldDelivery = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'del-1',
      status: EnumDeliveryStatus.DISPATCHED,
      courierId: 'courier-1',
      matchedCourierId: null,
      pickupBusinessName: 'R73 Kitchen',
      dropoffName: 'Maria Customer',
      dropoffPhoneNumber: '+306900000000',
      readyAt,
      foodReadyAt: null,
      ...overrides,
    } as unknown as DeliveryEntity)

  beforeEach(() => {
    websocketDispatcher = {
      sendJobReadyUpdated: jest.fn().mockResolvedValue(undefined),
      dispatchDeliveryStatusUpdated: jest.fn(),
      sendOfferToCourier: jest.fn(),
      sendOfferEnded: jest.fn(),
    }
    offerPushService = {
      jobReadyUpdated: jest.fn(),
      newOffer: jest.fn(),
      offerEnded: jest.fn(),
      jobCancelled: jest.fn(),
    }
    courierRepository = {
      findById: jest.fn().mockResolvedValue({ id: 'courier-1', userId: 'user-courier-1' }),
    }
    deliveryRepository = {
      update: jest.fn(),
      updateIfMatches: jest.fn(),
    }
    deliveryEventRepository = {
      create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
    }

    service = new DeliveryEventService(
      {} as ConfigService,
      websocketDispatcher as WebsocketDispatcher,
      courierRepository,
      deliveryRepository,
      deliveryEventRepository,
      { scheduleTask: jest.fn() } as unknown as TaskBusScheduler,
      { registerTaskHandler: jest.fn() } as unknown as TaskBusService,
      { sendDeliveryUpdatePartnerWebhook: jest.fn() } as unknown as PartnerWebhookService,
      {} as any,
      {} as any,
      {} as any,
      {} as unknown as ConfigDomainService,
      {} as any,
      offerPushService as OfferPushService,
      { findOn: jest.fn().mockResolvedValue(null) } as any,
      { getRoute: jest.fn() } as any,
      {} as any,
      {} as any
    )
  })

  describe('recordReadyEvent', () => {
    test.each([
      [EnumDeliveryEventType.READY_DELAYED, '+10 min, ready at 14:18'],
      [EnumDeliveryEventType.FOOD_READY, 'Food ready at 14:10'],
    ])('saves a %s row with the status unchanged, actor PARTNER, source PARTNER_APP and no courierId', async (type, message) => {
      await service.recordReadyEvent(
        {
          deliveryId: 'del-1',
          type: type as any,
          actor: EnumEventActor.PARTNER,
          source: EnumDeliveryEventSource.PARTNER_APP,
          message,
        },
        EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION
      )

      expect(deliveryEventRepository.create).toHaveBeenCalledTimes(1)
      const row = deliveryEventRepository.create.mock.calls[0][0]
      expect(row).toEqual(
        expect.objectContaining({
          deliveryId: 'del-1',
          type,
          actor: EnumEventActor.PARTNER,
          eventSource: EnumDeliveryEventSource.PARTNER_APP,
          message,
          oldStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
          newStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
          transitionSuccessful: true,
        })
      )
      expect(row).not.toHaveProperty('courierId')
      // occurredAt is left to the column default (the server's now).
      expect(row).not.toHaveProperty('occurredAt')
      // No status write: the event only records.
      expect(deliveryRepository.update).not.toHaveBeenCalled()
      expect(deliveryRepository.updateIfMatches).not.toHaveBeenCalled()
    })
  })

  describe('notifyReadyUpdated (AC-6)', () => {
    test('a delay: sends JOB_READY_UPDATED to the holding rider userId with id, restaurant name, times and minutes', async () => {
      await service.notifyReadyUpdated(heldDelivery(), 10)

      expect(courierRepository.findById).toHaveBeenCalledWith('courier-1')
      const expected = {
        deliveryId: 'del-1',
        restaurantName: 'R73 Kitchen',
        readyAt: readyAt.toISOString(),
        foodReadyAt: null,
        delayMinutes: 10,
      }
      expect(websocketDispatcher.sendJobReadyUpdated).toHaveBeenCalledTimes(1)
      expect(websocketDispatcher.sendJobReadyUpdated).toHaveBeenCalledWith('user-courier-1', expected)
      expect(offerPushService.jobReadyUpdated).toHaveBeenCalledTimes(1)
      expect(offerPushService.jobReadyUpdated).toHaveBeenCalledWith('courier-1', expected)
    })

    test('food ready: foodReadyAt as ISO and delayMinutes null', async () => {
      await service.notifyReadyUpdated(heldDelivery({ foodReadyAt }), null)

      const message = websocketDispatcher.sendJobReadyUpdated.mock.calls[0][1]
      expect(message).toEqual({
        deliveryId: 'del-1',
        restaurantName: 'R73 Kitchen',
        readyAt: readyAt.toISOString(),
        foodReadyAt: foodReadyAt.toISOString(),
        delayMinutes: null,
      })
      expect(offerPushService.jobReadyUpdated).toHaveBeenCalledWith('courier-1', message)
    })

    test('an order with no readyAt sends readyAt null', async () => {
      await service.notifyReadyUpdated(heldDelivery({ readyAt: null }), 5)

      expect(websocketDispatcher.sendJobReadyUpdated.mock.calls[0][1].readyAt).toBeNull()
    })

    test('the message carries no customer detail: only the five named fields', async () => {
      await service.notifyReadyUpdated(heldDelivery(), 5)

      const message = websocketDispatcher.sendJobReadyUpdated.mock.calls[0][1]
      expect(Object.keys(message).sort()).toEqual(
        ['deliveryId', 'restaurantName', 'readyAt', 'foodReadyAt', 'delayMinutes'].sort()
      )
      expect(JSON.stringify(message)).not.toContain('Maria')
      expect(JSON.stringify(message)).not.toContain('+3069')
    })

    test('no rider holds the delivery (courierId null): nothing is looked up or sent, even with a rider only offered it', async () => {
      await service.notifyReadyUpdated(heldDelivery({ courierId: null, matchedCourierId: 'courier-offered' }), 10)

      expect(courierRepository.findById).not.toHaveBeenCalled()
      expect(websocketDispatcher.sendJobReadyUpdated).not.toHaveBeenCalled()
      expect(offerPushService.jobReadyUpdated).not.toHaveBeenCalled()
    })

    test('a live connection failure never fails the action, and the push still goes', async () => {
      websocketDispatcher.sendJobReadyUpdated.mockRejectedValue(new Error('socket down'))
      const errorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined)

      await expect(service.notifyReadyUpdated(heldDelivery(), 10)).resolves.toBeUndefined()

      expect(offerPushService.jobReadyUpdated).toHaveBeenCalledTimes(1)
      // Logged by delivery id, never the restaurant name or times.
      const logged = errorSpy.mock.calls.map((call) => String(call[0])).join('\n')
      expect(logged).toContain('del-1')
      expect(logged).not.toContain('R73 Kitchen')
      errorSpy.mockRestore()
    })

    test('a failed rider lookup never fails the action', async () => {
      courierRepository.findById.mockRejectedValue(new Error('db down'))
      jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined)

      await expect(service.notifyReadyUpdated(heldDelivery(), 10)).resolves.toBeUndefined()
      expect(websocketDispatcher.sendJobReadyUpdated).not.toHaveBeenCalled()
    })

    test('a rider with no user id gets no live message', async () => {
      courierRepository.findById.mockResolvedValue({ id: 'courier-1', userId: null })

      await service.notifyReadyUpdated(heldDelivery(), 10)

      expect(websocketDispatcher.sendJobReadyUpdated).not.toHaveBeenCalled()
    })
  })
})
