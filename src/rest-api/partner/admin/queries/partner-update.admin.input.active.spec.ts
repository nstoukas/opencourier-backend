import { EnumCountryCode } from '@prisma/types'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { PartnerUpdateAdminInput } from './partner-update.admin.input'

describe('PartnerUpdateAdminInput', () => {
  const createValidPlainObject = (): Record<string, any> => ({
    name: 'Taverna Volos Updated',
    phoneNumber: '+302421000001',
    pickupAddress: {
      street: 'Iasonos',
      houseNumber: '12',
      city: 'Volos',
      countryCode: EnumCountryCode.GR,
      latitude: 39.362,
      longitude: 22.944,
    },
  })

  test('passes validation when optional fields and nested pickupAddress are valid', async () => {
    const input = plainToInstance(PartnerUpdateAdminInput, createValidPlainObject())
    const errors = await validate(input)

    expect(errors).toHaveLength(0)
  })

  test('passes validation when empty object (all optional fields omitted)', async () => {
    const input = plainToInstance(PartnerUpdateAdminInput, {})
    const errors = await validate(input)

    expect(errors).toHaveLength(0)
  })

  test('rejects name as empty string', async () => {
    const plain = createValidPlainObject()
    plain.name = ''

    const input = plainToInstance(PartnerUpdateAdminInput, plain)
    const errors = await validate(input)

    const nameError = errors.find((e) => e.property === 'name')
    expect(nameError).toBeDefined()
    expect(nameError?.constraints?.minLength).toBeDefined()
  })

  test('passes validation when nullable fields (phoneNumber, logo, webhookUrl) are set to null', async () => {
    const plain = {
      phoneNumber: null,
      logo: null,
      webhookUrl: null,
    }

    const input = plainToInstance(PartnerUpdateAdminInput, plain)
    const errors = await validate(input)

    expect(errors).toHaveLength(0)
    expect(input.phoneNumber).toBeNull()
    expect(input.logo).toBeNull()
    expect(input.webhookUrl).toBeNull()
  })

  test('rejects nested pickupAddress with invalid countryCode', async () => {
    const plain = createValidPlainObject()
    plain.pickupAddress.countryCode = 'INVALID_CODE' as unknown as EnumCountryCode

    const input = plainToInstance(PartnerUpdateAdminInput, plain)
    const errors = await validate(input)

    const addressError = errors.find((e) => e.property === 'pickupAddress')
    expect(addressError).toBeDefined()
    const countryError = addressError?.children?.find((c) => c.property === 'countryCode')
    expect(countryError?.constraints?.isEnum).toBeDefined()
  })

  test('rejects nested pickupAddress with non-numeric latitude', async () => {
    const plain = createValidPlainObject()
    plain.pickupAddress.latitude = 'invalid-lat' as unknown as number

    const input = plainToInstance(PartnerUpdateAdminInput, plain)
    const errors = await validate(input)

    const addressError = errors.find((e) => e.property === 'pickupAddress')
    expect(addressError).toBeDefined()
    const latError = addressError?.children?.find((c) => c.property === 'latitude')
    expect(latError?.constraints?.isNumber).toBeDefined()
  })
})
