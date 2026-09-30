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
