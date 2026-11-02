import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { ArrivedCourierInput } from './arrived.courier.input'

describe('ArrivedCourierInput validation (Spec 0021 AC-4)', () => {
  // Global pipe options from src/main.ts
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  })

  describe('Happy path', () => {
    it('accepts detected: true', async () => {
      const result = (await pipe.transform(
        { detected: true },
        { type: 'body', metatype: ArrivedCourierInput }
      )) as ArrivedCourierInput

      expect(result.detected).toBe(true)
    })

    it('accepts detected: false', async () => {
      const result = (await pipe.transform(
        { detected: false },
        { type: 'body', metatype: ArrivedCourierInput }
      )) as ArrivedCourierInput

      expect(result.detected).toBe(false)
    })

    it('accepts omitted detected (defaults to undefined for tapped arrivals)', async () => {
      const result = (await pipe.transform(
        {},
        { type: 'body', metatype: ArrivedCourierInput }
      )) as ArrivedCourierInput

      expect(result.detected).toBeUndefined()
    })

    it('accepts tapAgeMs alongside detected boolean', async () => {
      const result = (await pipe.transform(
        { tapAgeMs: 1500, detected: true },
        { type: 'body', metatype: ArrivedCourierInput }
      )) as ArrivedCourierInput

      expect(result.detected).toBe(true)
      expect(result.tapAgeMs).toBe(1500)
    })
  })

  describe('Refuses non-boolean detected values via @RefuseIfNotSentAsBoolean (AC-4)', () => {
    const invalidValues = [
      'true',
      'false',
      '',
      '   ',
      1,
      0,
      null,
      [],
      {},
    ]

    invalidValues.forEach((invalidValue) => {
      it(`refuses non-boolean ${JSON.stringify(invalidValue)} with 400 BadRequestException naming detected`, async () => {
        const promise = pipe.transform(
          { detected: invalidValue },
          { type: 'body', metatype: ArrivedCourierInput }
        )

        await expect(promise).rejects.toBeInstanceOf(BadRequestException)
        await expect(promise).rejects.toThrow('detected must be sent as true or false')
      })
    })
  })

  describe('Inherits CourierJobStepCourierInput validation rules', () => {
    it('refuses negative tapAgeMs (-1)', async () => {
      const promise = pipe.transform(
        { tapAgeMs: -1, detected: true },
        { type: 'body', metatype: ArrivedCourierInput }
      )

      await expect(promise).rejects.toBeInstanceOf(BadRequestException)
    })

    it('refuses non-number tapAgeMs ("not-a-number")', async () => {
      const promise = pipe.transform(
        { tapAgeMs: 'not-a-number', detected: true },
        { type: 'body', metatype: ArrivedCourierInput }
      )

      await expect(promise).rejects.toBeInstanceOf(BadRequestException)
    })
  })
})
