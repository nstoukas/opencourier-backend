import {
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
} from '@prisma/types'
import { DeliveryEventEntity } from 'src/domains/delivery-event/entities/delivery-event.entity'
import { DeliveryEventAdminDto } from './delivery-event.admin.dto'

describe('DeliveryEventAdminDto (Spec 0009, AC-10)', () => {
  test('carries occurredAt from entity next to createdAt', () => {
    // A step that waited for signal: tapped at 23:50, received at 00:20
    const occurredAt = new Date('2026-10-31T23:50:00.000Z')
    const createdAt = new Date('2026-11-01T00:20:00.000Z')

    const entity = new DeliveryEventEntity({
      id: 'evt-audit-1',
      deliveryId: 'del-1',
      courierId: 'courier-1',
      type: EnumDeliveryEventType.DROPPED_OFF,
      actor: EnumEventActor.COURIER,
      eventSource: EnumDeliveryEventSource.OPENCOURIER,
      oldStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
      newStatus: EnumDeliveryStatus.DROPPED_OFF,
      transitionSuccessful: true,
      message: 'Delivered',
      occurredAt,
      createdAt,
      updatedAt: createdAt,
    })

    const dto = new DeliveryEventAdminDto(entity)

    expect(dto.occurredAt).toEqual(occurredAt)
    expect(dto.createdAt).toEqual(createdAt)
    expect(dto.occurredAt).not.toEqual(dto.createdAt)
    expect(dto.id).toBe('evt-audit-1')
    expect(dto.courierId).toBe('courier-1')
    expect(dto.type).toBe(EnumDeliveryEventType.DROPPED_OFF)
    expect(dto.transitionSuccessful).toBe(true)
  })

  test('carries occurredAt equal to createdAt for an event handled on arrival', () => {
    const timestamp = new Date('2026-10-31T12:00:00.000Z')

    const entity = new DeliveryEventEntity({
      id: 'evt-audit-2',
      deliveryId: 'del-2',
      courierId: null,
      type: EnumDeliveryEventType.CREATED,
      actor: EnumEventActor.PARTNER,
      eventSource: EnumDeliveryEventSource.PARTNER_APP,
      oldStatus: EnumDeliveryStatus.CREATED,
      newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
      transitionSuccessful: true,
      message: null,
      occurredAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    const dto = new DeliveryEventAdminDto(entity)

    expect(dto.occurredAt).toEqual(timestamp)
    expect(dto.createdAt).toEqual(timestamp)
  })
})
