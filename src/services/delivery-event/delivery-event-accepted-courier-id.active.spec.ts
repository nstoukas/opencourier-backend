import {
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
} from '@prisma/types'
import { DeliveryEventService } from './delivery-event.service'

describe('saveDeliveryEvent saves courierId on ACCEPTED (spec 0040, AC-2)', () => {
  let service: DeliveryEventService
  let mockDeliveryEventRepository: {
    create: jest.Mock
  }

  beforeEach(() => {
    mockDeliveryEventRepository = {
      create: jest.fn().mockResolvedValue({ id: 'ev-1' }),
    }

    const mockTaskBusService = {
      registerTaskHandler: jest.fn(),
    }

    service = new DeliveryEventService(
      {} as any, // configService
      {} as any, // websocketDispatcher
      { clearLocationIfOfflineAndFree: jest.fn().mockResolvedValue(undefined) } as any, // courierRepository
      {} as any, // deliveryRepository
      mockDeliveryEventRepository as any,
      {} as any, // taskScheduler
      mockTaskBusService as any,
      {} as any, // partnerWebhookService
      {} as any, // deliveryMatchingService
      {} as any, // deliveryCalculationService
      {} as any, // bullMQService
      {} as any, // configDomainService
      {} as any, // cacheService
      {} as any, // offerPushService
      {} as any, // dispatchStopRepository
      {} as any, // osrmRoutingService
      {} as any, // courierCompensationRepository
      {} as any, // partnerChargeRepository
      { closeOpenForDelivery: jest.fn().mockResolvedValue(undefined) } as any  // removalRequestRepository
    )
  })

  it('saves courierId on an automatic ACCEPTED event (AC-2)', async () => {
    const autoAcceptEvent = {
      deliveryId: 'del-auto-1',
      type: EnumDeliveryEventType.ACCEPTED,
      actor: EnumEventActor.SYSTEM,
      courierId: 'courier-auto-42',
    }

    await (service as any).saveDeliveryEvent(autoAcceptEvent, {
      transitionSuccessful: true,
      oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
      newStatus: EnumDeliveryStatus.ACCEPTED,
    })

    expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        courierId: 'courier-auto-42',
        actor: EnumEventActor.SYSTEM,
      })
    )
  })

  it('saves courierId on a manual rider ACCEPTED event (AC-2)', async () => {
    const manualAcceptEvent = {
      deliveryId: 'del-manual-1',
      type: EnumDeliveryEventType.ACCEPTED,
      actor: EnumEventActor.COURIER,
      courierId: 'courier-rider-77',
    }

    await (service as any).saveDeliveryEvent(manualAcceptEvent, {
      transitionSuccessful: true,
      oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
      newStatus: EnumDeliveryStatus.ACCEPTED,
    })

    expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        courierId: 'courier-rider-77',
        actor: EnumEventActor.COURIER,
      })
    )
  })

  it('saves courierId on an admin ACCEPTED event (AC-2)', async () => {
    const adminAcceptEvent = {
      deliveryId: 'del-admin-1',
      type: EnumDeliveryEventType.ACCEPTED,
      actor: EnumEventActor.ADMIN,
      courierId: 'courier-admin-assigned-99',
    }

    await (service as any).saveDeliveryEvent(adminAcceptEvent, {
      transitionSuccessful: true,
      oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
      newStatus: EnumDeliveryStatus.ACCEPTED,
    })

    expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        courierId: 'courier-admin-assigned-99',
        actor: EnumEventActor.ADMIN,
      })
    )
  })

  it('does NOT save courierId on events not in the courierId allow list', async () => {
    const createdEvent = {
      deliveryId: 'del-created-1',
      type: EnumDeliveryEventType.CREATED,
      actor: EnumEventActor.SYSTEM,
      courierId: 'should-not-be-saved',
    }

    await (service as any).saveDeliveryEvent(createdEvent, {
      transitionSuccessful: true,
      newStatus: EnumDeliveryStatus.CREATED,
    })

    expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
      expect.not.objectContaining({
        courierId: 'should-not-be-saved',
      })
    )
  })
})
