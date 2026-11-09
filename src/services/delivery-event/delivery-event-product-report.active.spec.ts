import { ConfigService } from '@nestjs/config'
import {
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
} from '@prisma/types'
import { DeliveryEventService } from './delivery-event.service'

describe('DeliveryEventService product report events (Spec 0032, AC-5, AC-7, AC-8)', () => {
  let service: DeliveryEventService
  let deliveryEventRepository: {
    create: jest.Mock
  }

  beforeEach(() => {
    deliveryEventRepository = {
      create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
    }

    service = new DeliveryEventService(
      {} as ConfigService,
      {} as any,
      {} as any,
      {} as any,
      deliveryEventRepository as any,
      { scheduleTask: jest.fn() } as any,
      { registerTaskHandler: jest.fn() } as any,
      { sendDeliveryUpdatePartnerWebhook: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { findOn: jest.fn().mockResolvedValue(null) } as any,
      { getRoute: jest.fn() } as any,
      {} as any,
      {} as any
    )
  })

  test('AC-5: recordProductReportEvent saves PRODUCT_REPORTED with courierId preserved when reported by rider', async () => {
    await service.recordProductReportEvent(
      {
        deliveryId: 'del-100',
        type: EnumDeliveryEventType.PRODUCT_REPORTED,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
        message: 'Reported WRONG_ITEM: Burger (COURIER)',
        courierId: 'courier-1',
      },
      EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION
    )

    expect(deliveryEventRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: 'del-100',
        type: EnumDeliveryEventType.PRODUCT_REPORTED,
        actor: EnumEventActor.COURIER,
        eventSource: EnumDeliveryEventSource.OPENCOURIER,
        message: 'Reported WRONG_ITEM: Burger (COURIER)',
        courierId: 'courier-1',
        oldStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
        newStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
        transitionSuccessful: true,
      })
    )
  })

  test('AC-5: recordProductReportEvent saves PRODUCT_REPORTED without courierId for partner or admin', async () => {
    await service.recordProductReportEvent(
      {
        deliveryId: 'del-100',
        type: EnumDeliveryEventType.PRODUCT_REPORTED,
        actor: EnumEventActor.PARTNER,
        source: EnumDeliveryEventSource.PARTNER_APP,
        message: 'Reported MISSING_ITEM: Coke (PARTNER)',
      },
      EnumDeliveryStatus.DROPPED_OFF
    )

    const savedPayload = deliveryEventRepository.create.mock.calls[0][0]
    expect(savedPayload).toEqual(
      expect.objectContaining({
        deliveryId: 'del-100',
        type: EnumDeliveryEventType.PRODUCT_REPORTED,
        actor: EnumEventActor.PARTNER,
        eventSource: EnumDeliveryEventSource.PARTNER_APP,
        message: 'Reported MISSING_ITEM: Coke (PARTNER)',
        oldStatus: EnumDeliveryStatus.DROPPED_OFF,
        newStatus: EnumDeliveryStatus.DROPPED_OFF,
        transitionSuccessful: true,
      })
    )
    expect(savedPayload.courierId).toBeUndefined()
  })

  test('AC-7: recordProductReportEvent saves PRODUCT_REPORT_RESOLVED with status unchanged', async () => {
    await service.recordProductReportEvent(
      {
        deliveryId: 'del-100',
        type: EnumDeliveryEventType.PRODUCT_REPORT_RESOLVED,
        actor: EnumEventActor.ADMIN,
        source: EnumDeliveryEventSource.OPENCOURIER,
        message: 'Report resolved (WRONG_ITEM)',
      },
      EnumDeliveryStatus.DROPPED_OFF
    )

    const savedPayload = deliveryEventRepository.create.mock.calls[0][0]
    expect(savedPayload).toEqual(
      expect.objectContaining({
        deliveryId: 'del-100',
        type: EnumDeliveryEventType.PRODUCT_REPORT_RESOLVED,
        actor: EnumEventActor.ADMIN,
        eventSource: EnumDeliveryEventSource.OPENCOURIER,
        message: 'Report resolved (WRONG_ITEM)',
        oldStatus: EnumDeliveryStatus.DROPPED_OFF,
        newStatus: EnumDeliveryStatus.DROPPED_OFF,
        transitionSuccessful: true,
      })
    )
    expect(savedPayload.courierId).toBeUndefined()
  })
})
