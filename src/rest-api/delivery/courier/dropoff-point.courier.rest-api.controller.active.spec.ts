import { DropoffPointCourierRestApiController } from './dropoff-point.courier.rest-api.controller'
import { DropoffPointCourierService } from './dropoff-point.courier.service'
import { DropoffPointCourierDto } from './dtos/dropoff-point.courier.dto'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'

describe('DropoffPointCourierRestApiController (Spec 0016 AC-9)', () => {
  let controller: DropoffPointCourierRestApiController
  let service: jest.Mocked<DropoffPointCourierService>

  const courier = new CourierEntity({ id: 'courier-123' } as any)
  const deliveryId = 'del-456'
  const input = { latitude: 39.365, longitude: 22.948 }

  beforeEach(() => {
    service = {
      correct: jest.fn(),
    } as any

    controller = new DropoffPointCourierRestApiController(service)
  })

  it('delegates to service.correct with deliveryId, courier.id, input and returns DropoffPointCourierDto', async () => {
    service.correct.mockResolvedValue({
      savedCustomerUpdated: true,
      distanceMetres: 141,
    })

    const result = await controller.correctDropoffPoint(deliveryId, input, courier)

    expect(service.correct).toHaveBeenCalledWith(deliveryId, 'courier-123', input)
    expect(result).toBeInstanceOf(DropoffPointCourierDto)
    expect(result.savedCustomerUpdated).toBe(true)
    expect(result.distanceMetres).toBe(141)
  })
})
