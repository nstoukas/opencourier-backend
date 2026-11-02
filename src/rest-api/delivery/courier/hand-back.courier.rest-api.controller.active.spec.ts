import { METHOD_METADATA, PATH_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants'
import { RequestMethod } from '@nestjs/common'
import { EnumDeliveryStatus, EnumUserRole } from '@prisma/types'
import { HandBackCourierRestApiController } from './hand-back.courier.rest-api.controller'
import { HandBackCourierService } from './hand-back.courier.service'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { ROLES_KEY } from 'src/decorators/roles.decorator'

describe('HandBackCourierRestApiController (Spec 0020 AC-5)', () => {
  let controller: HandBackCourierRestApiController
  let mockHandBackCourierService: jest.Mocked<HandBackCourierService>

  const mockCourier = {
    id: 'courier-123',
    firstName: 'Alexandros',
    lastName: 'Iordanidis',
  } as CourierEntity

  const deliveryId = 'del-xyz-456'

  beforeEach(() => {
    mockHandBackCourierService = {
      handBack: jest.fn().mockResolvedValue({ status: EnumDeliveryStatus.ASSIGNING_COURIER }),
    } as unknown as jest.Mocked<HandBackCourierService>

    controller = new HandBackCourierRestApiController(mockHandBackCourierService)
  })

  test('calls handBackCourierService.handBack with deliveryId and courierId, returning 200 result', async () => {
    const result = await controller.handBack(deliveryId, mockCourier)

    expect(mockHandBackCourierService.handBack).toHaveBeenCalledWith(deliveryId, mockCourier.id)
    expect(result).toEqual({ status: EnumDeliveryStatus.ASSIGNING_COURIER })
  })

  test('handBack method has @Post(":deliveryId/hand-back") and @HttpCode(200)', () => {
    const path = Reflect.getMetadata(PATH_METADATA, controller.handBack)
    const method = Reflect.getMetadata(METHOD_METADATA, controller.handBack)
    const httpCode = Reflect.getMetadata(HTTP_CODE_METADATA, controller.handBack)

    expect(path).toBe(':deliveryId/hand-back')
    expect(method).toBe(RequestMethod.POST)
    expect(httpCode).toBe(200)
  })

  test('handBack method carries @Roles(EnumUserRole.COURIER) decorator metadata', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, controller.handBack)
    expect(roles).toEqual([EnumUserRole.COURIER])
  })
})
