import { Reflector } from '@nestjs/core'
import { ConfigCourierRestApiController } from './config.courier.rest-api.controller'
import { ConfigDomainService } from '../../../domains/config/config.domain.service'
import { ContactCourierDto } from './dtos/contact.courier.dto'
import { IS_PUBLIC_KEY } from '../../../decorators/public.decorator'

describe('ConfigCourierRestApiController (row 72, spec 0021 AC-2/AC-11)', () => {
  let controller: ConfigCourierRestApiController
  let mockInstanceConfig: {
    getDispatchPhoneNumber: jest.Mock
    getArrivalRadiusMetres: jest.Mock
  }
  let mockConfigDomainService: ConfigDomainService

  beforeEach(() => {
    mockInstanceConfig = {
      getDispatchPhoneNumber: jest.fn(),
      getArrivalRadiusMetres: jest.fn(),
    }

    mockConfigDomainService = {
      instanceConfig: mockInstanceConfig,
    } as unknown as ConfigDomainService

    controller = new ConfigCourierRestApiController(mockConfigDomainService)
  })

  describe('GET /config/contact (getContact)', () => {
    it('answers ContactCourierDto with dispatchPhoneNumber and arrivalRadiusMetres from instance config service', async () => {
      mockInstanceConfig.getDispatchPhoneNumber.mockResolvedValue('+302421012345')
      mockInstanceConfig.getArrivalRadiusMetres.mockResolvedValue(50)

      const result = await controller.getContact()

      expect(mockInstanceConfig.getDispatchPhoneNumber).toHaveBeenCalledTimes(1)
      expect(mockInstanceConfig.getArrivalRadiusMetres).toHaveBeenCalledTimes(1)
      expect(result).toBeInstanceOf(ContactCourierDto)
      expect(result.dispatchPhoneNumber).toBe('+302421012345')
      expect(result.arrivalRadiusMetres).toBe(50)
    })

    it('answers ContactCourierDto with null dispatch number and 0 arrival radius when configured', async () => {
      mockInstanceConfig.getDispatchPhoneNumber.mockResolvedValue(null)
      mockInstanceConfig.getArrivalRadiusMetres.mockResolvedValue(0)

      const result = await controller.getContact()

      expect(mockInstanceConfig.getDispatchPhoneNumber).toHaveBeenCalledTimes(1)
      expect(mockInstanceConfig.getArrivalRadiusMetres).toHaveBeenCalledTimes(1)
      expect(result).toBeInstanceOf(ContactCourierDto)
      expect(result.dispatchPhoneNumber).toBeNull()
      expect(result.arrivalRadiusMetres).toBe(0)
    })

    it('is not decorated with @Public (only signed-in couriers can read it)', () => {
      const reflector = new Reflector()
      const isPublic = reflector.get<boolean>(IS_PUBLIC_KEY, controller.getContact)
      expect(isPublic).toBeUndefined()
    })
  })

  describe('ContactCourierDto', () => {
    it('constructs with a phone number and arrival radius', () => {
      const dtoWithNumber = new ContactCourierDto({
        dispatchPhoneNumber: '+302421012345',
        arrivalRadiusMetres: 50,
      })
      expect(dtoWithNumber.dispatchPhoneNumber).toBe('+302421012345')
      expect(dtoWithNumber.arrivalRadiusMetres).toBe(50)

      const dtoWithNull = new ContactCourierDto({
        dispatchPhoneNumber: null,
        arrivalRadiusMetres: 0,
      })
      expect(dtoWithNull.dispatchPhoneNumber).toBeNull()
      expect(dtoWithNull.arrivalRadiusMetres).toBe(0)
    })
  })
})
