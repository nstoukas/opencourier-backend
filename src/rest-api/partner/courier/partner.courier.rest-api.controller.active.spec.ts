import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { RequestMethod } from '@nestjs/common'
import { EnumUserRole } from '@prisma/types'
import { ROLES_KEY } from 'src/decorators/roles.decorator'
import { PartnerDomainService } from 'src/domains/partner/partner.domain.service'
import { PartnerDomainModule } from 'src/domains/partner/partner.domain.module'
import { CourierRestApiModule } from 'src/rest-api/courier.rest-api.module'
import { PartnerCourierRestApiController } from './partner.courier.rest-api.controller'
import { PartnerCourierRestApiModule } from './partner.courier.rest-api.module'
import { PickupPointCourierDto } from './dtos/pickup-point.courier.dto'

describe('PartnerCourierRestApiController (Spec 0018 AC-4)', () => {
  let controller: PartnerCourierRestApiController
  let mockPartnerDomainService: { getPickupPoints: jest.Mock }

  beforeEach(() => {
    mockPartnerDomainService = {
      getPickupPoints: jest.fn(),
    }

    controller = new PartnerCourierRestApiController(
      mockPartnerDomainService as unknown as PartnerDomainService
    )
  })

  test('answers [{ id, name, latitude, longitude }] as PickupPointCourierDto instances and nothing else', async () => {
    const rawPoints = [
      {
        id: 'partner-10',
        name: 'Nosh Restaurant',
        latitude: 39.3621,
        longitude: 22.9427,
        // Any extra database fields that must NOT leak into the DTO
        phone: '+302421012345',
        address: 'Iasonos 45',
        userId: 'user-p10',
      },
      {
        id: 'partner-20',
        name: 'Volos Grill',
        latitude: 39.3688,
        longitude: 22.9511,
      },
    ]

    mockPartnerDomainService.getPickupPoints.mockResolvedValueOnce(rawPoints)

    const result = await controller.getPickupPoints()

    expect(mockPartnerDomainService.getPickupPoints).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(2)

    expect(result[0]).toBeInstanceOf(PickupPointCourierDto)
    expect(result[0]).toEqual({
      id: 'partner-10',
      name: 'Nosh Restaurant',
      latitude: 39.3621,
      longitude: 22.9427,
    })
    // Ensure no phone, address or user data leaks
    expect((result[0] as any).phone).toBeUndefined()
    expect((result[0] as any).address).toBeUndefined()
    expect((result[0] as any).userId).toBeUndefined()

    expect(result[1]).toBeInstanceOf(PickupPointCourierDto)
    expect(result[1]).toEqual({
      id: 'partner-20',
      name: 'Volos Grill',
      latitude: 39.3688,
      longitude: 22.9511,
    })
  })

  test('endpoint is decorated with @Roles(COURIER)', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, controller.getPickupPoints)
    expect(roles).toEqual([EnumUserRole.COURIER])
  })

  test('endpoint is routed at PATH pickup-points with METHOD GET', () => {
    const path = Reflect.getMetadata(PATH_METADATA, controller.getPickupPoints)
    const method = Reflect.getMetadata(METHOD_METADATA, controller.getPickupPoints)
    expect(path).toBe('pickup-points')
    expect(method).toBe(RequestMethod.GET)
  })

  test('PartnerCourierRestApiModule registers PartnerCourierRestApiController and imports PartnerDomainModule', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, PartnerCourierRestApiModule) || []
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, PartnerCourierRestApiModule) || []

    expect(controllers).toContain(PartnerCourierRestApiController)
    expect(imports).toContain(PartnerDomainModule)
  })

  test('CourierRestApiModule imports PartnerCourierRestApiModule', () => {
    const courierImports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, CourierRestApiModule) || []
    expect(courierImports).toContain(PartnerCourierRestApiModule)
  })
})
