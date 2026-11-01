import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CourierCreateAdminInput } from './courier-create.admin.input'

describe('CourierCreateAdminInput validation and transformation (Spec 0013 AC-3)', () => {
  const validData = {
    firstName: 'Nikos',
    lastName: 'Rider',
    phoneNumber: '+30 690 000 0000',
    email: 'nikos@coop.gr',
    password: 'password123',
  }

  test('accepts valid input and applies transforms (trims names/email, removes phone spaces)', async () => {
    const input = plainToInstance(CourierCreateAdminInput, {
      firstName: '  Nikos  ',
      lastName: '  Rider  ',
      phoneNumber: '+30 690 000 0000',
      email: '  nikos@coop.gr  ',
      password: 'password123',
    })

    const errors = await validate(input)
    expect(errors).toHaveLength(0)
    expect(input.firstName).toBe('Nikos')
    expect(input.lastName).toBe('Rider')
    expect(input.phoneNumber).toBe('+306900000000')
    expect(input.email).toBe('nikos@coop.gr')
  })

  describe('firstName and lastName', () => {
    test('rejects empty or whitespace-only firstName', async () => {
      const input = plainToInstance(CourierCreateAdminInput, {
        ...validData,
        firstName: '   ',
      })
      const errors = await validate(input)
      expect(errors.some((e) => e.property === 'firstName')).toBe(true)
    })

    test('rejects firstName longer than 255 characters', async () => {
      const input = plainToInstance(CourierCreateAdminInput, {
        ...validData,
        firstName: 'a'.repeat(256),
      })
      const errors = await validate(input)
      expect(errors.some((e) => e.property === 'firstName')).toBe(true)
    })

    test('rejects empty or whitespace-only lastName', async () => {
      const input = plainToInstance(CourierCreateAdminInput, {
        ...validData,
        lastName: '   ',
      })
      const errors = await validate(input)
      expect(errors.some((e) => e.property === 'lastName')).toBe(true)
    })

    test('rejects lastName longer than 255 characters', async () => {
      const input = plainToInstance(CourierCreateAdminInput, {
        ...validData,
        lastName: 'b'.repeat(256),
      })
      const errors = await validate(input)
      expect(errors.some((e) => e.property === 'lastName')).toBe(true)
    })
  })

  describe('phoneNumber', () => {
    test('accepts valid phone numbers with 8 to 15 digits and a plus', async () => {
      // 8 digits
      const minPhone = plainToInstance(CourierCreateAdminInput, {
        ...validData,
        phoneNumber: '+12345678',
      })
      expect(await validate(minPhone)).toHaveLength(0)

      // 15 digits
      const maxPhone = plainToInstance(CourierCreateAdminInput, {
        ...validData,
        phoneNumber: '+123456789012345',
      })
      expect(await validate(maxPhone)).toHaveLength(0)
    })

    test('rejects phone number without plus prefix', async () => {
      const input = plainToInstance(CourierCreateAdminInput, {
        ...validData,
        phoneNumber: '6900000000',
      })
      const errors = await validate(input)
      expect(errors.some((e) => e.property === 'phoneNumber')).toBe(true)
    })

    test('rejects phone number with fewer than 8 digits', async () => {
      const input = plainToInstance(CourierCreateAdminInput, {
        ...validData,
        phoneNumber: '+1234567',
      })
      const errors = await validate(input)
      expect(errors.some((e) => e.property === 'phoneNumber')).toBe(true)
    })

    test('rejects phone number with more than 15 digits', async () => {
      const input = plainToInstance(CourierCreateAdminInput, {
        ...validData,
        phoneNumber: '+1234567890123456',
      })
      const errors = await validate(input)
      expect(errors.some((e) => e.property === 'phoneNumber')).toBe(true)
    })

    test('rejects phone number with non-digit characters', async () => {
      const input = plainToInstance(CourierCreateAdminInput, {
        ...validData,
        phoneNumber: '+3069000abc00',
      })
      const errors = await validate(input)
      expect(errors.some((e) => e.property === 'phoneNumber')).toBe(true)
    })
  })

  describe('email', () => {
    test('rejects invalid email address', async () => {
      const input = plainToInstance(CourierCreateAdminInput, {
        ...validData,
        email: 'not-an-email',
      })
      const errors = await validate(input)
      expect(errors.some((e) => e.property === 'email')).toBe(true)
    })

    test('rejects email exceeding 255 characters', async () => {
      const longEmail = `${'a'.repeat(250)}@example.com`
      const input = plainToInstance(CourierCreateAdminInput, {
        ...validData,
        email: longEmail,
      })
      const errors = await validate(input)
      expect(errors.some((e) => e.property === 'email')).toBe(true)
    })
  })

  describe('password', () => {
    test('accepts password between 8 and 72 characters inclusive', async () => {
      const pass8 = plainToInstance(CourierCreateAdminInput, {
        ...validData,
        password: 'a'.repeat(8),
      })
      expect(await validate(pass8)).toHaveLength(0)

      const pass72 = plainToInstance(CourierCreateAdminInput, {
        ...validData,
        password: 'a'.repeat(72),
      })
      expect(await validate(pass72)).toHaveLength(0)
    })

    test('rejects password shorter than 8 characters', async () => {
      const input = plainToInstance(CourierCreateAdminInput, {
        ...validData,
        password: 'a'.repeat(7),
      })
      const errors = await validate(input)
      expect(errors.some((e) => e.property === 'password')).toBe(true)
    })

    test('rejects password longer than 72 characters', async () => {
      const input = plainToInstance(CourierCreateAdminInput, {
        ...validData,
        password: 'a'.repeat(73),
      })
      const errors = await validate(input)
      expect(errors.some((e) => e.property === 'password')).toBe(true)
    })
  })
})
