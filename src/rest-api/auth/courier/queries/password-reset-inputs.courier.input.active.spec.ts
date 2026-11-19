import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { RESET_CODE_REFUSED_MESSAGE, RESET_PASSWORD_LENGTH_MESSAGE } from 'src/domains/auth/password-reset.service'
import { ForgotPasswordCourierInput } from './forgot-password.courier.input'
import { ResetPasswordCourierInput } from './reset-password.courier.input'

describe('Password Reset Inputs Validation (Clause 5, spec 0039 AC-7, AC-11)', () => {
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

  describe('ForgotPasswordCourierInput', () => {
    test('accepts valid email string', async () => {
      const result = await pipe.transform(
        { email: 'rider@volos.coop' },
        { type: 'body', metatype: ForgotPasswordCourierInput }
      )
      expect(result).toBeInstanceOf(ForgotPasswordCourierInput)
      expect(result.email).toBe('rider@volos.coop')
    })

    test('refuses non-string email (JSON number, boolean, null) with "email must be sent as text"', async () => {
      for (const nonString of [12345, true, false, null, {}]) {
        const messages = await refusalMessages({ email: nonString }, ForgotPasswordCourierInput)
        expect(messages).toContain('email must be sent as text')
      }
    })

    test('refuses malformed email string with standard email error', async () => {
      const messages = await refusalMessages({ email: 'not-an-email' }, ForgotPasswordCourierInput)
      expect(messages.some((m) => m.includes('email must be an email'))).toBe(true)
    })
  })

  describe('ResetPasswordCourierInput', () => {
    const validBody = {
      email: 'rider@volos.coop',
      code: '004219',
      password: 'validPassword123',
    }

    test('accepts valid email, 6-digit string code, and 8-72 char password', async () => {
      const result = await pipe.transform(validBody, {
        type: 'body',
        metatype: ResetPasswordCourierInput,
      })
      expect(result).toBeInstanceOf(ResetPasswordCourierInput)
      expect(result.email).toBe('rider@volos.coop')
      expect(result.code).toBe('004219')
      expect(result.password).toBe('validPassword123')
    })

    describe('Code validation (Clause 5: JSON number refused, length/digits check)', () => {
      test('code as JSON number (e.g. 4219, 0) is refused with the exact code sentence', async () => {
        for (const num of [4219, 0, 123456]) {
          const messages = await refusalMessages({ ...validBody, code: num }, ResetPasswordCourierInput)
          expect(messages).toContain(RESET_CODE_REFUSED_MESSAGE)
        }
      })

      test('code as non-string (boolean, null, object) is refused with the exact code sentence', async () => {
        for (const nonString of [true, false, null, {}]) {
          const messages = await refusalMessages({ ...validBody, code: nonString }, ResetPasswordCourierInput)
          expect(messages).toContain(RESET_CODE_REFUSED_MESSAGE)
        }
      })

      test('code "12345" (5 digits) is refused with the exact code sentence', async () => {
        const messages = await refusalMessages({ ...validBody, code: '12345' }, ResetPasswordCourierInput)
        expect(messages).toContain(RESET_CODE_REFUSED_MESSAGE)
      })

      test('code "1234567" (7 digits) is refused with the exact code sentence', async () => {
        const messages = await refusalMessages({ ...validBody, code: '1234567' }, ResetPasswordCourierInput)
        expect(messages).toContain(RESET_CODE_REFUSED_MESSAGE)
      })

      test('code "12a456" (non-digit characters) is refused with the exact code sentence', async () => {
        const messages = await refusalMessages({ ...validBody, code: '12a456' }, ResetPasswordCourierInput)
        expect(messages).toContain(RESET_CODE_REFUSED_MESSAGE)
      })

      test('code "004219" (6 digits with leading zeros) is accepted', async () => {
        const result = await pipe.transform(
          { ...validBody, code: '004219' },
          { type: 'body', metatype: ResetPasswordCourierInput }
        )
        expect(result.code).toBe('004219')
      })
    })

    describe('Password validation (Clause 5: 8 to 72 characters)', () => {
      test('password of 7 characters is refused with "The new password must be 8 to 72 characters."', async () => {
        const messages = await refusalMessages({ ...validBody, password: 'p'.repeat(7) }, ResetPasswordCourierInput)
        expect(messages).toContain(RESET_PASSWORD_LENGTH_MESSAGE)
      })

      test('password of 73 characters is refused with "The new password must be 8 to 72 characters."', async () => {
        const messages = await refusalMessages({ ...validBody, password: 'p'.repeat(73) }, ResetPasswordCourierInput)
        expect(messages).toContain(RESET_PASSWORD_LENGTH_MESSAGE)
      })

      test('password of 8 characters is accepted', async () => {
        const result = await pipe.transform(
          { ...validBody, password: 'p'.repeat(8) },
          { type: 'body', metatype: ResetPasswordCourierInput }
        )
        expect(result.password).toBe('p'.repeat(8))
      })

      test('password of 72 characters is accepted', async () => {
        const result = await pipe.transform(
          { ...validBody, password: 'p'.repeat(72) },
          { type: 'body', metatype: ResetPasswordCourierInput }
        )
        expect(result.password).toBe('p'.repeat(72))
      })

      test('non-string password is refused with "The new password must be 8 to 72 characters."', async () => {
        const messages = await refusalMessages({ ...validBody, password: 12345678 }, ResetPasswordCourierInput)
        expect(messages).toContain(RESET_PASSWORD_LENGTH_MESSAGE)
      })
    })

    describe('Email validation on ResetPasswordCourierInput', () => {
      test('malformed email is refused with the exact code sentence', async () => {
        const messages = await refusalMessages({ ...validBody, email: 'not-an-email' }, ResetPasswordCourierInput)
        expect(messages).toContain(RESET_CODE_REFUSED_MESSAGE)
      })

      test('non-string email is refused with the exact code sentence', async () => {
        const messages = await refusalMessages({ ...validBody, email: 12345 }, ResetPasswordCourierInput)
        expect(messages).toContain(RESET_CODE_REFUSED_MESSAGE)
      })
    })
  })
})
