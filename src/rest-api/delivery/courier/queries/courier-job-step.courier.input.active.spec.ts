import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { ValidationPipe } from '@nestjs/common'
import { CourierJobStepCourierInput } from './courier-job-step.courier.input'
import { MarkDeliveryAsPickedUpCourierInput } from './mark-delivery-as-picked-up.courier.input'
import { MarkDeliveryAsDeliveredCourierInput } from './mark-delivery-as-delivered.courier.input'

describe('CourierJobStepCourierInput & child inputs (Spec 0009, AC-7 bounds)', () => {
  // Test all 3 classes: the base input and the two inputs extending it
  const inputClasses = [
    { name: 'CourierJobStepCourierInput', cls: CourierJobStepCourierInput },
    { name: 'MarkDeliveryAsPickedUpCourierInput', cls: MarkDeliveryAsPickedUpCourierInput },
    { name: 'MarkDeliveryAsDeliveredCourierInput', cls: MarkDeliveryAsDeliveredCourierInput },
  ]

  // ValidationPipe matching global pipe options in src/main.ts
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  })

  inputClasses.forEach(({ name, cls }) => {
    describe(name, () => {
      test('accepts tapAgeMs of 0 (sent immediately)', async () => {
        const instance = plainToInstance(cls, { tapAgeMs: 0 })
        const errors = await validate(instance)
        expect(errors.filter((e) => e.property === 'tapAgeMs')).toHaveLength(0)
      })

      test('accepts tapAgeMs at maximum limit (604800000 ms = 7 days)', async () => {
        const instance = plainToInstance(cls, { tapAgeMs: 604800000 })
        const errors = await validate(instance)
        expect(errors.filter((e) => e.property === 'tapAgeMs')).toHaveLength(0)
      })

      test('accepts absent / undefined tapAgeMs (online / older app)', async () => {
        const instance = plainToInstance(cls, {})
        const errors = await validate(instance)
        expect(errors.filter((e) => e.property === 'tapAgeMs')).toHaveLength(0)
      })

      test('refuses negative tapAgeMs (-1)', async () => {
        const instance = plainToInstance(cls, { tapAgeMs: -1 })
        const errors = await validate(instance)
        const tapErrors = errors.filter((e) => e.property === 'tapAgeMs')
        expect(tapErrors.length).toBeGreaterThan(0)
        expect(tapErrors[0]?.constraints).toHaveProperty('min')
      })

      test('refuses non-integer tapAgeMs (1.5)', async () => {
        const instance = plainToInstance(cls, { tapAgeMs: 1.5 })
        const errors = await validate(instance)
        const tapErrors = errors.filter((e) => e.property === 'tapAgeMs')
        expect(tapErrors.length).toBeGreaterThan(0)
        expect(tapErrors[0]?.constraints).toHaveProperty('isInt')
      })

      test('refuses tapAgeMs exceeding 7 days (604800001)', async () => {
        const instance = plainToInstance(cls, { tapAgeMs: 604800001 })
        const errors = await validate(instance)
        const tapErrors = errors.filter((e) => e.property === 'tapAgeMs')
        expect(tapErrors.length).toBeGreaterThan(0)
        expect(tapErrors[0]?.constraints).toHaveProperty('max')
      })

      test('refuses string tapAgeMs ("not-a-number")', async () => {
        const instance = plainToInstance(cls, { tapAgeMs: 'not-a-number' as any })
        const errors = await validate(instance)
        const tapErrors = errors.filter((e) => e.property === 'tapAgeMs')
        expect(tapErrors.length).toBeGreaterThan(0)
        expect(tapErrors[0]?.constraints).toHaveProperty('isInt')
      })

      test('ValidationPipe rejects invalid tapAgeMs with 400 BadRequestException', async () => {
        await expect(
          pipe.transform({ tapAgeMs: -1 }, { type: 'body', metatype: cls })
        ).rejects.toThrow()

        await expect(
          pipe.transform({ tapAgeMs: 1.5 }, { type: 'body', metatype: cls })
        ).rejects.toThrow()

        await expect(
          pipe.transform({ tapAgeMs: 604800001 }, { type: 'body', metatype: cls })
        ).rejects.toThrow()

        await expect(
          pipe.transform({ tapAgeMs: 'not-a-number' }, { type: 'body', metatype: cls })
        ).rejects.toThrow()
      })

      test('ValidationPipe accepts valid tapAgeMs and absent tapAgeMs', async () => {
        const validZero = await pipe.transform({ tapAgeMs: 0 }, { type: 'body', metatype: cls })
        expect(validZero.tapAgeMs).toBe(0)

        const validMax = await pipe.transform({ tapAgeMs: 604800000 }, { type: 'body', metatype: cls })
        expect(validMax.tapAgeMs).toBe(604800000)

        const validEmpty = await pipe.transform({}, { type: 'body', metatype: cls })
        expect(validEmpty.tapAgeMs).toBeUndefined()
      })
    })
  })
})
