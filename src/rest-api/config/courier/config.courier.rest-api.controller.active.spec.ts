import { Reflector } from '@nestjs/core'
import { ConfigCourierRestApiController } from './config.courier.rest-api.controller'
import { ConfigDomainService } from '../../../domains/config/config.domain.service'
import { ContactCourierDto } from './dtos/contact.courier.dto'
import { IS_PUBLIC_KEY } from '../../../decorators/public.decorator'

describe('ConfigCourierRestApiController (row 72, decision 72.2)', () => {
  let controller: ConfigCourierRestApiController
  let mockInstanceConfig: { getDispatchPhoneNumber: jest.Mock }
  let mockConfigDomainService: ConfigDomainService

  beforeEach(() => {
    mockInstanceConfig = {
      getDispatchPhoneNumber: jest.fn(),
    }

    mockConfigDomainService = {
      instanceConfig: mockInstanceConfig,
    } as unknown as ConfigDomainService

    controller = new ConfigCourierRestApiController(mockConfigDomainService)
  })

  describe('GET /config/contact (getContact)', () => {
    it('answers ContactCourierDto with dispatchPhoneNumber from instance config service', async () => {
      mockInstanceConfig.getDispatchPhoneNumber.mockResolvedValue('+302421012345')

      const result = await controller.getContact()

      expect(mockInstanceConfig.getDispatchPhoneNumber).toHaveBeenCalledTimes(1)
      expect(result).toBeInstanceOf(ContactCourierDto)
      expect(result.dispatchPhoneNumber).toBe('+302421012345')
    })

    it('answers ContactCourierDto with null when no dispatch number is configured', async () => {
      mockInstanceConfig.getDispatchPhoneNumber.mockResolvedValue(null)

      const result = await controller.getContact()

      expect(mockInstanceConfig.getDispatchPhoneNumber).toHaveBeenCalledTimes(1)
      expect(result).toBeInstanceOf(ContactCourierDto)
      expect(result.dispatchPhoneNumber).toBeNull()
    })

    it('is not decorated with @Public (only signed-in couriers can read it)', () => {
      const reflector = new Reflector()
      const isPublic = reflector.get<boolean>(IS_PUBLIC_KEY, controller.getContact)
      expect(isPublic).toBeUndefined()
    })
  })

  describe('ContactCourierDto', () => {
    it('constructs with a phone number or null', () => {
      const dtoWithNumber = new ContactCourierDto({ dispatchPhoneNumber: '+302421012345' })
      expect(dtoWithNumber.dispatchPhoneNumber).toBe('+302421012345')

      const dtoWithNull = new ContactCourierDto({ dispatchPhoneNumber: null })
      expect(dtoWithNull.dispatchPhoneNumber).toBeNull()
    })
  })
})
