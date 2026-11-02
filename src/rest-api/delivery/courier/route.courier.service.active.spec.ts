import { Logger, ServiceUnavailableException } from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import { EnumDeliveryStatus } from '@prisma/types'
import { DeliveryDomainService } from 'src/domains/delivery/delivery.domain.service'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { OsrmRoutingService } from 'src/services/osrm/osrm-routing.service'
import { DeliveryNotFoundException, EnvVarMissingException } from 'src/errors'
import { DELIVERY_ONGOING_STATUSES } from 'src/shared-types'
import {
  DeliveryRouteCourierService,
  ROUTE_UNAVAILABLE_MESSAGE,
} from './route.courier.service'
import { DeliveryRouteLegKind } from './dtos/delivery-route.courier.dto'

describe('DeliveryRouteCourierService (Spec 0018 AC-1, AC-2, AC-3)', () => {
  let service: DeliveryRouteCourierService
  let mockDeliveryDomainService: { getByIdOrThrowWithLocation: jest.Mock }
  let mockOsrmRoutingService: { getRoute: jest.Mock }
  let loggerWarnSpy: jest.SpyInstance

  const courierId = 'courier-r69'
  const otherCourierId = 'courier-other'
  const deliveryId = 'del-map-1'

  const riderPoint = { latitude: 39.361, longitude: 22.941 }
  const pickupPoint = { latitude: 39.365, longitude: 22.945 }
  const dropoffPoint = { latitude: 39.372, longitude: 22.955 }

  const makeCourier = (currentLocation: { latitude: number; longitude: number } | null | undefined = riderPoint) =>
    new CourierEntity({
      id: courierId,
      currentLocation,
    } as any)

  const makeCourierWithoutLocation = (currentLocation: null | undefined = null) =>
    new CourierEntity({
      id: courierId,
      currentLocation,
    } as any)

  const makeDelivery = (overrides: Partial<any> = {}) => ({
    id: deliveryId,
    status: EnumDeliveryStatus.ASSIGNING_COURIER,
    courierId: null,
    matchedCourierId: courierId,
    pickupLocation: { ...pickupPoint },
    dropoffLocation: { ...dropoffPoint },
    ...overrides,
  })

  beforeEach(() => {
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation()

    mockDeliveryDomainService = {
      getByIdOrThrowWithLocation: jest.fn().mockResolvedValue(makeDelivery()),
    }

    mockOsrmRoutingService = {
      getRoute: jest.fn().mockImplementation(async ({ fromLocation, toLocation }) => ({
        distanceMetres: 1500.4,
        durationSeconds: 300.2,
        points: [fromLocation, toLocation],
      })),
    }

    service = new DeliveryRouteCourierService(
      mockDeliveryDomainService as unknown as DeliveryDomainService,
      mockOsrmRoutingService as unknown as OsrmRoutingService
    )
  })

  afterEach(() => {
    loggerWarnSpy.mockRestore()
  })

  describe('Route visibility and query predicate (AC-1)', () => {
    test('queries delivery using getByIdOrThrowWithLocation with OR: [courierId, matchedCourierId]', async () => {
      const courier = makeCourier()
      await service.getRoute(deliveryId, courier)

      expect(mockDeliveryDomainService.getByIdOrThrowWithLocation).toHaveBeenCalledWith(
        deliveryId,
        {
          OR: [{ courierId: courier.id }, { matchedCourierId: courier.id }],
        }
      )
    })

    test('answers for an open offer to this rider (status ASSIGNING_COURIER and matchedCourierId = courier.id)', async () => {
      const courier = makeCourier()
      mockDeliveryDomainService.getByIdOrThrowWithLocation.mockResolvedValueOnce(
        makeDelivery({
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: courierId,
          courierId: null,
        })
      )

      const result = await service.getRoute(deliveryId, courier)
      expect(result).toBeDefined()
      expect(result.length).toBeGreaterThan(0)
    })

    test.each(DELIVERY_ONGOING_STATUSES)(
      'answers for a held job in ongoing status %s when courierId = courier.id',
      async (status) => {
        const courier = makeCourier()
        mockDeliveryDomainService.getByIdOrThrowWithLocation.mockResolvedValueOnce(
          makeDelivery({
            status,
            courierId,
            matchedCourierId: null,
          })
        )

        const result = await service.getRoute(deliveryId, courier)
        expect(result).toBeDefined()
      }
    )

    test.each([
      EnumDeliveryStatus.DROPPED_OFF,
      EnumDeliveryStatus.CANCELED,
      EnumDeliveryStatus.FAILED,
      EnumDeliveryStatus.CREATED,
    ])('refuses finished or inactive status %s with DeliveryNotFoundException "Delivery not found"', async (status) => {
      const courier = makeCourier()
      mockDeliveryDomainService.getByIdOrThrowWithLocation.mockResolvedValueOnce(
        makeDelivery({
          status,
          courierId,
        })
      )

      const promise = service.getRoute(deliveryId, courier)
      await expect(promise).rejects.toThrow(DeliveryNotFoundException)
      await expect(promise).rejects.toThrow('Delivery not found')
    })

    test('refuses ASSIGNING_COURIER when matchedCourierId is another rider even if courierId happens to match', async () => {
      const courier = makeCourier()
      mockDeliveryDomainService.getByIdOrThrowWithLocation.mockResolvedValueOnce(
        makeDelivery({
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: otherCourierId,
          courierId: courierId,
        })
      )

      const promise = service.getRoute(deliveryId, courier)
      await expect(promise).rejects.toThrow(DeliveryNotFoundException)
      await expect(promise).rejects.toThrow('Delivery not found')
    })

    test('refuses when pickupLocation is null or missing', async () => {
      const courier = makeCourier()
      mockDeliveryDomainService.getByIdOrThrowWithLocation.mockResolvedValueOnce(
        makeDelivery({
          pickupLocation: null,
        })
      )

      const promise = service.getRoute(deliveryId, courier)
      await expect(promise).rejects.toThrow(DeliveryNotFoundException)
      await expect(promise).rejects.toThrow('Delivery not found')
    })

    test('refuses when dropoffLocation is null or missing', async () => {
      const courier = makeCourier()
      mockDeliveryDomainService.getByIdOrThrowWithLocation.mockResolvedValueOnce(
        makeDelivery({
          dropoffLocation: null,
        })
      )

      const promise = service.getRoute(deliveryId, courier)
      await expect(promise).rejects.toThrow(DeliveryNotFoundException)
      await expect(promise).rejects.toThrow('Delivery not found')
    })

    test('turns Prisma record not found error (name NotFoundError) into DeliveryNotFoundException "Delivery not found"', async () => {
      const notFoundError = new Error('Record not found')
      notFoundError.name = 'NotFoundError'
      mockDeliveryDomainService.getByIdOrThrowWithLocation.mockRejectedValueOnce(notFoundError)

      const courier = makeCourier()
      const promise = service.getRoute(deliveryId, courier)
      await expect(promise).rejects.toThrow(DeliveryNotFoundException)
      await expect(promise).rejects.toThrow('Delivery not found')
    })

    test('turns Prisma record not found error (code P2025) into DeliveryNotFoundException "Delivery not found"', async () => {
      const p2025Error = new PrismaClientKnownRequestError(
        'An operation failed because it depends on one or more records that were required but not found',
        { code: 'P2025', clientVersion: '5.3.1' }
      )
      mockDeliveryDomainService.getByIdOrThrowWithLocation.mockRejectedValueOnce(p2025Error)

      const courier = makeCourier()
      const promise = service.getRoute(deliveryId, courier)
      await expect(promise).rejects.toThrow(DeliveryNotFoundException)
      await expect(promise).rejects.toThrow('Delivery not found')
    })

    test('rethrows any other database error without wrapping as DeliveryNotFoundException', async () => {
      const dbError = new Error('Connection pool exhausted')
      mockDeliveryDomainService.getByIdOrThrowWithLocation.mockRejectedValueOnce(dbError)

      const courier = makeCourier()
      await expect(service.getRoute(deliveryId, courier)).rejects.toThrow('Connection pool exhausted')
    })
  })

  describe('Leg generation and ordering (AC-1)', () => {
    const beforePickupStatuses = [
      EnumDeliveryStatus.ASSIGNING_COURIER,
      EnumDeliveryStatus.ACCEPTED,
      EnumDeliveryStatus.DISPATCHED,
      EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
    ]

    test.each(beforePickupStatuses)(
      'before pickup in %s with rider location returns [RIDER_TO_PICKUP, PICKUP_TO_DROPOFF] in that order',
      async (status) => {
        const courier = makeCourier(riderPoint)
        mockDeliveryDomainService.getByIdOrThrowWithLocation.mockResolvedValueOnce(
          makeDelivery({
            status,
            courierId: status === EnumDeliveryStatus.ASSIGNING_COURIER ? null : courierId,
            matchedCourierId: status === EnumDeliveryStatus.ASSIGNING_COURIER ? courierId : null,
          })
        )

        mockOsrmRoutingService.getRoute
          .mockResolvedValueOnce({
            distanceMetres: 1200.2,
            durationSeconds: 240.4,
            points: [riderPoint, pickupPoint],
          })
          .mockResolvedValueOnce({
            distanceMetres: 2800.8,
            durationSeconds: 480.6,
            points: [pickupPoint, dropoffPoint],
          })

        const legs = await service.getRoute(deliveryId, courier)

        expect(legs).toHaveLength(2)
        expect(legs[0]).toEqual({
          kind: DeliveryRouteLegKind.RIDER_TO_PICKUP,
          distanceMetres: 1200,
          durationSeconds: 240,
          points: [riderPoint, pickupPoint],
        })
        expect(legs[1]).toEqual({
          kind: DeliveryRouteLegKind.PICKUP_TO_DROPOFF,
          distanceMetres: 2801,
          durationSeconds: 481,
          points: [pickupPoint, dropoffPoint],
        })

        // Verify OSRM was called with exact leg coordinates
        expect(mockOsrmRoutingService.getRoute).toHaveBeenNthCalledWith(1, {
          fromLocation: riderPoint,
          toLocation: pickupPoint,
        })
        expect(mockOsrmRoutingService.getRoute).toHaveBeenNthCalledWith(2, {
          fromLocation: pickupPoint,
          toLocation: dropoffPoint,
        })
      }
    )

    test.each(beforePickupStatuses)(
      'before pickup in %s with no rider location (null/undefined) returns only [PICKUP_TO_DROPOFF]',
      async (status) => {
        const courier = makeCourierWithoutLocation(null)
        mockDeliveryDomainService.getByIdOrThrowWithLocation.mockResolvedValueOnce(
          makeDelivery({
            status,
            courierId: status === EnumDeliveryStatus.ASSIGNING_COURIER ? null : courierId,
            matchedCourierId: status === EnumDeliveryStatus.ASSIGNING_COURIER ? courierId : null,
          })
        )

        mockOsrmRoutingService.getRoute.mockResolvedValueOnce({
          distanceMetres: 3100.1,
          durationSeconds: 520.9,
          points: [pickupPoint, dropoffPoint],
        })

        const legs = await service.getRoute(deliveryId, courier)

        expect(legs).toHaveLength(1)
        expect(legs[0]).toEqual({
          kind: DeliveryRouteLegKind.PICKUP_TO_DROPOFF,
          distanceMetres: 3100,
          durationSeconds: 521,
          points: [pickupPoint, dropoffPoint],
        })
        expect(mockOsrmRoutingService.getRoute).toHaveBeenCalledTimes(1)
        expect(mockOsrmRoutingService.getRoute).toHaveBeenCalledWith({
          fromLocation: pickupPoint,
          toLocation: dropoffPoint,
        })
      }
    )

    const fromPickupStatuses = [
      EnumDeliveryStatus.PICKED_UP,
      EnumDeliveryStatus.ON_THE_WAY,
      EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
    ]

    test.each(fromPickupStatuses)(
      'from pickup in %s with rider location returns single leg [RIDER_TO_DROPOFF]',
      async (status) => {
        const courier = makeCourier(riderPoint)
        mockDeliveryDomainService.getByIdOrThrowWithLocation.mockResolvedValueOnce(
          makeDelivery({
            status,
            courierId,
          })
        )

        mockOsrmRoutingService.getRoute.mockResolvedValueOnce({
          distanceMetres: 1950.5,
          durationSeconds: 360.5,
          points: [riderPoint, dropoffPoint],
        })

        const legs = await service.getRoute(deliveryId, courier)

        expect(legs).toHaveLength(1)
        expect(legs[0]).toEqual({
          kind: DeliveryRouteLegKind.RIDER_TO_DROPOFF,
          distanceMetres: 1951,
          durationSeconds: 361,
          points: [riderPoint, dropoffPoint],
        })
        expect(mockOsrmRoutingService.getRoute).toHaveBeenCalledTimes(1)
        expect(mockOsrmRoutingService.getRoute).toHaveBeenCalledWith({
          fromLocation: riderPoint,
          toLocation: dropoffPoint,
        })
      }
    )

    test.each(fromPickupStatuses)(
      'from pickup in %s with no rider location (null) returns empty legs []',
      async (status) => {
        const courier = makeCourierWithoutLocation(null)
        mockDeliveryDomainService.getByIdOrThrowWithLocation.mockResolvedValueOnce(
          makeDelivery({
            status,
            courierId,
          })
        )

        const legs = await service.getRoute(deliveryId, courier)

        expect(legs).toEqual([])
        expect(mockOsrmRoutingService.getRoute).not.toHaveBeenCalled()
      }
    )

    test.each(fromPickupStatuses)(
      'from pickup in %s with no rider location (undefined) returns empty legs []',
      async (status) => {
        const courier = makeCourierWithoutLocation(undefined)
        mockDeliveryDomainService.getByIdOrThrowWithLocation.mockResolvedValueOnce(
          makeDelivery({
            status,
            courierId,
          })
        )

        const legs = await service.getRoute(deliveryId, courier)

        expect(legs).toEqual([])
        expect(mockOsrmRoutingService.getRoute).not.toHaveBeenCalled()
      }
    )

    test('rider point comes strictly from passed courier.currentLocation without loading courier again', async () => {
      const distinctLocation = { latitude: 39.3888, longitude: 22.9888 }
      const courier = makeCourier(distinctLocation)

      mockDeliveryDomainService.getByIdOrThrowWithLocation.mockResolvedValueOnce(
        makeDelivery({
          status: EnumDeliveryStatus.PICKED_UP,
          courierId,
        })
      )

      await service.getRoute(deliveryId, courier)

      expect(mockOsrmRoutingService.getRoute).toHaveBeenCalledWith({
        fromLocation: distinctLocation,
        toLocation: dropoffPoint,
      })
    })

    test('rounds distanceMetres and durationSeconds to whole numbers and passes points through', async () => {
      const courier = makeCourier(riderPoint)
      mockDeliveryDomainService.getByIdOrThrowWithLocation.mockResolvedValueOnce(
        makeDelivery({
          status: EnumDeliveryStatus.PICKED_UP,
          courierId,
        })
      )

      const complexPoints = [
        { latitude: 39.361, longitude: 22.941 },
        { latitude: 39.365, longitude: 22.947 },
        { latitude: 39.372, longitude: 22.955 },
      ]

      mockOsrmRoutingService.getRoute.mockResolvedValueOnce({
        distanceMetres: 1499.7,
        durationSeconds: 299.4,
        points: complexPoints,
      })

      const legs = await service.getRoute(deliveryId, courier)

      expect(legs[0]!.distanceMetres).toBe(1500)
      expect(legs[0]!.durationSeconds).toBe(299)
      expect(legs[0]!.points).toBe(complexPoints)
    })
  })

  describe('OSRM error translation and redaction (AC-2, AC-3, Value 5)', () => {
    test.each([
      ['ServiceUnavailableException', new ServiceUnavailableException('Road distances are not available right now, so this cannot be priced. Try again in a minute.')],
      ['EnvVarMissingException', new EnvVarMissingException('OSRM_URL')],
      ['plain Error', new Error('ECONNRESET: socket hang up')],
      ['string error', 'unexpected string thrown'],
    ])('translates %s to ServiceUnavailableException with ROUTE_UNAVAILABLE_MESSAGE and logs deliveryId without coordinates', async (_type, thrownError) => {
      const courier = makeCourier(riderPoint)
      mockDeliveryDomainService.getByIdOrThrowWithLocation.mockResolvedValueOnce(
        makeDelivery({
          status: EnumDeliveryStatus.ACCEPTED,
          courierId,
        })
      )

      mockOsrmRoutingService.getRoute.mockRejectedValueOnce(thrownError)

      const promise = service.getRoute(deliveryId, courier)

      await expect(promise).rejects.toThrow(ServiceUnavailableException)
      await expect(promise).rejects.toThrow(ROUTE_UNAVAILABLE_MESSAGE)
      await expect(promise).rejects.toThrow("The route can't be drawn right now.")

      // Logger warn must include deliveryId
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Route for delivery ${deliveryId} unavailable:`)
      )

      // Privacy check: logger must NOT contain coordinate values (rider, pickup, dropoff)
      const loggedMessage = loggerWarnSpy.mock.calls[0][0]
      expect(loggedMessage).not.toContain('39.361')
      expect(loggedMessage).not.toContain('22.941')
      expect(loggedMessage).not.toContain('39.365')
      expect(loggedMessage).not.toContain('22.945')
      expect(loggedMessage).not.toContain('39.372')
      expect(loggedMessage).not.toContain('22.955')
    })
  })
})
