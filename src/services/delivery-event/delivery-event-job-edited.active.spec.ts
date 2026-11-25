import { ConfigService } from '@nestjs/config'
import { EnumDeliveryStatus } from '@prisma/types'
import { DeliveryEventService } from './delivery-event.service'
import { WebsocketDispatcher } from '../websocket/models/WebsocketDispatcher'
import { OfferPushService } from '../pushNotification/offer-push.service'
import { TaskBusScheduler } from '../taskBus/models/TaskBusScheduler'
import { TaskBusService } from '../taskBus/taskBus.service'
import { PartnerWebhookService } from '../partner-webhooks/partner-webhooks.service'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { JobEditedField, JobEditedMessage } from 'src/shared-types/notification'

// Row 164: telling the rider holding a job that its restaurant changed notes or times (notifyJobEdited).
describe('DeliveryEventService job edited (Row 164)', () => {
  let service: DeliveryEventService
  let websocketDispatcher: any
  let offerPushService: any
  let courierRepository: any
  let deliveryRepository: any
  let deliveryEventRepository: any

  const heldDelivery = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'del-164',
      status: EnumDeliveryStatus.DISPATCHED,
      courierId: 'courier-1',
      matchedCourierId: null,
      pickupBusinessName: 'Nosh Tavern',
      dropoffName: 'Nikos Customer',
      dropoffPhoneNumber: '+306911111111',
      pickupNotes: 'Gate code 1234',
      dropoffNotes: 'Leave at door',
      ...overrides,
    } as unknown as DeliveryEntity)

  beforeEach(() => {
    websocketDispatcher = {
      sendJobEdited: jest.fn().mockResolvedValue(undefined),
      sendJobReadyUpdated: jest.fn().mockResolvedValue(undefined),
      dispatchDeliveryStatusUpdated: jest.fn(),
      sendOfferToCourier: jest.fn(),
      sendOfferEnded: jest.fn(),
    }
    offerPushService = {
      jobEdited: jest.fn(),
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
      {} as any,
      { closeOpenForDelivery: jest.fn().mockResolvedValue(undefined) } as any
    )
  })

  describe('clause 1: notifyJobEdited sends JOB_EDITED through websocketDispatcher and offerPushService', () => {
    test('sends JOB_EDITED to courier userId and push when notes change', async () => {
      const delivery = heldDelivery()
      const changed: JobEditedField[] = ['NOTES']

      await service.notifyJobEdited(delivery, changed)

      expect(courierRepository.findById).toHaveBeenCalledWith('courier-1')
      expect(websocketDispatcher.sendJobEdited).toHaveBeenCalledTimes(1)

      const [userId, wsMessage] = websocketDispatcher.sendJobEdited.mock.calls[0]
      expect(userId).toBe('user-courier-1')
      expect(wsMessage.deliveryId).toBe('del-164')
      expect(wsMessage.restaurantName).toBe('Nosh Tavern')
      expect(wsMessage.changed).toEqual(['NOTES'])
      expect(typeof wsMessage.editedAt).toBe('string')
      expect(new Date(wsMessage.editedAt).toISOString()).toBe(wsMessage.editedAt)

      expect(offerPushService.jobEdited).toHaveBeenCalledTimes(1)
      expect(offerPushService.jobEdited).toHaveBeenCalledWith('courier-1', wsMessage)

      // Exact key set for wsMessage: deliveryId, restaurantName, changed, editedAt
      expect(Object.keys(wsMessage).sort()).toEqual(['changed', 'deliveryId', 'editedAt', 'restaurantName'])
      // Push receives the exact same message with the exact same editedAt
      const pushMessage = offerPushService.jobEdited.mock.calls[0][1]
      expect(pushMessage.editedAt).toBe(wsMessage.editedAt)
      expect(Object.keys(pushMessage).sort()).toEqual(['changed', 'deliveryId', 'editedAt', 'restaurantName'])
    })

    test('live message and push carry the exact same editedAt and no customer or notes details', async () => {
      const delivery = heldDelivery({
        pickupNotes: 'Gate code 1234',
        dropoffNotes: 'Leave at door',
        dropoffPhoneNumber: '+306911111111',
        dropoffName: 'Nikos Customer',
      })
      await service.notifyJobEdited(delivery, ['NOTES', 'TIMES'])

      const [, wsMessage] = websocketDispatcher.sendJobEdited.mock.calls[0]
      const [, pushMessage] = offerPushService.jobEdited.mock.calls[0]

      expect(wsMessage.editedAt).toBe(pushMessage.editedAt)
      expect(Object.keys(wsMessage).sort()).toEqual(['changed', 'deliveryId', 'editedAt', 'restaurantName'])
      expect(Object.keys(pushMessage).sort()).toEqual(['changed', 'deliveryId', 'editedAt', 'restaurantName'])
      expect((wsMessage as any).pickupNotes).toBeUndefined()
      expect((wsMessage as any).dropoffNotes).toBeUndefined()
      expect((wsMessage as any).dropoffPhoneNumber).toBeUndefined()
      expect((wsMessage as any).dropoffName).toBeUndefined()
    })

    test('sends JOB_EDITED with TIMES when times change', async () => {
      const delivery = heldDelivery()
      const changed: JobEditedField[] = ['TIMES']

      await service.notifyJobEdited(delivery, changed)

      const wsMessage = websocketDispatcher.sendJobEdited.mock.calls[0][1]
      expect(wsMessage.changed).toEqual(['TIMES'])
      expect(offerPushService.jobEdited).toHaveBeenCalledWith('courier-1', wsMessage)
    })

    test('sends JOB_EDITED with [NOTES, TIMES] in order when both change', async () => {
      const delivery = heldDelivery()
      const changed: JobEditedField[] = ['NOTES', 'TIMES']

      await service.notifyJobEdited(delivery, changed)

      const wsMessage = websocketDispatcher.sendJobEdited.mock.calls[0][1]
      expect(wsMessage.changed).toEqual(['NOTES', 'TIMES'])
      expect(offerPushService.jobEdited).toHaveBeenCalledWith('courier-1', wsMessage)
    })
  })

  describe('clause 2: sends nothing when courierId is missing or changed list is empty', () => {
    test('sends nothing when delivery has no courierId (null)', async () => {
      const delivery = heldDelivery({ courierId: null })

      await service.notifyJobEdited(delivery, ['NOTES'])

      expect(courierRepository.findById).not.toHaveBeenCalled()
      expect(websocketDispatcher.sendJobEdited).not.toHaveBeenCalled()
      expect(offerPushService.jobEdited).not.toHaveBeenCalled()
    })

    test('sends nothing when changed list is empty []', async () => {
      const delivery = heldDelivery()

      await service.notifyJobEdited(delivery, [])

      expect(courierRepository.findById).not.toHaveBeenCalled()
      expect(websocketDispatcher.sendJobEdited).not.toHaveBeenCalled()
      expect(offerPushService.jobEdited).not.toHaveBeenCalled()
    })
  })

  describe('clause 3: no read or seen record is kept', () => {
    test('does not write to deliveryEventRepository or deliveryRepository', async () => {
      const delivery = heldDelivery()

      await service.notifyJobEdited(delivery, ['NOTES', 'TIMES'])

      expect(deliveryEventRepository.create).not.toHaveBeenCalled()
      expect(deliveryRepository.update).not.toHaveBeenCalled()
      expect(deliveryRepository.updateIfMatches).not.toHaveBeenCalled()
    })
  })

  describe('clause 4: dispatcher or lookup failures never throw (notifyJobEdited never throws)', () => {
    test('websocket failure is caught and logged, does not throw, push still sent', async () => {
      websocketDispatcher.sendJobEdited.mockRejectedValue(new Error('WebSocket disconnect'))
      const errorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined)

      await expect(service.notifyJobEdited(heldDelivery(), ['NOTES'])).resolves.toBeUndefined()

      expect(offerPushService.jobEdited).toHaveBeenCalledTimes(1)
      const logged = errorSpy.mock.calls.map((c) => String(c[0])).join('\n')
      expect(logged).toContain('del-164')
      expect(logged).toContain('WebSocket disconnect')
      errorSpy.mockRestore()
    })

    test('courier lookup failure is caught and logged, does not throw, push still sent', async () => {
      courierRepository.findById.mockRejectedValue(new Error('DB read timeout'))
      const errorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined)

      await expect(service.notifyJobEdited(heldDelivery(), ['NOTES'])).resolves.toBeUndefined()

      expect(websocketDispatcher.sendJobEdited).not.toHaveBeenCalled()
      expect(offerPushService.jobEdited).toHaveBeenCalledTimes(1)
      const logged = errorSpy.mock.calls.map((c) => String(c[0])).join('\n')
      expect(logged).toContain('del-164')
      expect(logged).toContain('DB read timeout')
      errorSpy.mockRestore()
    })

    test('courier with no userId sends no websocket message but still sends push', async () => {
      courierRepository.findById.mockResolvedValue({ id: 'courier-1', userId: null })

      await service.notifyJobEdited(heldDelivery(), ['TIMES'])

      expect(websocketDispatcher.sendJobEdited).not.toHaveBeenCalled()
      expect(offerPushService.jobEdited).toHaveBeenCalledTimes(1)
    })
  })
})
