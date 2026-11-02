import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { RequestMethod } from '@nestjs/common'
import { EnumUserRole } from '@prisma/types'
import { ROLES_KEY } from 'src/decorators/roles.decorator'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { DeliveryRouteCourierRestApiController } from './route.courier.rest-api.controller'
import { DeliveryRouteCourierService, DeliveryRouteLeg } from './route.courier.service'
import { DeliveryRouteCourierDto, DeliveryRouteLegKind } from './dtos/delivery-route.courier.dto'
import { DeliveryCourierRestApiModule } from './delivery.courier.rest-api.module'
import { DeliveryCourierRestApiController } from './delivery.courier.rest-api.controller'

describe('DeliveryRouteCourierRestApiController (Spec 0018 AC-1, AC-2)', () => {
  let controller: DeliveryRouteCourierRestApiController
  let mockService: { getRoute: jest.Mock }

  const courier = new CourierEntity({ id: 'courier-r69' } as any)
  const deliveryId = 'del-route-1'

  beforeEach(() => {
    mockService = {
      getRoute: jest.fn(),
    }
    controller = new DeliveryRouteCourierRestApiController(
      mockService as unknown as DeliveryRouteCourierService
    )
  })

  test('delegates to deliveryRouteCourierService.getRoute with deliveryId and courier, wrapping legs in DeliveryRouteCourierDto', async () => {
    const mockLegs: DeliveryRouteLeg[] = [
      {
        kind: DeliveryRouteLegKind.RIDER_TO_PICKUP,
        distanceMetres: 1250,
        durationSeconds: 240,
        points: [
          { latitude: 39.362, longitude: 22.942 },
          { latitude: 39.365, longitude: 22.945 },
        ],
      },
      {
        kind: DeliveryRouteLegKind.PICKUP_TO_DROPOFF,
        distanceMetres: 2800,
        durationSeconds: 480,
        points: [
          { latitude: 39.365, longitude: 22.945 },
          { latitude: 39.372, longitude: 22.955 },
        ],
      },
    ]

    mockService.getRoute.mockResolvedValueOnce(mockLegs)

    const result = await controller.getRoute(deliveryId, courier)

    expect(mockService.getRoute).toHaveBeenCalledWith(deliveryId, courier)
    expect(result).toBeInstanceOf(DeliveryRouteCourierDto)
    expect(result.legs).toEqual(mockLegs)
  })

  test('endpoint is decorated with @Roles(COURIER)', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, controller.getRoute)
    expect(roles).toEqual([EnumUserRole.COURIER])
  })

  test('endpoint is routed at PATH :deliveryId/route with METHOD GET', () => {
    const path = Reflect.getMetadata(PATH_METADATA, controller.getRoute)
    const method = Reflect.getMetadata(METHOD_METADATA, controller.getRoute)
    expect(path).toBe(':deliveryId/route')
    expect(method).toBe(RequestMethod.GET)
  })

  test('DeliveryCourierRestApiModule registers DeliveryRouteCourierRestApiController before DeliveryCourierRestApiController', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, DeliveryCourierRestApiModule) || []
    const routeControllerIndex = controllers.indexOf(DeliveryRouteCourierRestApiController)
    const deliveryControllerIndex = controllers.indexOf(DeliveryCourierRestApiController)

    expect(routeControllerIndex).toBeGreaterThan(-1)
    expect(deliveryControllerIndex).toBeGreaterThan(-1)
    expect(routeControllerIndex).toBeLessThan(deliveryControllerIndex)
  })
})
