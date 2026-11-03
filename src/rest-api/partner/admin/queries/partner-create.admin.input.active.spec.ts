import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { EnumCountryCode } from '@prisma/types'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { PartnerCreateAdminInput } from './partner-create.admin.input'

describe('PartnerCreateAdminInput', () => {
  // Helper function to build a valid plain JS object for PartnerCreateAdminInput
  const createValidPlainObject = (): Record<string, any> => ({
    name: 'Taverna Volos',
    email: 'taverna@volos.gr',
    password: 'password123',
    pickupAddress: {
      street: 'Iasonos',
      houseNumber: '12',
      city: 'Volos',
      countryCode: EnumCountryCode.GR,
      latitude: 39.362,
      longitude: 22.944,
    },
  })

  test('11. passes validation when all required fields and nested pickupAddress are valid', async () => {
    const input = plainToInstance(PartnerCreateAdminInput, createValidPlainObject())
    const errors = await validate(input)

    expect(errors).toHaveLength(0)
  })

  test('12a. rejects malformed email address', async () => {
    const plain = createValidPlainObject()
    plain.email = 'not-an-email'

    const input = plainToInstance(PartnerCreateAdminInput, plain)
    const errors = await validate(input)

    const emailError = errors.find((e) => e.property === 'email')
    expect(emailError).toBeDefined()
    expect(emailError?.constraints?.isEmail).toBeDefined()
  })

  test('12b. rejects password shorter than 8 characters', async () => {
    const plain = createValidPlainObject()
    plain.password = '1234567' // 7 chars

    const input = plainToInstance(PartnerCreateAdminInput, plain)
    const errors = await validate(input)

    const passwordError = errors.find((e) => e.property === 'password')
    expect(passwordError).toBeDefined()
    expect(passwordError?.constraints?.minLength).toBeDefined()
  })

  test('12c. rejects missing or empty name', async () => {
    const plain = createValidPlainObject()
    plain.name = ''

    const input = plainToInstance(PartnerCreateAdminInput, plain)
    const errors = await validate(input)

    const nameError = errors.find((e) => e.property === 'name')
    expect(nameError).toBeDefined()
    expect(nameError?.constraints?.minLength).toBeDefined()
  })

  test('12d. rejects nested pickupAddress with invalid countryCode', async () => {
    const plain = createValidPlainObject()
    // Cast invalid string to EnumCountryCode for testing constraint rejection
    plain.pickupAddress.countryCode = 'INVALID_CODE' as unknown as EnumCountryCode

    const input = plainToInstance(PartnerCreateAdminInput, plain)
    const errors = await validate(input)

    const addressError = errors.find((e) => e.property === 'pickupAddress')
    expect(addressError).toBeDefined()
    // Validation errors for nested objects appear in children array
    const countryError = addressError?.children?.find((c) => c.property === 'countryCode')
    expect(countryError?.constraints?.isEnum).toBeDefined()
  })

  test('12e. rejects nested pickupAddress with non-numeric latitude', async () => {
    const plain = createValidPlainObject()
    // Pass non-numeric latitude string
    plain.pickupAddress.latitude = 'invalid-lat' as unknown as number

    const input = plainToInstance(PartnerCreateAdminInput, plain)
    const errors = await validate(input)

    const addressError = errors.find((e) => e.property === 'pickupAddress')
    expect(addressError).toBeDefined()
    const latError = addressError?.children?.find((c) => c.property === 'latitude')
    expect(latError?.constraints?.isNumber).toBeDefined()
  })
})

// Spec 0023, AC-9: the usual prep time, through the same ValidationPipe main.ts installs.
describe('PartnerCreateAdminInput.usualPrepMinutes through ValidationPipe (spec 0023, AC-9)', () => {
  const SENTENCE = 'The usual prep time is a whole number of minutes from 0 to 90.'
  const pipe = new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } })
  const base = (): Record<string, unknown> => ({ name: 'Taverna Volos', email: 'taverna@volos.gr', password: 'password123' })
  const transform = (body: Record<string, unknown>) => pipe.transform(body, { type: 'body', metatype: PartnerCreateAdminInput })

  // The sentences a 400 carries (the ValidationPipe puts them in `message`).
  const refusalMessages = async (body: Record<string, unknown>): Promise<string[]> => {
    try {
      await transform(body)
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException)
      const message = ((error as BadRequestException).getResponse() as { message: string | string[] }).message
      return Array.isArray(message) ? message : [message]
    }
    throw new Error('expected a 400')
  }

  test.each([0, 1, 15, 45, 90])('accepts %d', async (minutes) => {
    const result = (await transform({ ...base(), usualPrepMinutes: minutes })) as PartnerCreateAdminInput
    expect(result.usualPrepMinutes).toBe(minutes)
  })

  test('leaving it out is accepted and leaves it undefined', async () => {
    const result = (await transform(base())) as PartnerCreateAdminInput
    expect(result.usualPrepMinutes).toBeUndefined()
  })

  test.each([-1, 91, 120, 15.5])('refuses %p with the usual prep time sentence', async (minutes) => {
    const messages = await refusalMessages({ ...base(), usualPrepMinutes: minutes })
    expect(messages).toContain(SENTENCE)
  })

  test.each(['', '15', 'fifteen'])('refuses %p (not sent as a JSON number) with 400', async (minutes) => {
    await expect(transform({ ...base(), usualPrepMinutes: minutes })).rejects.toThrow(BadRequestException)
  })
})
