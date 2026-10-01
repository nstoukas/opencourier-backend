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
})
