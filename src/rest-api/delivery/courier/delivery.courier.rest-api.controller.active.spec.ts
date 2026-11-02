import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { Logger, RequestMethod } from '@nestjs/common'
import { EnumDeliveryIssueReason, EnumDeliveryStatus, EnumUserRole } from '@prisma/types'
import { DeliveryCourierRestApiController } from './delivery.courier.rest-api.controller'
import { DeliveryRestApiCourierService } from './delivery.courier.rest-api.service'
import { DeliveryDomainService } from 'src/domains/delivery/delivery.domain.service'
import { OsrmRoutingService } from 'src/services/osrm/osrm-routing.service'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { DeliveryNotFoundException } from 'src/errors'
import { ROLES_KEY } from 'src/decorators/roles.decorator'
import { DeliveryIssueWithCourier } from 'src/persistence/repositories/delivery-issue.repository'
import { DeliveryIssueCourierDto } from './dtos/delivery-issue.courier.dto'
import { NewDeliveriesCourierPaginatedDto } from './dtos/new-deliveries.courier.paginated.dto'
import { NewDeliveryCourier } from './types/new-delivery.courier.type'

describe('DeliveryCourierRestApiController.reportIssue (clause 1)', () => {
  let controller: DeliveryCourierRestApiController
  let mockDeliveryRestApiCourierService: jest.Mocked<DeliveryRestApiCourierService>
  let mockDeliveryDomainService: jest.Mocked<DeliveryDomainService>

  const mockCourier = {
    id: 'courier-42',
    firstName: 'Alexandros',
    lastName: 'Iordanidis',
  } as CourierEntity

  const deliveryId = 'del-xyz-789'

  const mockStoredIssue: DeliveryIssueWithCourier = {
    id: 'issue-42',
    deliveryId,
    courierId: 'courier-42',
    reason: EnumDeliveryIssueReason.ORDER_HANDED,
    note: 'Handed to recipient in lobby',
    createdAt: new Date('2026-10-27T08:20:00.000Z'),
    courier: {
      firstName: 'Alexandros',
      lastName: 'Iordanidis',
    },
  }

  beforeEach(() => {
    mockDeliveryRestApiCourierService = {
      reportIssue: jest.fn(),
      markAsDispatched: jest.fn().mockResolvedValue({ id: deliveryId, status: 'DISPATCHED' } as any),
      courierArrivedAtPickup: jest.fn().mockResolvedValue({ id: deliveryId, status: 'COURIER_ARRIVED_AT_PICKUP_LOCATION' } as any),
      courierArrivedAtDropOff: jest.fn().mockResolvedValue({ id: deliveryId, status: 'COURIER_ARRIVED_AT_DROPOFF_LOCATION' } as any),
      markAsPickedUp: jest.fn().mockResolvedValue({ id: deliveryId, status: 'PICKED_UP' } as any),
      markAsDelivered: jest.fn().mockResolvedValue({ id: deliveryId, status: 'DROPPED_OFF' } as any),
    } as unknown as jest.Mocked<DeliveryRestApiCourierService>

    mockDeliveryDomainService = {} as jest.Mocked<DeliveryDomainService>

    controller = new DeliveryCourierRestApiController(
      mockDeliveryRestApiCourierService,
      mockDeliveryDomainService,
      // Spec 0019: OSRM for the offer trip figures (mechanical fixture for the new argument).
      { getRoute: jest.fn().mockRejectedValue(new Error('no OSRM in this test')) } as never
    )
  })

  test('answers the stored report as DeliveryIssueCourierDto (id, reason, note, createdAt)', async () => {
    mockDeliveryRestApiCourierService.reportIssue.mockResolvedValue(mockStoredIssue)

    const input = {
      reason: EnumDeliveryIssueReason.ORDER_HANDED,
      note: 'Handed to recipient in lobby',
    }

    const result = await controller.reportIssue(deliveryId, input, mockCourier)

    expect(mockDeliveryRestApiCourierService.reportIssue).toHaveBeenCalledWith(
      deliveryId,
      mockCourier.id,
      input
    )
    expect(result).toBeInstanceOf(DeliveryIssueCourierDto)
    expect(result.id).toBe('issue-42')
    expect(result.reason).toBe(EnumDeliveryIssueReason.ORDER_HANDED)
    expect(result.note).toBe('Handed to recipient in lobby')
    expect(result.createdAt).toEqual(new Date('2026-10-27T08:20:00.000Z'))
    // Courier DTO does not expose courier name / courier id back to caller
    expect((result as any).courierId).toBeUndefined()
    expect((result as any).courierName).toBeUndefined()
  })

  test('reportIssue handler carries @Roles(COURIER) decorator metadata', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, controller.reportIssue)
    expect(roles).toEqual([EnumUserRole.COURIER])
  })

  test('reportIssue is routed at PATH :deliveryId/issues with METHOD POST', () => {
    const path = Reflect.getMetadata(PATH_METADATA, controller.reportIssue)
    const method = Reflect.getMetadata(METHOD_METADATA, controller.reportIssue)
    expect(path).toBe(':deliveryId/issues')
    expect(method).toBe(RequestMethod.POST)
  })

  test('propagates DeliveryNotFoundException when delivery does not belong to courier or does not exist', async () => {
    mockDeliveryRestApiCourierService.reportIssue.mockRejectedValue(
      new DeliveryNotFoundException('Delivery not found')
    )

    const input = {
      reason: EnumDeliveryIssueReason.OTHER,
      note: 'Issue note',
    }

    await expect(controller.reportIssue(deliveryId, input, mockCourier)).rejects.toThrow(
      DeliveryNotFoundException
    )
  })

  describe('Five courier step endpoints forward body with tapAgeMs (Spec 0009, AC-4, AC-9)', () => {
    test('markAsDispatched forwards input to service', async () => {
      const input = { tapAgeMs: 5000 }
      await controller.markAsDispatched(deliveryId, input, mockCourier)

      expect(mockDeliveryRestApiCourierService.markAsDispatched).toHaveBeenCalledWith(
        deliveryId,
        mockCourier.id,
        input
      )
    })

    test('courierArrivedAtPickup forwards input to service', async () => {
      const input = { tapAgeMs: 3000 }
      await controller.courierArrivedAtPickup(deliveryId, input, mockCourier)

      expect(mockDeliveryRestApiCourierService.courierArrivedAtPickup).toHaveBeenCalledWith(
        deliveryId,
        mockCourier.id,
        input
      )
    })

    test('courierArrivedAtDropoff forwards input to service', async () => {
      const input = { tapAgeMs: 2500 }
      await controller.courierArrivedAtDropoff(deliveryId, input, mockCourier)

      expect(mockDeliveryRestApiCourierService.courierArrivedAtDropOff).toHaveBeenCalledWith(
        deliveryId,
        mockCourier.id,
        input
      )
    })

    test('markAsPickedUp forwards note and tapAgeMs to service', async () => {
      const input = { note: 'Picked up from chef', tapAgeMs: 6000 }
      await controller.markAsPickedUp(deliveryId, input, mockCourier)

      expect(mockDeliveryRestApiCourierService.markAsPickedUp).toHaveBeenCalledWith(
        deliveryId,
        mockCourier.id,
        {
          note: 'Picked up from chef',
          tapAgeMs: 6000,
        }
      )
    })

    test('markAsDelivered forwards input to service', async () => {
      const input = { note: 'Left at door', tapAgeMs: 4000 }
      await controller.markAsDelivered(deliveryId, input, mockCourier)

      expect(mockDeliveryRestApiCourierService.markAsDelivered).toHaveBeenCalledWith(
        deliveryId,
        mockCourier.id,
        input
      )
    })
  })
})

describe('DeliveryCourierRestApiController.getMyNewDeliveries (Spec 0019 AC-1, Row 70)', () => {
  let controller: DeliveryCourierRestApiController
  let mockDeliveryRestApiCourierService: jest.Mocked<DeliveryRestApiCourierService>
  let mockDeliveryDomainService: jest.Mocked<DeliveryDomainService>
  let mockOsrmRoutingService: jest.Mocked<OsrmRoutingService>

  const courierWithLocation: CourierEntity = {
    id: 'courier-loc-1',
    firstName: 'Alexandros',
    lastName: 'Iordanidis',
    currentLocation: { latitude: 39.36, longitude: 22.94 },
  } as CourierEntity

  const createMockOffer = (id: string, pLat: number, pLon: number, dLat: number, dLon: number): NewDeliveryCourier =>
    ({
      id,
      status: EnumDeliveryStatus.ASSIGNING_COURIER,
      createdAt: new Date('2026-11-02T10:00:00.000Z'),
      totalCompensation: 500,
      currencyCode: 'EUR',
      pickupBusinessName: `Business ${id}`,
      pickupLocation: {
        id: `loc-p-${id}`,
        latitude: pLat,
        longitude: pLon,
        street: 'Iasonos',
        houseNumber: '10',
        city: 'Volos',
        state: 'Magnesia',
      },
      dropoffLocation: {
        id: `loc-d-${id}`,
        latitude: dLat,
        longitude: dLon,
        street: 'Dimitriadis',
        houseNumber: '20',
        city: 'Volos',
        state: 'Magnesia',
      },
    } as unknown as NewDeliveryCourier)

  beforeEach(() => {
    mockDeliveryRestApiCourierService = {
      getMyNewDeliveries: jest.fn(),
    } as unknown as jest.Mocked<DeliveryRestApiCourierService>

    mockDeliveryDomainService = {} as jest.Mocked<DeliveryDomainService>

    mockOsrmRoutingService = {
      getRoute: jest.fn(),
    } as unknown as jest.Mocked<OsrmRoutingService>

    controller = new DeliveryCourierRestApiController(
      mockDeliveryRestApiCourierService,
      mockDeliveryDomainService,
      mockOsrmRoutingService
    )
  })

  test('getMyNewDeliveries handler carries @Roles(COURIER) decorator metadata', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, controller.getMyNewDeliveries)
    expect(roles).toEqual([EnumUserRole.COURIER])
  })

  test('getMyNewDeliveries is routed at PATH new with METHOD GET', () => {
    const path = Reflect.getMetadata(PATH_METADATA, controller.getMyNewDeliveries)
    const method = Reflect.getMetadata(METHOD_METADATA, controller.getMyNewDeliveries)
    expect(path).toBe('new')
    expect(method).toBe(RequestMethod.GET)
  })

  test('passes courier.currentLocation as rider and each offer pickup and dropoff, computes trips lined up by position', async () => {
    const offer1 = createMockOffer('del-1', 39.365, 22.945, 39.375, 22.955)
    const offer2 = createMockOffer('del-2', 39.368, 22.948, 39.378, 22.958)

    mockDeliveryRestApiCourierService.getMyNewDeliveries.mockResolvedValue({
      data: [offer1, offer2],
      pagination: { totalItems: 2, totalPages: 1, currentItems: 2, currentPage: 1, perPage: 10, prevPage: null, nextPage: null },
    })

    // Offer 1: rider leg (600m, 70s), dropoff leg (1200m, 130s) -> total 200s -> 4 min
    // Offer 2: rider leg (800m, 90s), dropoff leg (1500m, 160s) -> total 250s -> 5 min
    mockOsrmRoutingService.getRoute
      .mockResolvedValueOnce({ distanceMetres: 600, durationSeconds: 70, points: [] })
      .mockResolvedValueOnce({ distanceMetres: 1200, durationSeconds: 130, points: [] })
      .mockResolvedValueOnce({ distanceMetres: 800, durationSeconds: 90, points: [] })
      .mockResolvedValueOnce({ distanceMetres: 1500, durationSeconds: 160, points: [] })

    const result = await controller.getMyNewDeliveries({ page: 1, perPage: 10 }, courierWithLocation)

    expect(mockDeliveryRestApiCourierService.getMyNewDeliveries).toHaveBeenCalledWith(
      courierWithLocation.id,
      1,
      10
    )

    expect(mockOsrmRoutingService.getRoute).toHaveBeenCalledTimes(4)
    // Offer 1 rider leg: rider -> pickup
    expect(mockOsrmRoutingService.getRoute).toHaveBeenNthCalledWith(1, {
      fromLocation: courierWithLocation.currentLocation,
      toLocation: offer1.pickupLocation,
    })
    // Offer 1 dropoff leg: pickup -> dropoff
    expect(mockOsrmRoutingService.getRoute).toHaveBeenNthCalledWith(2, {
      fromLocation: offer1.pickupLocation,
      toLocation: offer1.dropoffLocation,
    })
    // Offer 2 rider leg: rider -> pickup
    expect(mockOsrmRoutingService.getRoute).toHaveBeenNthCalledWith(3, {
      fromLocation: courierWithLocation.currentLocation,
      toLocation: offer2.pickupLocation,
    })
    // Offer 2 dropoff leg: pickup -> dropoff
    expect(mockOsrmRoutingService.getRoute).toHaveBeenNthCalledWith(4, {
      fromLocation: offer2.pickupLocation,
      toLocation: offer2.dropoffLocation,
    })

    expect(result).toBeInstanceOf(NewDeliveriesCourierPaginatedDto)
    expect(result.data).toHaveLength(2)
    expect(result.data[0]?.offerTrip).toEqual({
      toPickupMetres: 600,
      toDropoffMetres: 1200,
      minutes: 4,
    })
    expect(result.data[1]?.offerTrip).toEqual({
      toPickupMetres: 800,
      toDropoffMetres: 1500,
      minutes: 5,
    })
  })

  test('an OSRM that always rejects still returns every offer with null figures', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
    const offer1 = createMockOffer('del-err-1', 39.365, 22.945, 39.375, 22.955)
    const offer2 = createMockOffer('del-err-2', 39.368, 22.948, 39.378, 22.958)

    mockDeliveryRestApiCourierService.getMyNewDeliveries.mockResolvedValue({
      data: [offer1, offer2],
      pagination: { totalItems: 2, totalPages: 1, currentItems: 2, currentPage: 1, perPage: 10, prevPage: null, nextPage: null },
    })

    mockOsrmRoutingService.getRoute.mockRejectedValue(new Error('OSRM network timeout'))

    const result = await controller.getMyNewDeliveries({ page: 1, perPage: 10 }, courierWithLocation)

    expect(result).toBeInstanceOf(NewDeliveriesCourierPaginatedDto)
    expect(result.data).toHaveLength(2)
    expect(result.data[0]?.offerTrip).toEqual({
      toPickupMetres: null,
      toDropoffMetres: null,
      minutes: null,
    })
    expect(result.data[1]?.offerTrip).toEqual({
      toPickupMetres: null,
      toDropoffMetres: null,
      minutes: null,
    })

    warnSpy.mockRestore()
  })

  test('when courier has no currentLocation (null), rider leg is null and not requested', async () => {
    const courierWithoutLocation = {
      ...courierWithLocation,
      currentLocation: null,
    } as unknown as CourierEntity

    const offer = createMockOffer('del-no-loc', 39.365, 22.945, 39.375, 22.955)

    mockDeliveryRestApiCourierService.getMyNewDeliveries.mockResolvedValue({
      data: [offer],
      pagination: { totalItems: 1, totalPages: 1, currentItems: 1, currentPage: 1, perPage: 10, prevPage: null, nextPage: null },
    })

    mockOsrmRoutingService.getRoute.mockResolvedValue({
      distanceMetres: 1350,
      durationSeconds: 150,
      points: [],
    })

    const result = await controller.getMyNewDeliveries({ page: 1, perPage: 10 }, courierWithoutLocation)

    // Only 1 call for pickup -> dropoff (rider leg not called because rider location is null)
    expect(mockOsrmRoutingService.getRoute).toHaveBeenCalledTimes(1)
    expect(mockOsrmRoutingService.getRoute).toHaveBeenCalledWith({
      fromLocation: offer.pickupLocation,
      toLocation: offer.dropoffLocation,
    })
    expect(result.data[0]?.offerTrip).toEqual({
      toPickupMetres: null,
      toDropoffMetres: 1350,
      minutes: null,
    })
  })
})
