import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { InstanceConfigSettingsAdminInput } from './instance-config-settings.admin.input'
import { NUMERIC_SETTING_RULES } from 'src/domains/config/instance-config.domain.service'

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
    // Walks NUMERIC_SETTING_RULES exported from src/domains/config/instance-config.domain.service.ts
    // For EVERY key in it, pushes { [key]: '' } through real ValidationPipe expecting 400.
    NUMERIC_SETTING_RULES.forEach((rule) => {
      it(`guard pins rule key '${rule.key}': empty string is refused with 400`, async () => {
        const promise = pipe.transform(
          { [rule.key]: '' },
          { type: 'body', metatype: InstanceConfigSettingsAdminInput }
        )
        await expect(promise).rejects.toBeInstanceOf(BadRequestException)
        await expect(promise).rejects.toThrow(`${rule.key} cannot be empty`)
      })
    })
  })
})
