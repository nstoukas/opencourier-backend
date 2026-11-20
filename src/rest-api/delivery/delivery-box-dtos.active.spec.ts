import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { validate } from 'class-validator'
import { BoxSize, EnumDeliveryStatus, EnumDeliveryEventType } from '@prisma/types'
import { ResponseFormatMiddleware } from 'src/middleware/ResponseFormatMiddleware'
import { Request, Response } from 'express'
import { DeliverySubmitEventAdminInput } from './admin/queries/delivery-submit-event.admin.input'
import { DeliveryReassignAdminInput } from './admin/queries/delivery-reassign.admin.input'
import { DeliveryCreatePartnerInput } from './partner/queries/delivery-create.partner.input'
import { DeliveryUpdatePartnerInput } from './partner/queries/delivery-update.partner.input'
import { DeliveryCourierDto } from './courier/dtos/delivery.courier.dto'
import { DeliveryPartnerDto } from './partner/dtos/delivery.partner.dto'
import { DeliveryAdminDto } from './admin/dtos/delivery.admin.dto'
import { buildOfferCardPayload } from 'src/domains/delivery/offer-card-payload'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'

/**
 * Spec 0043 (Row 9) - Box Model: DTOs, Validation & Error Response (AC-6, AC-7)
 */
describe('Box Model: DTOs, Validation & Error Response (AC-6, AC-7)', () => {
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  })

  describe('ResponseFormatMiddleware (AC-6)', () => {
    let middleware: ResponseFormatMiddleware

    beforeEach(() => {
      middleware = new ResponseFormatMiddleware()
    })

    test('passes heldUnits and deliveryUnits through on an error response', () => {
      const req = {} as Request
      let responseBody: any
      const res = {
        statusCode: 409,
        json: function (body: any) {
          responseBody = body
        },
      } as unknown as Response

      const next = jest.fn()
      middleware.use(req, res, next)
      expect(next).toHaveBeenCalled()

      res.json({
        code: 'BOX_OVER_CAPACITY',
        message: 'This would put the rider past a full box: they hold 70 of 100 units and this order takes 40.',
        heldUnits: 70,
        deliveryUnits: 40,
        extraSecretField: 'should-not-leak',
      })

      expect(responseBody).toEqual({
        error: true,
        result: [
          {
            code: 'BOX_OVER_CAPACITY',
            message: 'This would put the rider past a full box: they hold 70 of 100 units and this order takes 40.',
            statusCode: 409,
            heldUnits: 70,
            deliveryUnits: 40,
          },
        ],
      })
      // Ensure nothing else new leaked through
      expect(responseBody.result[0].extraSecretField).toBeUndefined()
    })

    test('omits heldUnits and deliveryUnits when not numbers', () => {
      const req = {} as Request
      let responseBody: any
      const res = {
        statusCode: 400,
        json: function (body: any) {
          responseBody = body
        },
      } as unknown as Response

      middleware.use(req, res, jest.fn())

      res.json({
        code: 'BAD_REQUEST',
        message: 'Some error',
        heldUnits: 'not-a-number',
      })

      expect(responseBody.result[0].heldUnits).toBeUndefined()
      expect(responseBody.result[0].deliveryUnits).toBeUndefined()
    })
  })

  describe('DTO Boolean Guard: @RefuseIfNotSentAsBoolean() on confirmOverCapacity (AC-6)', () => {
    describe('DeliverySubmitEventAdminInput', () => {
      test('refuses text "true" and "false"', async () => {
        await expect(
          pipe.transform(
            { deliveryId: 'del-1', eventType: EnumDeliveryEventType.ACCEPTED, confirmOverCapacity: 'true' },
            { type: 'body', metatype: DeliverySubmitEventAdminInput }
          )
        ).rejects.toThrow(new BadRequestException('confirmOverCapacity must be sent as true or false'))

        await expect(
          pipe.transform(
            { deliveryId: 'del-1', eventType: EnumDeliveryEventType.ACCEPTED, confirmOverCapacity: 'false' },
            { type: 'body', metatype: DeliverySubmitEventAdminInput }
          )
        ).rejects.toThrow(new BadRequestException('confirmOverCapacity must be sent as true or false'))
      })

      test('accepts boolean true and boolean false', async () => {
        const outTrue = await pipe.transform(
          { deliveryId: 'del-1', eventType: EnumDeliveryEventType.ACCEPTED, confirmOverCapacity: true },
          { type: 'body', metatype: DeliverySubmitEventAdminInput }
        )
        expect(outTrue.confirmOverCapacity).toBe(true)

        const outFalse = await pipe.transform(
          { deliveryId: 'del-1', eventType: EnumDeliveryEventType.ACCEPTED, confirmOverCapacity: false },
          { type: 'body', metatype: DeliverySubmitEventAdminInput }
        )
        expect(outFalse.confirmOverCapacity).toBe(false)
      })

      test('accepts omitted/undefined confirmOverCapacity', async () => {
        const out = await pipe.transform(
          { deliveryId: 'del-1', eventType: EnumDeliveryEventType.ACCEPTED },
          { type: 'body', metatype: DeliverySubmitEventAdminInput }
        )
        expect(out.confirmOverCapacity).toBeUndefined()
      })
    })

    describe('DeliveryReassignAdminInput', () => {
      test('refuses text "true" and "false"', async () => {
        await expect(
          pipe.transform(
            { courierId: 'courier-1', confirmOverCapacity: 'true' },
            { type: 'body', metatype: DeliveryReassignAdminInput }
          )
        ).rejects.toThrow(new BadRequestException('confirmOverCapacity must be sent as true or false'))

        await expect(
          pipe.transform(
            { courierId: 'courier-1', confirmOverCapacity: 'false' },
            { type: 'body', metatype: DeliveryReassignAdminInput }
          )
        ).rejects.toThrow(new BadRequestException('confirmOverCapacity must be sent as true or false'))
      })

      test('accepts boolean true and boolean false', async () => {
        const outTrue = await pipe.transform(
          { courierId: 'courier-1', confirmOverCapacity: true },
          { type: 'body', metatype: DeliveryReassignAdminInput }
        )
        expect(outTrue.confirmOverCapacity).toBe(true)

        const outFalse = await pipe.transform(
          { courierId: 'courier-1', confirmOverCapacity: false },
          { type: 'body', metatype: DeliveryReassignAdminInput }
        )
        expect(outFalse.confirmOverCapacity).toBe(false)
      })
    })
  })

  describe('Partner DTO validation on boxSize (AC-3)', () => {
    test('DeliveryCreatePartnerInput accepts valid BoxSize and undefined, rejects invalid size', async () => {
      const input = new DeliveryCreatePartnerInput()
      input.boxSize = BoxSize.SMALL
      let errors = await validate(input)
      expect(errors.filter((e) => e.property === 'boxSize')).toHaveLength(0)

      input.boxSize = undefined
      errors = await validate(input)
      expect(errors.filter((e) => e.property === 'boxSize')).toHaveLength(0)

      input.boxSize = 'EXTRA_LARGE' as any
      errors = await validate(input)
      expect(errors.find((e) => e.property === 'boxSize')?.constraints?.isEnum).toBeDefined()
    })

    test('DeliveryUpdatePartnerInput accepts valid BoxSize and undefined, rejects invalid size', async () => {
      const input = new DeliveryUpdatePartnerInput()
      input.boxSize = BoxSize.MEDIUM
      let errors = await validate(input)
      expect(errors.filter((e) => e.property === 'boxSize')).toHaveLength(0)

      input.boxSize = undefined
      errors = await validate(input)
      expect(errors.filter((e) => e.property === 'boxSize')).toHaveLength(0)

      input.boxSize = 'EXTRA_LARGE' as any
      errors = await validate(input)
      expect(errors.find((e) => e.property === 'boxSize')?.constraints?.isEnum).toBeDefined()
    })
  })

  describe('AC-7 (backend half): DTO and Offer Card Payload Fields', () => {
    const sampleDelivery = new DeliveryEntity({
      id: 'del-dto-1',
      status: EnumDeliveryStatus.CREATED,
      pickupLocationId: 'loc-pickup',
      dropoffLocationId: 'loc-dropoff',
      boxSize: BoxSize.LARGE,
      boxUnits: 100,
      boxSizeAssumed: false,
      items: [],
      deliveryNumber: '101',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any)

    test('buildOfferCardPayload carries boxSize', () => {
      const payload = buildOfferCardPayload(
        {
          delivery: sampleDelivery,
          dropoffLocation: { street: 'Iasonos', houseNumber: '1', city: 'Volos' },
          quote: { distance: 1.5, distanceUnit: 'KM' as any },
          trip: { toPickupMetres: 1200, toDropoffMetres: 2400, minutes: 12 },
        },
        { serverNow: new Date() }
      )
      expect(payload.boxSize).toBe(BoxSize.LARGE)
    })

    test('DeliveryCourierDto carries boxSize', () => {
      const dto = new DeliveryCourierDto(sampleDelivery)
      expect(dto.boxSize).toBe(BoxSize.LARGE)
    })

    test('DeliveryPartnerDto carries boxSize', () => {
      const dto = new DeliveryPartnerDto(sampleDelivery)
      expect(dto.boxSize).toBe(BoxSize.LARGE)
    })

    test('DeliveryAdminDto carries boxSize, boxUnits, and boxSizeAssumed', () => {
      const dto = new DeliveryAdminDto(sampleDelivery)
      expect(dto.boxSize).toBe(BoxSize.LARGE)
      expect(dto.boxUnits).toBe(100)
      expect(dto.boxSizeAssumed).toBe(false)
    })
  })
})
