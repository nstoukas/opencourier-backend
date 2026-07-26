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
