import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { RESET_CODE_REFUSED_MESSAGE, RESET_PASSWORD_LENGTH_MESSAGE } from 'src/domains/auth/password-reset.service'
import { ForgotPasswordPartnerInput, ResetPasswordPartnerInput } from './password-reset.partner.input'

describe('Password Reset Partner Inputs Validation (Row 153, spec 0039 AC-7, AC-11)', () => {
  // ValidationPipe configured with main.ts options (enableImplicitConversion: true)
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
  })

  const refusalMessages = async (body: Record<string, unknown>, metatype: any): Promise<string[]> => {
    try {
      await pipe.transform(body, { type: 'body', metatype })
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException)
      const res = (error as BadRequestException).getResponse()
      if (typeof res === 'string') return [res]
      const message = (res as { message?: string | string[] })?.message
      if (message) {
        return Array.isArray(message) ? message : [message]
      }
      return [(error as BadRequestException).message]
    }
    throw new Error('expected a 400')
  }

  describe('ForgotPasswordPartnerInput', () => {
    test('accepts valid email string', async () => {
      const result = await pipe.transform(
        { email: 'taverna@volos.gr' },
        { type: 'body', metatype: ForgotPasswordPartnerInput }
      )
      expect(result).toBeInstanceOf(ForgotPasswordPartnerInput)
      expect(result.email).toBe('taverna@volos.gr')
    })

    test('refuses non-string email (JSON number, boolean, null) with "email must be sent as text"', async () => {
      for (const nonString of [12345, true, false, null, {}]) {
        const messages = await refusalMessages({ email: nonString }, ForgotPasswordPartnerInput)
        expect(messages).toContain('email must be sent as text')
      }
    })

    test('refuses malformed email string with standard email error', async () => {
      const messages = await refusalMessages({ email: 'not-an-email' }, ForgotPasswordPartnerInput)
      expect(messages.some((m) => m.includes('email must be an email'))).toBe(true)
    })
  })

  describe('ResetPasswordPartnerInput', () => {
    const validBody = {
      email: 'taverna@volos.gr',
      code: '004219',
      password: 'validPassword123',
    }

    test('accepts valid email, 6-digit string code, and 8-72 char password', async () => {
      const result = await pipe.transform(validBody, {
        type: 'body',
        metatype: ResetPasswordPartnerInput,
      })
      expect(result).toBeInstanceOf(ResetPasswordPartnerInput)
      expect(result.email).toBe('taverna@volos.gr')
      expect(result.code).toBe('004219')
      expect(result.password).toBe('validPassword123')
    })

    describe('Code validation (Clause 2: JSON number refused, length/digits check)', () => {
      test('code as JSON number (e.g. 4219, 0) is refused with the exact code sentence', async () => {
        for (const num of [4219, 0, 123456]) {
          const messages = await refusalMessages({ ...validBody, code: num }, ResetPasswordPartnerInput)
          expect(messages).toContain(RESET_CODE_REFUSED_MESSAGE)
        }
      })

      test('code as non-string (boolean, null, object) is refused with the exact code sentence', async () => {
        for (const nonString of [true, false, null, {}]) {
          const messages = await refusalMessages({ ...validBody, code: nonString }, ResetPasswordPartnerInput)
          expect(messages).toContain(RESET_CODE_REFUSED_MESSAGE)
        }
      })

      test('code "12345" (5 digits) is refused with the exact code sentence', async () => {
        const messages = await refusalMessages({ ...validBody, code: '12345' }, ResetPasswordPartnerInput)
        expect(messages).toContain(RESET_CODE_REFUSED_MESSAGE)
      })

      test('code "1234567" (7 digits) is refused with the exact code sentence', async () => {
        const messages = await refusalMessages({ ...validBody, code: '1234567' }, ResetPasswordPartnerInput)
        expect(messages).toContain(RESET_CODE_REFUSED_MESSAGE)
      })

      test('code "12a456" (non-digit characters) is refused with the exact code sentence', async () => {
        const messages = await refusalMessages({ ...validBody, code: '12a456' }, ResetPasswordPartnerInput)
        expect(messages).toContain(RESET_CODE_REFUSED_MESSAGE)
      })

      test('code "004219" (6 digits with leading zeros) is accepted', async () => {
        const result = await pipe.transform(
          { ...validBody, code: '004219' },
          { type: 'body', metatype: ResetPasswordPartnerInput }
        )
        expect(result.code).toBe('004219')
      })
    })

    describe('Password validation (Clause 2: 8 to 72 characters)', () => {
      test('password of 7 characters is refused with "The new password must be 8 to 72 characters."', async () => {
        const messages = await refusalMessages({ ...validBody, password: 'p'.repeat(7) }, ResetPasswordPartnerInput)
        expect(messages).toContain(RESET_PASSWORD_LENGTH_MESSAGE)
      })

      test('password of 73 characters is refused with "The new password must be 8 to 72 characters."', async () => {
        const messages = await refusalMessages({ ...validBody, password: 'p'.repeat(73) }, ResetPasswordPartnerInput)
        expect(messages).toContain(RESET_PASSWORD_LENGTH_MESSAGE)
      })

      test('password of 8 characters is accepted', async () => {
        const result = await pipe.transform(
          { ...validBody, password: 'p'.repeat(8) },
          { type: 'body', metatype: ResetPasswordPartnerInput }
        )
        expect(result.password).toBe('p'.repeat(8))
      })

      test('password of 72 characters is accepted', async () => {
        const result = await pipe.transform(
          { ...validBody, password: 'p'.repeat(72) },
          { type: 'body', metatype: ResetPasswordPartnerInput }
        )
        expect(result.password).toBe('p'.repeat(72))
      })

      test('non-string password is refused with "The new password must be 8 to 72 characters."', async () => {
        const messages = await refusalMessages({ ...validBody, password: 12345678 }, ResetPasswordPartnerInput)
        expect(messages).toContain(RESET_PASSWORD_LENGTH_MESSAGE)
      })
    })

    describe('Email validation on ResetPasswordPartnerInput', () => {
      test('malformed email is refused with the exact code sentence', async () => {
        const messages = await refusalMessages({ ...validBody, email: 'not-an-email' }, ResetPasswordPartnerInput)
        expect(messages).toContain(RESET_CODE_REFUSED_MESSAGE)
      })

      test('non-string email is refused with the exact code sentence', async () => {
        const messages = await refusalMessages({ ...validBody, email: 12345 }, ResetPasswordPartnerInput)
        expect(messages).toContain(RESET_CODE_REFUSED_MESSAGE)
      })
    })
  })
})
