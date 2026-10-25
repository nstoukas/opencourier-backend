import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { DeliveryAdminDto } from '../admin/dtos/delivery.admin.dto'
import { DeliveryAdminPaginatedDto } from '../admin/dtos/delivery.admin.paginated.dto'
import { DeliveryCourierDto } from '../courier/dtos/delivery.courier.dto'
import { NewDeliveriesCourierPaginatedDto } from '../courier/dtos/new-deliveries.courier.paginated.dto'
import { DeliveryOfferView } from 'src/domains/delivery/types/delivery-offer-view.type'
import { DeliveryEventAdminDto } from '../admin/dtos/delivery-event.admin.dto'
import { DeliveryEventEntity } from 'src/domains/delivery-event/entities/delivery-event.entity'
import {
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
} from '@prisma/types'

describe('Delivery DTOs - Offer Expiry Fields (Spec 0002, AC-9, AC-11)', () => {
  const offeredAt = new Date('2026-10-25T10:00:00.000Z')
  const offerExpiresAt = new Date('2026-10-25T10:00:20.000Z')
  const waitingSince = new Date('2026-10-25T09:55:00.000Z')

  const baseDelivery: any = {
    id: 'del-dto-1',
    createdAt: new Date('2026-10-25T09:50:00.000Z'),
    pickupName: 'Taverna Nosh',
    dropoffName: 'Customer Home',
    offeredAt,
    offerExpiresAt,
    pickupLocation: { id: 'loc-pickup' },
    dropoffLocation: { id: 'loc-dropoff' },
  }

  describe('DeliveryAdminDto (AC-11)', () => {
    it('initializes offeredAt, offerExpiresAt, matchedCourierName, and waitingForCourierSince from offerView', () => {
      const offerView: DeliveryOfferView = {
        matchedCourierName: 'Kostas P.',
        waitingForCourierSince: null,
      }

      const dto = new DeliveryAdminDto(baseDelivery as DeliveryEntity, undefined, offerView)

      expect(dto.offeredAt).toEqual(offeredAt)
      expect(dto.offerExpiresAt).toEqual(offerExpiresAt)
      expect(dto.matchedCourierName).toBe('Kostas P.')
      expect(dto.waitingForCourierSince).toBeNull()
    })

    it('initializes waitingForCourierSince when delivery is waiting for a rider', () => {
      const waitingDelivery: Partial<DeliveryEntity> = {
        ...baseDelivery,
        id: 'del-dto-waiting',
        offeredAt: null,
        offerExpiresAt: null,
      }
      const offerView: DeliveryOfferView = {
        matchedCourierName: null,
        waitingForCourierSince: waitingSince,
      }

      const dto = new DeliveryAdminDto(waitingDelivery as DeliveryEntity, undefined, offerView)

      expect(dto.offeredAt).toBeNull()
      expect(dto.offerExpiresAt).toBeNull()
      expect(dto.matchedCourierName).toBeNull()
      expect(dto.waitingForCourierSince).toEqual(waitingSince)
    })

    it('defaults matchedCourierName and waitingForCourierSince to null when offerView is omitted', () => {
      const dto = new DeliveryAdminDto(baseDelivery as DeliveryEntity)

      expect(dto.matchedCourierName).toBeNull()
      expect(dto.waitingForCourierSince).toBeNull()
    })
  })

  describe('DeliveryAdminPaginatedDto (AC-11)', () => {
    it('maps offerViews correctly to paginated delivery dtos by delivery id', () => {
      const del1 = { ...baseDelivery, id: 'del-1' } as DeliveryEntity
      const del2 = { ...baseDelivery, id: 'del-2' } as DeliveryEntity

      const offerViews = new Map<string, DeliveryOfferView>([
        ['del-1', { matchedCourierName: 'Rider One', waitingForCourierSince: null }],
        ['del-2', { matchedCourierName: null, waitingForCourierSince: waitingSince }],
      ])

      const paginatedDto = new DeliveryAdminPaginatedDto(
        { data: [del1, del2] },
        offerViews
      )

      expect(paginatedDto.data).toHaveLength(2)
      expect(paginatedDto.data[0]?.matchedCourierName).toBe('Rider One')
      expect(paginatedDto.data[0]?.waitingForCourierSince).toBeNull()
      expect(paginatedDto.data[1]?.matchedCourierName).toBeNull()
      expect(paginatedDto.data[1]?.waitingForCourierSince).toEqual(waitingSince)
    })
  })

  describe('DeliveryCourierDto (AC-9)', () => {
    it('includes offeredAt and offerExpiresAt for courier', () => {
      const dto = new DeliveryCourierDto(baseDelivery as DeliveryEntity)

      expect(dto.offeredAt).toEqual(offeredAt)
      expect(dto.offerExpiresAt).toEqual(offerExpiresAt)
    })
  })

  describe('NewDeliveriesCourierPaginatedDto (AC-9)', () => {
    it('includes serverNow date on response for phone clock synchronization', () => {
      const before = new Date()
      const paginatedDto = new NewDeliveriesCourierPaginatedDto({
        data: [baseDelivery as any],
      })
      const after = new Date()

      expect(paginatedDto.serverNow).toBeInstanceOf(Date)
      expect(paginatedDto.serverNow.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(paginatedDto.serverNow.getTime()).toBeLessThanOrEqual(after.getTime())

      expect(paginatedDto.data).toHaveLength(1)
      expect(paginatedDto.data[0]?.offeredAt).toEqual(offeredAt)
      expect(paginatedDto.data[0]?.offerExpiresAt).toEqual(offerExpiresAt)
    })
  })

  describe('DeliveryEventAdminDto (AC-11, review fix)', () => {
    it('copies courierId from entity when present', () => {
      const eventEntity = new DeliveryEventEntity({
        id: 'evt-1',
        deliveryId: 'del-1',
        type: EnumDeliveryEventType.OFFERED,
        actor: EnumEventActor.SYSTEM,
        eventSource: EnumDeliveryEventSource.OPENCOURIER,
        oldStatus: null,
        newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
        transitionSuccessful: true,
        message: 'Offered to courier-abc',
        courierId: 'courier-abc',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const dto = new DeliveryEventAdminDto(eventEntity)
      expect(dto.courierId).toBe('courier-abc')
    })

    it('sets courierId to null on events without one', () => {
      const eventEntity = new DeliveryEventEntity({
        id: 'evt-2',
        deliveryId: 'del-1',
        type: EnumDeliveryEventType.CREATED,
        actor: EnumEventActor.PARTNER,
        eventSource: EnumDeliveryEventSource.PARTNER_APP,
        oldStatus: null,
        newStatus: null,
        transitionSuccessful: true,
        message: 'Order placed',
        courierId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const dto = new DeliveryEventAdminDto(eventEntity)
      expect(dto.courierId).toBeNull()
    })
  })
})
