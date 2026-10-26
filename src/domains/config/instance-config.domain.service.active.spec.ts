import { BadRequestException } from '@nestjs/common'
import { InstanceConfigDomainService, NUMERIC_SETTING_RULES } from './instance-config.domain.service'
import { ConfigRepository } from '../../persistence/repositories/config.repository'
import { ConfigService } from '@nestjs/config'
import {
  ConfigKey,
  EnumCurrency,
  FALLBACK_REASSIGNMENT_PAYOUT_POLICIES,
  FALLBACK_REASSIGNMENT_PAYOUT_DEFAULT_POLICY,
} from 'src/shared-types'
import { DEFAULT_QUOTE_RATE_PER_DISTANCE_UNIT, DEFAULT_QUOTE_BASE_FEE } from 'src/constants'
import { ConfigEntity } from './entities/config.entity'

describe('InstanceConfigDomainService', () => {
  let service: InstanceConfigDomainService
  let configRepository: jest.Mocked<ConfigRepository>
  let fileConfigService: jest.Mocked<ConfigService>

  beforeEach(() => {
    configRepository = {
      getByKey: jest.fn(),
      saveByKey: jest.fn(),
    } as any

    fileConfigService = {
      get: jest.fn().mockReturnValue('200'),
    } as any

    service = new InstanceConfigDomainService(configRepository, fileConfigService)
  })

  describe('getReassignmentPayoutPolicies', () => {
    it('returns stored policies when valid (numbers in 0-100)', async () => {
      configRepository.getByKey.mockResolvedValue(
        new ConfigEntity({
          key: ConfigKey.REASSIGNMENT_PAYOUT_POLICIES,
          value: JSON.stringify({ FULL: 100, CUSTOM: 75 }),
          type: 'object',
        })
      )

      const policies = await service.getReassignmentPayoutPolicies()
      expect(policies).toEqual({ FULL: 100, CUSTOM: 75 })
    })

    it('falls back to default policies when a value is out of range (>100)', async () => {
      configRepository.getByKey.mockResolvedValue(
        new ConfigEntity({
          key: ConfigKey.REASSIGNMENT_PAYOUT_POLICIES,
          value: JSON.stringify({ OVER_PAY: 150 }),
          type: 'object',
        })
      )

      const policies = await service.getReassignmentPayoutPolicies()
      expect(policies).toEqual(FALLBACK_REASSIGNMENT_PAYOUT_POLICIES)
    })
  })

  describe('setInstanceConfigSettings', () => {
    // Helper to simulate a record not found error from Prisma
    const notFoundError = new Error('Record not found in config table')
    notFoundError.name = 'NotFoundError'

    // Helper for default-only update tests where only a stored menu exists
    const storedMenuOnly = async (key: string) => {
      if (key === ConfigKey.REASSIGNMENT_PAYOUT_POLICIES) {
        return new ConfigEntity({
          key: ConfigKey.REASSIGNMENT_PAYOUT_POLICIES,
          value: JSON.stringify({ FULL_COMPENSATION: 100, HALF_COMPENSATION: 50 }),
          type: 'object',
        })
      }
      throw notFoundError
    }

    it('throws BadRequestException when saving policy values out of range', async () => {
      await expect(
        service.setInstanceConfigSettings({
          reassignmentPayoutPolicies: { BAD: 120 },
        })
      ).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException when default policy is not a key in policies menu (Case A)', async () => {
      await expect(
        service.setInstanceConfigSettings({
          reassignmentPayoutPolicies: { FULL: 100 },
          reassignmentPayoutDefaultPolicy: 'NON_EXISTENT',
        })
      ).rejects.toThrow(BadRequestException)
    })

    // Test Plan A Case 1: Narrower menu that drops the stored default is rejected
    it('throws BadRequestException naming stored default and allowed keys when narrowing menu drops stored default (Case B)', async () => {
      configRepository.getByKey.mockImplementation(async (key: string) => {
        if (key === ConfigKey.REASSIGNMENT_PAYOUT_POLICIES) {
          return new ConfigEntity({
            key: ConfigKey.REASSIGNMENT_PAYOUT_POLICIES,
            value: JSON.stringify({ FULL_COMPENSATION: 100, HALF_COMPENSATION: 50 }),
            type: 'object',
          })
        }
        if (key === ConfigKey.REASSIGNMENT_PAYOUT_DEFAULT_POLICY) {
          return new ConfigEntity({
            key: ConfigKey.REASSIGNMENT_PAYOUT_DEFAULT_POLICY,
            value: 'HALF_COMPENSATION',
            type: 'string',
          })
        }
        throw notFoundError
      })

      // Run the rejected write once and keep the error, inspecting it directly
      const error = await service
        .setInstanceConfigSettings({ reassignmentPayoutPolicies: { FULL_COMPENSATION: 100 } })
        .catch((e) => e)

      expect(error).toBeInstanceOf(BadRequestException)
      expect(error.message).toContain('the stored default policy')
      expect(error.message).toContain('HALF_COMPENSATION')
      expect(error.message).toContain('FULL_COMPENSATION')
      expect(error.message).toContain(
        'Send reassignmentPayoutDefaultPolicy together with reassignmentPayoutPolicies'
      )
    })

    it('names the in-code fallback, not a stored row, when no default policy has ever been stored (Case B)', async () => {
      configRepository.getByKey.mockImplementation(async () => {
        throw notFoundError
      })

      const error = await service
        .setInstanceConfigSettings({ reassignmentPayoutPolicies: { NO_COMPENSATION: 0 } })
        .catch((e) => e)

      expect(error).toBeInstanceOf(BadRequestException)
      expect(error.message).toContain('no stored default policy')
      expect(error.message).toContain(FALLBACK_REASSIGNMENT_PAYOUT_DEFAULT_POLICY)
      expect(error.message).toContain('NO_COMPENSATION')
      expect(error.message).toContain(
        'Send reassignmentPayoutDefaultPolicy together with reassignmentPayoutPolicies'
      )
      expect(error.message).not.toContain('the stored default policy')
      expect(configRepository.saveByKey).not.toHaveBeenCalled()
    })

    it('accepts a default-only update when the key is on the stored menu', async () => {
      configRepository.getByKey.mockImplementation(storedMenuOnly)

      await service.setInstanceConfigSettings({ reassignmentPayoutDefaultPolicy: 'HALF_COMPENSATION' })

      expect(configRepository.saveByKey).toHaveBeenCalledWith(
        ConfigKey.REASSIGNMENT_PAYOUT_DEFAULT_POLICY,
        'HALF_COMPENSATION'
      )
      expect(configRepository.saveByKey).not.toHaveBeenCalledWith(
        ConfigKey.REASSIGNMENT_PAYOUT_POLICIES,
        expect.anything()
      )
      expect(configRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.UPDATED_AT, expect.any(String))
    })

    it('rejects a default-only update when the key is not on the stored menu', async () => {
      configRepository.getByKey.mockImplementation(storedMenuOnly)

      const error = await service
        .setInstanceConfigSettings({ reassignmentPayoutDefaultPolicy: 'NO_COMPENSATION' })
        .catch((e) => e)

      expect(error).toBeInstanceOf(BadRequestException)
      expect(error.message).toContain('NO_COMPENSATION')
      expect(configRepository.saveByKey).not.toHaveBeenCalled()
    })

    // Test Plan A Case 2: A rejected write leaves the Config table untouched
    it('leaves the Config table completely untouched (saveByKey not called) when validation fails', async () => {
      configRepository.getByKey.mockImplementation(async (key: string) => {
        if (key === ConfigKey.REASSIGNMENT_PAYOUT_DEFAULT_POLICY) {
          return new ConfigEntity({
            key: ConfigKey.REASSIGNMENT_PAYOUT_DEFAULT_POLICY,
            value: 'HALF_COMPENSATION',
            type: 'string',
          })
        }
        throw notFoundError
      })

      // Call with unrelated fields alongside a menu change that would orphan the stored default
      await expect(
        service.setInstanceConfigSettings({
          currency: EnumCurrency.EUR,
          maxAssignmentDistance: 20,
          reassignmentPayoutPolicies: { FULL_COMPENSATION: 100 },
        })
      ).rejects.toThrow(BadRequestException)

      // Phase 1 validation must prevent any Phase 2 writes from executing
      expect(configRepository.saveByKey).not.toHaveBeenCalled()
    })

    // Test Plan A Case 3: A menu change that keeps the stored default succeeds
    it('succeeds and saves new menu when menu change keeps the stored default', async () => {
      configRepository.getByKey.mockImplementation(async (key: string) => {
        // returned by getInstanceConfigSettings() at the end of setInstanceConfigSettings
        if (key === ConfigKey.REASSIGNMENT_PAYOUT_POLICIES) {
          return new ConfigEntity({
            key: ConfigKey.REASSIGNMENT_PAYOUT_POLICIES,
            value: JSON.stringify({ FULL_COMPENSATION: 100, HALF_COMPENSATION: 50 }),
            type: 'object',
          })
        }
        if (key === ConfigKey.REASSIGNMENT_PAYOUT_DEFAULT_POLICY) {
          return new ConfigEntity({
            key: ConfigKey.REASSIGNMENT_PAYOUT_DEFAULT_POLICY,
            value: 'FULL_COMPENSATION',
            type: 'string',
          })
        }
        throw notFoundError
      })

      const result = await service.setInstanceConfigSettings({
        reassignmentPayoutPolicies: { FULL_COMPENSATION: 100, NO_COMPENSATION: 0 },
      })

      expect(result).toBeDefined()
      expect(configRepository.saveByKey).toHaveBeenCalledWith(
        ConfigKey.REASSIGNMENT_PAYOUT_POLICIES,
        JSON.stringify({ FULL_COMPENSATION: 100, NO_COMPENSATION: 0 })
      )
      expect(configRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.UPDATED_AT, expect.any(String))
    })

    // Test Plan A Case 4: Default supplied alongside a menu that contains it succeeds
    it('succeeds and saves both menu and default when default is supplied alongside a matching menu', async () => {
      configRepository.getByKey.mockImplementation(async (key: string) => {
        throw notFoundError
      })

      await service.setInstanceConfigSettings({
        reassignmentPayoutPolicies: { FULL_COMPENSATION: 100, CUSTOM: 80 },
        reassignmentPayoutDefaultPolicy: 'CUSTOM',
      })

      expect(configRepository.saveByKey).toHaveBeenCalledWith(
        ConfigKey.REASSIGNMENT_PAYOUT_POLICIES,
        JSON.stringify({ FULL_COMPENSATION: 100, CUSTOM: 80 })
      )
      expect(configRepository.saveByKey).toHaveBeenCalledWith(
        ConfigKey.REASSIGNMENT_PAYOUT_DEFAULT_POLICY,
        'CUSTOM'
      )
      expect(configRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.UPDATED_AT, expect.any(String))
    })
  })

  describe('quoteRatePerDistanceUnit', () => {
    const notFoundError = new Error('Record not found in config table')
    notFoundError.name = 'NotFoundError'

    // E1. getQuoteRatePerDistanceUnit() returns stored value when present
    it('returns stored quoteRatePerDistanceUnit when present in config repository', async () => {
      configRepository.getByKey.mockResolvedValue(
        new ConfigEntity({
          key: ConfigKey.QUOTE_RATE_PER_DISTANCE_UNIT,
          value: '150',
          type: 'number',
        })
      )

      const rate = await service.getQuoteRatePerDistanceUnit()
      expect(rate).toBe(150)
    })

    // E2. Falls back to DEFAULT_QUOTE_RATE_PER_DISTANCE_UNIT when row is missing
    it('falls back to fileConfigService default when stored row is missing', async () => {
      configRepository.getByKey.mockRejectedValue(notFoundError)
      fileConfigService.get.mockReturnValue('150')

      const rate = await service.getQuoteRatePerDistanceUnit()

      expect(rate).toBe(150)
      expect(fileConfigService.get).toHaveBeenCalledWith(DEFAULT_QUOTE_RATE_PER_DISTANCE_UNIT)
    })

    // E3. Fractional stored value '87.5' returns 87.5 (not truncated by parseInt)
    it('preserves fractional rates like 87.5 without truncating via parseInt', async () => {
      configRepository.getByKey.mockResolvedValue(
        new ConfigEntity({
          key: ConfigKey.QUOTE_RATE_PER_DISTANCE_UNIT,
          value: '87.5',
          type: 'number',
        })
      )

      const rate = await service.getQuoteRatePerDistanceUnit()
      expect(rate).toBe(87.5)
    })

    // E4. setInstanceConfigSettings({ quoteRatePerDistanceUnit: 0 }) calls saveByKey with 0
    it('saves a voted rate of 0 when explicitly passed to setInstanceConfigSettings', async () => {
      configRepository.getByKey.mockRejectedValue(notFoundError)

      await service.setInstanceConfigSettings({ quoteRatePerDistanceUnit: 0 })

      expect(configRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.QUOTE_RATE_PER_DISTANCE_UNIT, 0)
    })

    // E5. setInstanceConfigSettings({}) does not call saveByKey for rate key
    it('does not touch quoteRatePerDistanceUnit when not present in input payload', async () => {
      configRepository.getByKey.mockRejectedValue(notFoundError)

      await service.setInstanceConfigSettings({})

      expect(configRepository.saveByKey).not.toHaveBeenCalledWith(
        ConfigKey.QUOTE_RATE_PER_DISTANCE_UNIT,
        expect.anything()
      )
    })

    // E6. getInstanceConfigSettings() includes quoteRatePerDistanceUnit in result
    it('includes quoteRatePerDistanceUnit in getInstanceConfigSettings output', async () => {
      configRepository.getByKey.mockImplementation(async (key: string) => {
        if (key === ConfigKey.QUOTE_RATE_PER_DISTANCE_UNIT) {
          return new ConfigEntity({
            key: ConfigKey.QUOTE_RATE_PER_DISTANCE_UNIT,
            value: '150',
            type: 'number',
          })
        }
        throw notFoundError
      })

      const settings = await service.getInstanceConfigSettings()
      expect(settings.quoteRatePerDistanceUnit).toBe(150)
    })
  })

  describe('quoteBaseFee (AC-4)', () => {
    const notFoundError = new Error('Record not found in config table')
    notFoundError.name = 'NotFoundError'

    beforeEach(() => {
      configRepository.getByKey.mockRejectedValue(notFoundError)
    })

    it('returns stored quoteBaseFee when present as integer', async () => {
      configRepository.getByKey.mockResolvedValue(
        new ConfigEntity({
          key: ConfigKey.QUOTE_BASE_FEE,
          value: '200',
          type: 'number',
        })
      )

      const baseFee = await service.getQuoteBaseFee()
      expect(baseFee).toBe(200)
    })

    it('falls back to DEFAULT_QUOTE_BASE_FEE when row is missing', async () => {
      configRepository.getByKey.mockRejectedValue(notFoundError)
      fileConfigService.get.mockReturnValue('200')

      const baseFee = await service.getQuoteBaseFee()

      expect(baseFee).toBe(200)
      expect(fileConfigService.get).toHaveBeenCalledWith(DEFAULT_QUOTE_BASE_FEE)
    })

    it('throws when stored quoteBaseFee is not a whole number of cents (e.g. "12.5")', async () => {
      configRepository.getByKey.mockResolvedValue(
        new ConfigEntity({
          key: ConfigKey.QUOTE_BASE_FEE,
          value: '12.5',
          type: 'number',
        })
      )

      await expect(service.getQuoteBaseFee()).rejects.toThrow(
        'quoteBaseFee must be a whole number of cents, 0 or more (found 12.5)'
      )
    })

    it('throws when stored quoteBaseFee is invalid text (e.g. "abc")', async () => {
      configRepository.getByKey.mockResolvedValue(
        new ConfigEntity({
          key: ConfigKey.QUOTE_BASE_FEE,
          value: 'abc',
          type: 'string',
        })
      )

      await expect(service.getQuoteBaseFee()).rejects.toThrow(
        'quoteBaseFee must be a whole number of cents, 0 or more (found abc)'
      )
    })

    it('throws when stored quoteBaseFee is empty string ""', async () => {
      configRepository.getByKey.mockResolvedValue(
        new ConfigEntity({
          key: ConfigKey.QUOTE_BASE_FEE,
          value: '',
          type: 'string',
        })
      )

      await expect(service.getQuoteBaseFee()).rejects.toThrow(
        'quoteBaseFee must be a whole number of cents, 0 or more (found )'
      )
    })

    it('throws when stored quoteBaseFee is a negative string (e.g. "-1")', async () => {
      configRepository.getByKey.mockResolvedValue(
        new ConfigEntity({
          key: ConfigKey.QUOTE_BASE_FEE,
          value: '-1',
          type: 'number',
        })
      )

      await expect(service.getQuoteBaseFee()).rejects.toThrow(
        'quoteBaseFee must be a whole number of cents, 0 or more (found -1)'
      )
    })

    describe('getInstanceConfigSettings resilience against bad stored base fee', () => {
      const badValues = ['12.5', '-1', '', 'abc']

      badValues.forEach((badValue) => {
        it(`returns quoteBaseFee null in getInstanceConfigSettings when stored quoteBaseFee is invalid ("${badValue}"), leaving other settings intact`, async () => {
          configRepository.getByKey.mockImplementation(async (key: string) => {
            if (key === ConfigKey.QUOTE_BASE_FEE) {
              return new ConfigEntity({
                key: ConfigKey.QUOTE_BASE_FEE,
                value: badValue,
                type: 'string',
              })
            }
            if (key === ConfigKey.QUOTE_RATE_PER_DISTANCE_UNIT) {
              return new ConfigEntity({
                key: ConfigKey.QUOTE_RATE_PER_DISTANCE_UNIT,
                value: '150',
                type: 'number',
              })
            }
            throw notFoundError
          })

          const settings = await service.getInstanceConfigSettings()

          // Bad base fee returns null so the admin settings page can load and be fixed
          expect(settings.quoteBaseFee).toBeNull()
          // Other settings are still returned normally
          expect(settings.quoteRatePerDistanceUnit).toBe(150)
          expect(settings.currency).toBeDefined()
        })
      })

      it('returns numeric quoteBaseFee in getInstanceConfigSettings for valid stored value (e.g. 200)', async () => {
        configRepository.getByKey.mockImplementation(async (key: string) => {
          if (key === ConfigKey.QUOTE_BASE_FEE) {
            return new ConfigEntity({
              key: ConfigKey.QUOTE_BASE_FEE,
              value: '200',
              type: 'number',
            })
          }
          throw notFoundError
        })

        const settings = await service.getInstanceConfigSettings()
        expect(settings.quoteBaseFee).toBe(200)
      })

      it('returns numeric quoteBaseFee in getInstanceConfigSettings for valid zero stored value (0)', async () => {
        configRepository.getByKey.mockImplementation(async (key: string) => {
          if (key === ConfigKey.QUOTE_BASE_FEE) {
            return new ConfigEntity({
              key: ConfigKey.QUOTE_BASE_FEE,
              value: '0',
              type: 'number',
            })
          }
          throw notFoundError
        })

        const settings = await service.getInstanceConfigSettings()
        expect(settings.quoteBaseFee).toBe(0)
      })
    })

    it('refuses fractional quoteBaseFee of 12.5 in setInstanceConfigSettings with clear message naming quoteBaseFee', async () => {
      const promise = service.setInstanceConfigSettings({ quoteBaseFee: 12.5 })

      await expect(promise).rejects.toThrow(BadRequestException)
      await expect(promise).rejects.toThrow('quoteBaseFee must be a whole number of cents')
      expect(configRepository.saveByKey).not.toHaveBeenCalled()
    })

    it('saves a base fee of 0 when explicitly passed to setInstanceConfigSettings', async () => {
      await service.setInstanceConfigSettings({ quoteBaseFee: 0 })

      expect(configRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.QUOTE_BASE_FEE, 0)
    })

    it('refuses negative quoteBaseFee of -1 in setInstanceConfigSettings with clear message naming quoteBaseFee (AC-4)', async () => {
      const promise = service.setInstanceConfigSettings({ quoteBaseFee: -1 })

      await expect(promise).rejects.toThrow(BadRequestException)
      await expect(promise).rejects.toThrow('quoteBaseFee')
      expect(configRepository.saveByKey).not.toHaveBeenCalled()
    })

    it('refuses null quoteBaseFee in setInstanceConfigSettings with clear message naming quoteBaseFee (AC-4)', async () => {
      const promise = service.setInstanceConfigSettings({ quoteBaseFee: null } as any)

      await expect(promise).rejects.toThrow(BadRequestException)
      await expect(promise).rejects.toThrow('quoteBaseFee')
      expect(configRepository.saveByKey).not.toHaveBeenCalled()
    })

    it('has an entry in NUMERIC_SETTING_RULES for quoteBaseFee with mustBeWholeCents true', () => {
      const rule = NUMERIC_SETTING_RULES.find((r) => r.key === 'quoteBaseFee')
      expect(rule).toBeDefined()
      expect(rule?.mustBeWholeCents).toBe(true)
    })
  })

  describe('numeric setting rules (NUMERIC_SETTING_RULES)', () => {
    const notFoundError = new Error('Record not found in config table')
    notFoundError.name = 'NotFoundError'

    beforeEach(() => {
      configRepository.getByKey.mockRejectedValue(notFoundError)
    })

    describe('tests generated from NUMERIC_SETTING_RULES table', () => {
      NUMERIC_SETTING_RULES.forEach((rule) => {
        if (rule.whyZeroIsRefused === null) {
          it(`allows zero (0) for ${rule.key} and saves it to repository`, async () => {
            // Setting 0 should call configRepository.saveByKey with the setting key and 0
            await service.setInstanceConfigSettings({ [rule.key]: 0 })

            expect(configRepository.saveByKey).toHaveBeenCalledWith(rule.key, 0)
          })
        } else {
          it(`refuses 0 for ${rule.key} with clear explanation`, async () => {
            // Zero must be refused with the specified reason and nothing saved
            const promise = service.setInstanceConfigSettings({ [rule.key]: 0 })

            await expect(promise).rejects.toThrow(BadRequestException)
            await expect(promise).rejects.toThrow(
              `${rule.key} cannot be 0: ${rule.whyZeroIsRefused}`
            )
            expect(configRepository.saveByKey).not.toHaveBeenCalled()
          })
        }
      })
    })

    describe('negative numeric settings rejection', () => {
      NUMERIC_SETTING_RULES.forEach((rule) => {
        it(`rejects negative values for ${rule.key}`, async () => {
          // Negative values are invalid for all numeric settings
          const promise = service.setInstanceConfigSettings({ [rule.key]: -5 })

          await expect(promise).rejects.toThrow(BadRequestException)
          await expect(promise).rejects.toThrow(`${rule.key} cannot be negative`)
          expect(configRepository.saveByKey).not.toHaveBeenCalled()
        })
      })
    })

    describe('invalid non-number types rejection', () => {
      NUMERIC_SETTING_RULES.forEach((rule) => {
        it(`rejects null value for ${rule.key} with "must be a number"`, async () => {
          // JSON null is passed by @IsOptional(), service must reject it
          const promise = service.setInstanceConfigSettings({ [rule.key]: null as any })

          await expect(promise).rejects.toThrow(BadRequestException)
          await expect(promise).rejects.toThrow(`${rule.key} must be a number`)
          expect(configRepository.saveByKey).not.toHaveBeenCalled()
        })

        it(`rejects NaN value for ${rule.key}`, async () => {
          // NaN is not a finite number
          const promise = service.setInstanceConfigSettings({ [rule.key]: NaN })

          await expect(promise).rejects.toThrow(BadRequestException)
          await expect(promise).rejects.toThrow(`${rule.key} must be a number`)
          expect(configRepository.saveByKey).not.toHaveBeenCalled()
        })
      })
    })

    describe('truthy check guard', () => {
      it('fails if numeric setting saves switch back to truthy checks (if (data.x)) instead of !== undefined', async () => {
        // Test all zero-allowed settings dynamically derived from NUMERIC_SETTING_RULES
        const zeroAllowedSettings = NUMERIC_SETTING_RULES.filter(
          (rule) => rule.whyZeroIsRefused === null
        )
        const payload = zeroAllowedSettings.reduce(
          (acc, rule) => ({ ...acc, [rule.key]: 0 }),
          {}
        )

        await service.setInstanceConfigSettings(payload)

        // Assert each key was saved as 0, proving none was dropped by a truthy check
        zeroAllowedSettings.forEach((rule) => {
          expect(configRepository.saveByKey).toHaveBeenCalledWith(rule.key, 0)
        })
      })
    })

    describe('minimum numeric settings boundary rejection', () => {
      NUMERIC_SETTING_RULES.filter((rule) => rule.min !== undefined).forEach((rule) => {
        it(`rejects value below min for ${rule.key} (${rule.min! - 1}) naming setting`, async () => {
          const promise = service.setInstanceConfigSettings({ [rule.key]: rule.min! - 1 })
          await expect(promise).rejects.toThrow(BadRequestException)
          // A minimum of 1 puts min - 1 at 0, which the zero rule refuses first, with its own reason.
          const expected =
            rule.min! - 1 === 0 && rule.whyZeroIsRefused !== null
              ? `${rule.key} cannot be 0`
              : `${rule.key} must be ${rule.min} or more`
          await expect(promise).rejects.toThrow(expected)
          expect(configRepository.saveByKey).not.toHaveBeenCalled()
        })

        it(`accepts exact min boundary value for ${rule.key} (${rule.min})`, async () => {
          await service.setInstanceConfigSettings({ [rule.key]: rule.min })
          expect(configRepository.saveByKey).toHaveBeenCalledWith(rule.key, rule.min)
        })
      })
    })

    describe('maximum numeric settings boundary rejection', () => {
      NUMERIC_SETTING_RULES.filter((rule) => rule.max !== undefined).forEach((rule) => {
        it(`rejects value above max for ${rule.key} (${rule.max! + 1}) naming setting`, async () => {
          const promise = service.setInstanceConfigSettings({ [rule.key]: rule.max! + 1 })
          await expect(promise).rejects.toThrow(BadRequestException)
          await expect(promise).rejects.toThrow(`${rule.key} must be ${rule.max} or less`)
          expect(configRepository.saveByKey).not.toHaveBeenCalled()
        })

        it(`accepts exact max boundary value for ${rule.key} (${rule.max})`, async () => {
          await service.setInstanceConfigSettings({ [rule.key]: rule.max })
          expect(configRepository.saveByKey).toHaveBeenCalledWith(rule.key, rule.max)
        })
      })
    })

    describe('integer requirement rejection', () => {
      NUMERIC_SETTING_RULES.filter((rule) => rule.mustBeInteger).forEach((rule) => {
        it(`rejects fractional value for ${rule.key} (60.5) naming setting`, async () => {
          const promise = service.setInstanceConfigSettings({ [rule.key]: 60.5 })
          await expect(promise).rejects.toThrow(BadRequestException)
          await expect(promise).rejects.toThrow(`${rule.key} must be a whole number`)
          expect(configRepository.saveByKey).not.toHaveBeenCalled()
        })
      })
    })

    describe('offerExpiryEnabled saving', () => {
      it('saves false for offerExpiryEnabled (not dropped by a truthy check)', async () => {
        await service.setInstanceConfigSettings({ offerExpiryEnabled: false })
        expect(configRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.OFFER_EXPIRY_ENABLED, false)
      })

      it('saves true for offerExpiryEnabled', async () => {
        await service.setInstanceConfigSettings({ offerExpiryEnabled: true })
        expect(configRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.OFFER_EXPIRY_ENABLED, true)
      })

      it('refuses non-boolean offerExpiryEnabled if sent to domain service', async () => {
        const promise = service.setInstanceConfigSettings({ offerExpiryEnabled: 'false' as any })
        await expect(promise).rejects.toThrow(BadRequestException)
        await expect(promise).rejects.toThrow('offerExpiryEnabled must be true or false')
      })
    })
  })

  describe('offer expiry getters (AC-10)', () => {
    const notFoundError = new Error('Record not found in config table')
    notFoundError.name = 'NotFoundError'

    it('getOfferExpiryEnabled: returns false on missing row, true on true, false on false or non-boolean', async () => {
      // 1. Missing row -> default false
      configRepository.getByKey.mockRejectedValueOnce(notFoundError)
      expect(await service.getOfferExpiryEnabled()).toBe(false)

      // 2. Stored true -> true
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.OFFER_EXPIRY_ENABLED, value: 'true', type: 'boolean' })
      )
      expect(await service.getOfferExpiryEnabled()).toBe(true)

      // 3. Stored false -> false
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.OFFER_EXPIRY_ENABLED, value: 'false', type: 'boolean' })
      )
      expect(await service.getOfferExpiryEnabled()).toBe(false)

      // 4. Stored invalid string -> false
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.OFFER_EXPIRY_ENABLED, value: 'something', type: 'string' })
      )
      expect(await service.getOfferExpiryEnabled()).toBe(false)
    })

    it('getOfferExpirySeconds: returns 60 on missing row, stored value if valid, and default 60 if out of range or fractional', async () => {
      // 1. Missing row -> default 60
      configRepository.getByKey.mockRejectedValueOnce(notFoundError)
      expect(await service.getOfferExpirySeconds()).toBe(60)

      // 2. Stored valid (45) -> 45
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.OFFER_EXPIRY_SECONDS, value: '45', type: 'number' })
      )
      expect(await service.getOfferExpirySeconds()).toBe(45)

      // 3. Stored below min (19) -> fallback to default 60
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.OFFER_EXPIRY_SECONDS, value: '19', type: 'number' })
      )
      expect(await service.getOfferExpirySeconds()).toBe(60)

      // 4. Stored above max (301) -> fallback to default 60
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.OFFER_EXPIRY_SECONDS, value: '301', type: 'number' })
      )
      expect(await service.getOfferExpirySeconds()).toBe(60)

      // 5. Stored fractional (60.5) -> fallback to default 60
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.OFFER_EXPIRY_SECONDS, value: '60.5', type: 'number' })
      )
      expect(await service.getOfferExpirySeconds()).toBe(60)
    })

    it('getNoCourierRetrySeconds: returns 30 on missing row, stored value if valid, and default 30 if out of range or fractional', async () => {
      // 1. Missing row -> default 30
      configRepository.getByKey.mockRejectedValueOnce(notFoundError)
      expect(await service.getNoCourierRetrySeconds()).toBe(30)

      // 2. Stored valid (15) -> 15
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.NO_COURIER_RETRY_SECONDS, value: '15', type: 'number' })
      )
      expect(await service.getNoCourierRetrySeconds()).toBe(15)

      // 3. Stored below min (9) -> fallback to default 30
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.NO_COURIER_RETRY_SECONDS, value: '9', type: 'number' })
      )
      expect(await service.getNoCourierRetrySeconds()).toBe(30)

      // 4. Stored above max (301) -> fallback to default 30
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.NO_COURIER_RETRY_SECONDS, value: '301', type: 'number' })
      )
      expect(await service.getNoCourierRetrySeconds()).toBe(30)

      // 5. Stored fractional (15.5) -> fallback to default 30
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.NO_COURIER_RETRY_SECONDS, value: '15.5', type: 'number' })
      )
      expect(await service.getNoCourierRetrySeconds()).toBe(30)
    })

    it('getSavedCustomerRetentionMonths: returns default 12 on missing row, stored value if valid, and default 12 if out of range or fractional (AC-7)', async () => {
      // 1. Missing row -> default 12
      configRepository.getByKey.mockRejectedValueOnce(notFoundError)
      expect(await service.getSavedCustomerRetentionMonths()).toBe(12)

      // 2. Stored valid (24) -> 24
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.SAVED_CUSTOMER_RETENTION_MONTHS, value: '24', type: 'number' })
      )
      expect(await service.getSavedCustomerRetentionMonths()).toBe(24)

      // 3. Stored below min (0) -> fallback to default 12
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.SAVED_CUSTOMER_RETENTION_MONTHS, value: '0', type: 'number' })
      )
      expect(await service.getSavedCustomerRetentionMonths()).toBe(12)

      // 4. Stored below min (-1) -> fallback to default 12
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.SAVED_CUSTOMER_RETENTION_MONTHS, value: '-1', type: 'number' })
      )
      expect(await service.getSavedCustomerRetentionMonths()).toBe(12)

      // 5. Stored above max (37) -> fallback to default 12
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.SAVED_CUSTOMER_RETENTION_MONTHS, value: '37', type: 'number' })
      )
      expect(await service.getSavedCustomerRetentionMonths()).toBe(12)

      // 6. Stored fractional (12.5) -> fallback to default 12
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.SAVED_CUSTOMER_RETENTION_MONTHS, value: '12.5', type: 'number' })
      )
      expect(await service.getSavedCustomerRetentionMonths()).toBe(12)
    })

    describe('setInstanceConfigSettings - savedCustomerRetentionMonths (AC-7)', () => {
      it('refuses 0, "", 37, 12.5, "12", -1 naming the setting', async () => {
        // 0 refused with whyZeroIsRefused
        await expect(
          service.setInstanceConfigSettings({ savedCustomerRetentionMonths: 0 } as any)
        ).rejects.toThrow('savedCustomerRetentionMonths cannot be 0: every saved customer would be deleted the day it was saved')

        // "" refused
        await expect(
          service.setInstanceConfigSettings({ savedCustomerRetentionMonths: '' } as any)
        ).rejects.toThrow('savedCustomerRetentionMonths')

        // 37 refused (> max 36)
        await expect(
          service.setInstanceConfigSettings({ savedCustomerRetentionMonths: 37 } as any)
        ).rejects.toThrow('savedCustomerRetentionMonths must be 36 or less')

        // 12.5 refused (must be whole)
        await expect(
          service.setInstanceConfigSettings({ savedCustomerRetentionMonths: 12.5 } as any)
        ).rejects.toThrow('savedCustomerRetentionMonths must be a whole number')

        // "12" string refused
        await expect(
          service.setInstanceConfigSettings({ savedCustomerRetentionMonths: '12' } as any)
        ).rejects.toThrow('savedCustomerRetentionMonths')

        // -1 refused (< 0)
        await expect(
          service.setInstanceConfigSettings({ savedCustomerRetentionMonths: -1 } as any)
        ).rejects.toThrow('savedCustomerRetentionMonths cannot be negative')
      })

      it('saves valid whole values 1, 12 and 36', async () => {
        configRepository.getByKey.mockRejectedValue(notFoundError)

        for (const validVal of [1, 12, 36]) {
          await service.setInstanceConfigSettings({ savedCustomerRetentionMonths: validVal })
          expect(configRepository.saveByKey).toHaveBeenCalledWith(
            ConfigKey.SAVED_CUSTOMER_RETENTION_MONTHS,
            validVal
          )
        }
      })
    })
  })

  describe('read-back of stored 0 values', () => {
    it('makes getFeePercentageAmount() return 0 for a stored config row with value "0" and type "number"', async () => {
      configRepository.getByKey.mockResolvedValue(
        new ConfigEntity({
          key: ConfigKey.FEE_PERCENTAGE_AMOUNT,
          value: '0',
          type: 'number',
        })
      )

      const fee = await service.getFeePercentageAmount()
      expect(fee).toBe(0)
    })

    it('makes getDefaultCourierPayRate() return 0 for a stored config row with value "0" and type "number"', async () => {
      configRepository.getByKey.mockResolvedValue(
        new ConfigEntity({
          key: ConfigKey.DEFAULT_COURIER_PAY_RATE,
          value: '0',
          type: 'number',
        })
      )

      const payRate = await service.getDefaultCourierPayRate()
      expect(payRate).toBe(0)
    })

    it('makes getMaxDriftDistance() return 0 for a stored config row with value "0" and type "number"', async () => {
      configRepository.getByKey.mockResolvedValue(
        new ConfigEntity({
          key: ConfigKey.MAX_DRIFT_DISTANCE,
          value: '0',
          type: 'number',
        })
      )

      const maxDrift = await service.getMaxDriftDistance()
      expect(maxDrift).toBe(0)
    })
  })
})
