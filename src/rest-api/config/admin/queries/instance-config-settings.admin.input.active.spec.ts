import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { getMetadataStorage } from 'class-validator'
import { InstanceConfigSettingsAdminInput } from './instance-config-settings.admin.input'
import { NUMERIC_SETTING_RULES } from 'src/domains/config/instance-config.domain.service'

// Derive the list of number fields from class-validator metadata for InstanceConfigSettingsAdminInput
const storage = getMetadataStorage()
const targetMetadatas = storage.getTargetValidationMetadatas(
  InstanceConfigSettingsAdminInput,
  '',
  false,
  false
)

const dtoNumberFields = Array.from(
  new Set(
    targetMetadatas
      .filter((m) => {
        const constraints = storage.getTargetValidatorConstraints(m.constraintCls || [])
        return (
          constraints.some((c) => c.name === 'isNumber') ||
          m.type === 'isNumber' ||
          (m as any).name === 'isNumber'
        )
      })
      .map((m) => m.propertyName)
  )
)

describe('InstanceConfigSettingsAdminInput validation', () => {
  // Real Nest ValidationPipe built with exact options from src/main.ts
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
  })

  describe('Clause 1: Refusing empty values and non-numbers for numeric settings', () => {
    NUMERIC_SETTING_RULES.forEach((rule) => {
      it(`refuses empty string '' for ${rule.key} with BadRequestException naming the setting`, async () => {
        const promise = pipe.transform(
          { [rule.key]: '' },
          { type: 'body', metatype: InstanceConfigSettingsAdminInput }
        )
        await expect(promise).rejects.toBeInstanceOf(BadRequestException)
        await expect(promise).rejects.toThrow(`${rule.key} cannot be empty`)
      })

      it(`refuses whitespace-only string '   ' for ${rule.key} with BadRequestException naming the setting`, async () => {
        const promise = pipe.transform(
          { [rule.key]: '   ' },
          { type: 'body', metatype: InstanceConfigSettingsAdminInput }
        )
        await expect(promise).rejects.toBeInstanceOf(BadRequestException)
        await expect(promise).rejects.toThrow(`${rule.key} cannot be empty`)
      })

      it(`refuses other non-numbers (false, [], "5", "abc") for ${rule.key} with BadRequestException`, async () => {
        for (const invalidValue of [false, [], '5', 'abc']) {
          const promise = pipe.transform(
            { [rule.key]: invalidValue },
            { type: 'body', metatype: InstanceConfigSettingsAdminInput }
          )
          await expect(promise).rejects.toBeInstanceOf(BadRequestException)
          await expect(promise).rejects.toThrow(`${rule.key} must be sent as a number`)
        }
      })
    })

    it('does not handle left-out fields (left out field is simply not saved / remains undefined)', async () => {
      const result = (await pipe.transform(
        {},
        { type: 'body', metatype: InstanceConfigSettingsAdminInput }
      )) as InstanceConfigSettingsAdminInput

      expect(result.quoteBaseFee).toBeUndefined()
    })

    it('does not handle null in decorator (null passes DTO transformation untouched to be handled by domain rules)', async () => {
      const result = (await pipe.transform(
        { quoteBaseFee: null },
        { type: 'body', metatype: InstanceConfigSettingsAdminInput }
      )) as InstanceConfigSettingsAdminInput

      expect(result.quoteBaseFee).toBeNull()
    })
  })

  describe('Clause 2: Real numbers pass DTO untouched', () => {
    NUMERIC_SETTING_RULES.forEach((rule) => {
      it(`passes real JSON number 0 untouched for ${rule.key}`, async () => {
        const result = (await pipe.transform(
          { [rule.key]: 0 },
          { type: 'body', metatype: InstanceConfigSettingsAdminInput }
        )) as InstanceConfigSettingsAdminInput

        expect(result[rule.key]).toBe(0)
      })

      it(`passes real positive numbers (e.g. 250) untouched for ${rule.key}`, async () => {
        const result = (await pipe.transform(
          { [rule.key]: 250 },
          { type: 'body', metatype: InstanceConfigSettingsAdminInput }
        )) as InstanceConfigSettingsAdminInput

        expect(result[rule.key]).toBe(250)
      })
    })
  })

  describe('Clause 3: Guard - fails if an empty value is ever saved as 0 again', () => {
    it('asserts DTO number fields set equals NUMERIC_SETTING_RULES keys set (both directions)', () => {
      const ruleKeys = NUMERIC_SETTING_RULES.map((r) => r.key as string)

      // Direction 1: Every DTO @IsNumber() field must exist in NUMERIC_SETTING_RULES
      const missingInRules = dtoNumberFields.filter((field) => !ruleKeys.includes(field))
      expect(missingInRules).toEqual([])
      dtoNumberFields.forEach((field) => {
        expect(ruleKeys).toContain(field)
      })

      // Direction 2: Every NUMERIC_SETTING_RULES key must exist as a DTO @IsNumber() field
      const missingInDto = ruleKeys.filter((key) => !dtoNumberFields.includes(key))
      expect(missingInDto).toEqual([])
      ruleKeys.forEach((key) => {
        expect(dtoNumberFields).toContain(key)
      })
    })

    // For EVERY field derived from DTO metadata, push { [field]: '' } through real ValidationPipe expecting 400
    dtoNumberFields.forEach((field) => {
      it(`guard pins DTO field '${field}': empty string is refused with 400`, async () => {
        const promise = pipe.transform(
          { [field]: '' },
          { type: 'body', metatype: InstanceConfigSettingsAdminInput }
        )
        await expect(promise).rejects.toBeInstanceOf(BadRequestException)
        await expect(promise).rejects.toThrow(`${field} cannot be empty`)
      })
    })
  })

  describe('Clause 4: Boolean settings guard (@RefuseIfNotSentAsBoolean, AC-10)', () => {
    const invalidBooleanValues = ['false', '', null, 0, 'true', 1, [], {}]

    invalidBooleanValues.forEach((invalidValue) => {
      it(`refuses non-boolean ${JSON.stringify(invalidValue)} for offerExpiryEnabled with BadRequestException naming the setting`, async () => {
        const promise = pipe.transform(
          { offerExpiryEnabled: invalidValue },
          { type: 'body', metatype: InstanceConfigSettingsAdminInput }
        )
        await expect(promise).rejects.toBeInstanceOf(BadRequestException)
        await expect(promise).rejects.toThrow('offerExpiryEnabled must be sent as true or false')
      })
    })

    it('passes real JSON boolean true untouched for offerExpiryEnabled', async () => {
      const result = (await pipe.transform(
        { offerExpiryEnabled: true },
        { type: 'body', metatype: InstanceConfigSettingsAdminInput }
      )) as InstanceConfigSettingsAdminInput

      expect(result.offerExpiryEnabled).toBe(true)
    })

    it('passes real JSON boolean false untouched for offerExpiryEnabled', async () => {
      const result = (await pipe.transform(
        { offerExpiryEnabled: false },
        { type: 'body', metatype: InstanceConfigSettingsAdminInput }
      )) as InstanceConfigSettingsAdminInput

      expect(result.offerExpiryEnabled).toBe(false)
    })

    it('leaves offerExpiryEnabled undefined when left out from body', async () => {
      const result = (await pipe.transform(
        {},
        { type: 'body', metatype: InstanceConfigSettingsAdminInput }
      )) as InstanceConfigSettingsAdminInput

      expect(result.offerExpiryEnabled).toBeUndefined()
    })
  })

  describe('Clause 5: Text setting guard (@RefuseIfNotSentAsString, row 72, decision 72.3)', () => {
    const invalidTextValues = [302421012345, 0, true, false, null, [], {}]

    invalidTextValues.forEach((invalidValue) => {
      it(`refuses non-text ${JSON.stringify(invalidValue)} for dispatchPhoneNumber with BadRequestException naming the setting`, async () => {
        const promise = pipe.transform(
          { dispatchPhoneNumber: invalidValue },
          { type: 'body', metatype: InstanceConfigSettingsAdminInput }
        )
        await expect(promise).rejects.toBeInstanceOf(BadRequestException)
        await expect(promise).rejects.toThrow('dispatchPhoneNumber must be sent as text')
      })
    })

    it('passes real JSON string untouched for dispatchPhoneNumber', async () => {
      const result = (await pipe.transform(
        { dispatchPhoneNumber: '+30 24210 12345' },
        { type: 'body', metatype: InstanceConfigSettingsAdminInput }
      )) as InstanceConfigSettingsAdminInput

      expect(result.dispatchPhoneNumber).toBe('+30 24210 12345')
    })

    it('passes empty string untouched for dispatchPhoneNumber', async () => {
      const result = (await pipe.transform(
        { dispatchPhoneNumber: '' },
        { type: 'body', metatype: InstanceConfigSettingsAdminInput }
      )) as InstanceConfigSettingsAdminInput

      expect(result.dispatchPhoneNumber).toBe('')
    })

    it('leaves dispatchPhoneNumber undefined when left out from body', async () => {
      const result = (await pipe.transform(
        {},
        { type: 'body', metatype: InstanceConfigSettingsAdminInput }
      )) as InstanceConfigSettingsAdminInput

      expect(result.dispatchPhoneNumber).toBeUndefined()
    })
  })

  describe('Clause 6: cancellationPayoutPolicy text guard (@RefuseIfNotSentAsString, Spec 0015 AC-4)', () => {
    const invalidTextValues = [100, 0, true, false, null, [], {}]

    invalidTextValues.forEach((invalidValue) => {
      it(`refuses non-text ${JSON.stringify(invalidValue)} for cancellationPayoutPolicy with BadRequestException naming the setting`, async () => {
        const promise = pipe.transform(
          { cancellationPayoutPolicy: invalidValue },
          { type: 'body', metatype: InstanceConfigSettingsAdminInput }
        )
        await expect(promise).rejects.toBeInstanceOf(BadRequestException)
        await expect(promise).rejects.toThrow('cancellationPayoutPolicy must be sent as text')
      })
    })

    it('passes real JSON string untouched for cancellationPayoutPolicy', async () => {
      const result = (await pipe.transform(
        { cancellationPayoutPolicy: 'FULL_COMPENSATION' },
        { type: 'body', metatype: InstanceConfigSettingsAdminInput }
      )) as InstanceConfigSettingsAdminInput

      expect(result.cancellationPayoutPolicy).toBe('FULL_COMPENSATION')
    })

    it('leaves cancellationPayoutPolicy undefined when left out from body', async () => {
      const result = (await pipe.transform(
        {},
        { type: 'body', metatype: InstanceConfigSettingsAdminInput }
      )) as InstanceConfigSettingsAdminInput

      expect(result.cancellationPayoutPolicy).toBeUndefined()
    })
  })

  describe('Clause 7: Shift settings (spec 0026, AC-5)', () => {
    const transform = (body: Record<string, unknown>) =>
      pipe.transform(body, { type: 'body', metatype: InstanceConfigSettingsAdminInput })

    it('shiftDropNoticeHours is in NUMERIC_SETTING_RULES as a whole number from 0 to 168, 0 allowed', () => {
      const rule = NUMERIC_SETTING_RULES.find((r) => r.key === 'shiftDropNoticeHours')
      expect(rule).toBeDefined()
      expect(rule).toMatchObject({ whyZeroIsRefused: null, mustBeInteger: true, min: 0, max: 168 })
      expect(rule!.zeroSwitchesOff).toBeUndefined()
    })

    it('shiftDropNoticeHours is a DTO number field guarded by @RefuseIfNotSentAsNumber', () => {
      expect(dtoNumberFields).toContain('shiftDropNoticeHours')
    })

    it.each([0, 12, 168])('passes shiftDropNoticeHours %p untouched', async (value) => {
      const result = (await transform({ shiftDropNoticeHours: value })) as InstanceConfigSettingsAdminInput
      expect(result.shiftDropNoticeHours).toBe(value)
    })

    it.each(['12', '0', true, false, []])('refuses shiftDropNoticeHours sent as %p (not a JSON number)', async (value) => {
      const promise = transform({ shiftDropNoticeHours: value })
      await expect(promise).rejects.toBeInstanceOf(BadRequestException)
      await expect(promise).rejects.toThrow('shiftDropNoticeHours must be sent as a number')
    })

    it('refuses shiftDropNoticeHours sent as an empty text instead of saving 0', async () => {
      await expect(transform({ shiftDropNoticeHours: '' })).rejects.toThrow('shiftDropNoticeHours cannot be empty')
    })

    it.each(['false', 'true', '', null, 0, 1, [], {}])(
      'refuses shiftsEnabled sent as %p (the text "false" would save as true)',
      async (value) => {
        const promise = transform({ shiftsEnabled: value })
        await expect(promise).rejects.toBeInstanceOf(BadRequestException)
        await expect(promise).rejects.toThrow('shiftsEnabled must be sent as true or false')
      }
    )

    it.each([true, false])('passes shiftsEnabled %p untouched', async (value) => {
      const result = (await transform({ shiftsEnabled: value })) as InstanceConfigSettingsAdminInput
      expect(result.shiftsEnabled).toBe(value)
    })

    it('leaves both undefined when left out', async () => {
      const result = (await transform({})) as InstanceConfigSettingsAdminInput
      expect(result.shiftsEnabled).toBeUndefined()
      expect(result.shiftDropNoticeHours).toBeUndefined()
    })
  })

  describe('Restaurant delays (Spec 0033 AC-1)', () => {
    const transform = (body: Record<string, unknown>) =>
      pipe.transform(body, { type: 'body', metatype: InstanceConfigSettingsAdminInput })

    const numericFields = ['waitPayFreeMinutes', 'waitPayCentsPerMinute', 'waitLimitMinutes'] as const

    for (const field of numericFields) {
      it.each(['10', '0', true, false, []])(`refuses ${field} sent as %p (not a JSON number)`, async (value) => {
        const promise = transform({ [field]: value })
        await expect(promise).rejects.toBeInstanceOf(BadRequestException)
        await expect(promise).rejects.toThrow(`${field} must be sent as a number`)
      })

      it(`refuses ${field} sent as empty text instead of converting to 0`, async () => {
        await expect(transform({ [field]: '' })).rejects.toThrow(`${field} cannot be empty`)
      })

      it(`passes valid number for ${field}`, async () => {
        const result = (await transform({ [field]: 10 })) as InstanceConfigSettingsAdminInput
        expect(result[field]).toBe(10)
      })
    }

    it.each(['false', 'true', '', null, 0, 1, [], {}])(
      'refuses waitPayEnabled sent as %p (not a boolean)',
      async (value) => {
        const promise = transform({ waitPayEnabled: value })
        await expect(promise).rejects.toBeInstanceOf(BadRequestException)
        await expect(promise).rejects.toThrow('waitPayEnabled must be sent as true or false')
      }
    )

    it.each([true, false])('passes waitPayEnabled %p untouched', async (value) => {
      const result = (await transform({ waitPayEnabled: value })) as InstanceConfigSettingsAdminInput
      expect(result.waitPayEnabled).toBe(value)
    })
  })
})
