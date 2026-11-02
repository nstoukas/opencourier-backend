import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { CourierJobStepCourierInput } from './courier-job-step.courier.input'
import { MarkDeliveryAsPickedUpCourierInput } from './mark-delivery-as-picked-up.courier.input'
import { MarkDeliveryAsDeliveredCourierInput } from './mark-delivery-as-delivered.courier.input'
import { ArrivedCourierInput } from './arrived.courier.input'

describe('CourierJobStepCourierInput & child inputs (Spec 0009, AC-7 bounds)', () => {
  // Test all 4 classes: the base input and the three inputs extending it
  const inputClasses = [
    { name: 'CourierJobStepCourierInput', cls: CourierJobStepCourierInput },
    { name: 'MarkDeliveryAsPickedUpCourierInput', cls: MarkDeliveryAsPickedUpCourierInput },
    { name: 'MarkDeliveryAsDeliveredCourierInput', cls: MarkDeliveryAsDeliveredCourierInput },
    { name: 'ArrivedCourierInput', cls: ArrivedCourierInput },
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

      test('refuses string tapAgeMs ("not-a-number")', () => {
        // @RefuseIfNotSentAsNumber throws BadRequestException in plainToInstance
        expect(() => plainToInstance(cls, { tapAgeMs: 'not-a-number' as any })).toThrow(
          BadRequestException
        )
      })

      test('refuses tapAgeMs null', async () => {
        const instance = plainToInstance(cls, { tapAgeMs: null })
        const errors = await validate(instance)
        const tapErrors = errors.filter((e) => e.property === 'tapAgeMs')
        expect(tapErrors.length).toBeGreaterThan(0)
        expect(tapErrors[0]?.constraints).toHaveProperty('isInt')
      })

      test('refuses empty string tapAgeMs ("")', () => {
        // @RefuseIfNotSentAsNumber throws BadRequestException in plainToInstance
        expect(() => plainToInstance(cls, { tapAgeMs: '' as any })).toThrow(
          BadRequestException
        )
      })

      test('refuses boolean tapAgeMs (true and false)', () => {
        for (const val of [true, false]) {
          // @RefuseIfNotSentAsNumber throws BadRequestException in plainToInstance
          expect(() => plainToInstance(cls, { tapAgeMs: val as any })).toThrow(
            BadRequestException
          )
        }
      })

      test('ValidationPipe rejects invalid tapAgeMs with 400 BadRequestException', async () => {
        await expect(
          pipe.transform({ tapAgeMs: -1 }, { type: 'body', metatype: cls })
        ).rejects.toThrow(BadRequestException)

        await expect(
          pipe.transform({ tapAgeMs: 1.5 }, { type: 'body', metatype: cls })
        ).rejects.toThrow(BadRequestException)

        await expect(
          pipe.transform({ tapAgeMs: 604800001 }, { type: 'body', metatype: cls })
        ).rejects.toThrow(BadRequestException)

        await expect(
          pipe.transform({ tapAgeMs: 'not-a-number' }, { type: 'body', metatype: cls })
        ).rejects.toThrow(BadRequestException)

        await expect(
          pipe.transform({ tapAgeMs: null }, { type: 'body', metatype: cls })
        ).rejects.toThrow(BadRequestException)
      })

      test('ValidationPipe refuses tapAgeMs null with 400 through the ValidationPipe, and accepts it absent (AC-7)', async () => {
        await expect(
          pipe.transform({ tapAgeMs: null }, { type: 'body', metatype: cls })
        ).rejects.toThrow(BadRequestException)

        const absentResult = await pipe.transform({}, { type: 'body', metatype: cls })
        expect(absentResult.tapAgeMs).toBeUndefined()
      })

      test('ValidationPipe refuses empty string and boolean tapAgeMs with 400 (AC-7)', async () => {
        // AC-7: A tapAgeMs that is not a whole number from 0 to 604800000 is refused with a 400.
        // Due to enableImplicitConversion: true, ValidationPipe converts "" -> 0, true -> 1, false -> 0,
        // so the pipe accepts them unless prevented by custom validation (@RefuseIfNotSentAsNumber).
        // We pin the 400 the spec asks for.
        await expect(
          pipe.transform({ tapAgeMs: '' }, { type: 'body', metatype: cls })
        ).rejects.toThrow(BadRequestException)

        await expect(
          pipe.transform({ tapAgeMs: true }, { type: 'body', metatype: cls })
        ).rejects.toThrow(BadRequestException)

        await expect(
          pipe.transform({ tapAgeMs: false }, { type: 'body', metatype: cls })
        ).rejects.toThrow(BadRequestException)
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
