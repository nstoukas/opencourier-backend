import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { EnumCancelledBy } from '@prisma/types'
import { DeliveryCancelPartnerInput } from './delivery-cancel.partner.input'
import { DeliveryPartnerRestApiService } from '../delivery.partner.rest-api.service'
import { DeliveryNotFoundException } from 'src/errors'

describe('DeliveryCancelPartnerInput and partner cancel (Spec 0015 AC-5)', () => {
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  })

  describe('Input validation with ValidationPipe', () => {
    it('accepts empty body and leaves cancelledBy undefined', async () => {
      const result = (await pipe.transform(
        {},
        { type: 'body', metatype: DeliveryCancelPartnerInput }
      )) as DeliveryCancelPartnerInput

      expect(result.cancelledBy).toBeUndefined()
    })

    it('accepts cancelledBy = RESTAURANT', async () => {
      const result = (await pipe.transform(
        { cancelledBy: EnumCancelledBy.RESTAURANT },
        { type: 'body', metatype: DeliveryCancelPartnerInput }
      )) as DeliveryCancelPartnerInput

      expect(result.cancelledBy).toBe(EnumCancelledBy.RESTAURANT)
    })

    it('accepts cancelledBy = CUSTOMER', async () => {
      const result = (await pipe.transform(
        { cancelledBy: EnumCancelledBy.CUSTOMER },
        { type: 'body', metatype: DeliveryCancelPartnerInput }
      )) as DeliveryCancelPartnerInput

      expect(result.cancelledBy).toBe(EnumCancelledBy.CUSTOMER)
    })

    it('refuses cancelledBy = COOP with BadRequestException (400)', async () => {
      await expect(
        pipe.transform(
          { cancelledBy: EnumCancelledBy.COOP },
          { type: 'body', metatype: DeliveryCancelPartnerInput }
        )
      ).rejects.toThrow(BadRequestException)
    })

    it('refuses cancelledBy: null with BadRequestException (400) (not @IsOptional, row 32 review)', async () => {
      await expect(
        pipe.transform(
          { cancelledBy: null },
          { type: 'body', metatype: DeliveryCancelPartnerInput }
        )
      ).rejects.toThrow(BadRequestException)
    })

    it('refuses invalid strings and non-enum values with BadRequestException (400)', async () => {
      for (const badValue of ['JUNK', 'admin', 'restaurant', 123, true, []]) {
        await expect(
          pipe.transform(
            { cancelledBy: badValue },
            { type: 'body', metatype: DeliveryCancelPartnerInput }
          )
        ).rejects.toThrow(BadRequestException)
      }
    })
  })

  describe('DeliveryPartnerRestApiService.cancel', () => {
    let service: DeliveryPartnerRestApiService
    let mockDeliveryDomainService: any

    const deliveryId = 'del-cancel-p1'
    const partnerId = 'partner-1'

    beforeEach(() => {
      mockDeliveryDomainService = {
        getByIdOrThrow: jest.fn().mockResolvedValue({
          id: deliveryId,
          partnerId,
        }),
        cancelDelivery: jest.fn().mockResolvedValue({
          id: deliveryId,
          partnerId,
          cancelledBy: EnumCancelledBy.RESTAURANT,
        }),
      }

      service = new DeliveryPartnerRestApiService(
        {} as any,
        mockDeliveryDomainService,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any
      )
    })

    it('cancels delivery defaulting cancelledBy to RESTAURANT', async () => {
      await service.cancel(deliveryId, partnerId)

      expect(mockDeliveryDomainService.getByIdOrThrow).toHaveBeenCalledWith(deliveryId)
      expect(mockDeliveryDomainService.cancelDelivery).toHaveBeenCalledWith(deliveryId, EnumCancelledBy.RESTAURANT)
    })

    it('turns null cancelledBy into RESTAURANT (??, never into COOP)', async () => {
      await service.cancel(deliveryId, partnerId, null as any)

      expect(mockDeliveryDomainService.cancelDelivery).toHaveBeenCalledWith(
        deliveryId,
        EnumCancelledBy.RESTAURANT
      )
    })

    it('turns undefined cancelledBy into RESTAURANT (??, never into COOP)', async () => {
      await service.cancel(deliveryId, partnerId, undefined)

      expect(mockDeliveryDomainService.cancelDelivery).toHaveBeenCalledWith(
        deliveryId,
        EnumCancelledBy.RESTAURANT
      )
    })

    it('cancels delivery with explicit cancelledBy CUSTOMER', async () => {
      await service.cancel(deliveryId, partnerId, EnumCancelledBy.CUSTOMER)

      expect(mockDeliveryDomainService.cancelDelivery).toHaveBeenCalledWith(deliveryId, EnumCancelledBy.CUSTOMER)
    })

    it('throws DeliveryNotFoundException (404) if delivery belongs to another partner', async () => {
      mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce({
        id: deliveryId,
        partnerId: 'other-partner',
      })

      await expect(service.cancel(deliveryId, partnerId)).rejects.toThrow(DeliveryNotFoundException)
      expect(mockDeliveryDomainService.cancelDelivery).not.toHaveBeenCalled()
    })
  })
})
