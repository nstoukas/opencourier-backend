import { BadRequestException } from '@nestjs/common'
import { InstanceConfigDomainService } from './instance-config.domain.service'
import { ConfigRepository } from '../../persistence/repositories/config.repository'
import { ConfigService } from '@nestjs/config'
import {
  ConfigKey,
  EnumCurrency,
  FALLBACK_REASSIGNMENT_PAYOUT_POLICIES,
  FALLBACK_REASSIGNMENT_PAYOUT_DEFAULT_POLICY,
} from 'src/shared-types'
import { DEFAULT_QUOTE_RATE_PER_DISTANCE_UNIT } from 'src/constants'
import { ConfigEntity } from './entities/config.entity'
import { InstanceConfigSettingsInput } from 'src/rest-api/config/admin/queries/instance-config-settings.input'

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
      get: jest.fn().mockReturnValue('default_value'),
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

  describe('defaultMinimumCourierPay', () => {
    const notFoundError = new Error('Record not found in config table')
    notFoundError.name = 'NotFoundError'

    it('saves a voted floor of 0 when explicitly passed to setInstanceConfigSettings', async () => {
      configRepository.getByKey.mockRejectedValue(notFoundError)

      await service.setInstanceConfigSettings({ defaultMinimumCourierPay: 0 })

      expect(configRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.DEFAULT_MINIMUM_COURIER_PAY, 0)
    })

    it('preserves fractional floor values like 250.5 without truncating via parseInt', async () => {
      configRepository.getByKey.mockResolvedValue(
        new ConfigEntity({
          key: ConfigKey.DEFAULT_MINIMUM_COURIER_PAY,
          value: '250.5',
          type: 'number',
        })
      )

      const floor = await service.getDefaultMinimumCourierPay()
      expect(floor).toBe(250.5)
    })
  })

  describe('numeric setting rules (NUMERIC_SETTING_RULES)', () => {
    const notFoundError = new Error('Record not found in config table')
    notFoundError.name = 'NotFoundError'

    beforeEach(() => {
      configRepository.getByKey.mockRejectedValue(notFoundError)
    })

    describe('zero-allowed numeric settings', () => {
      const allowedSettings: Array<{ key: keyof InstanceConfigSettingsInput; configKey: ConfigKey }> = [
        { key: 'feePercentageAmount', configKey: ConfigKey.FEE_PERCENTAGE_AMOUNT },
        { key: 'quoteRatePerDistanceUnit', configKey: ConfigKey.QUOTE_RATE_PER_DISTANCE_UNIT },
        { key: 'defaultCourierPayRate', configKey: ConfigKey.DEFAULT_COURIER_PAY_RATE },
        { key: 'defaultMinimumCourierPay', configKey: ConfigKey.DEFAULT_MINIMUM_COURIER_PAY },
        { key: 'maxDriftDistance', configKey: ConfigKey.MAX_DRIFT_DISTANCE },
      ]

      allowedSettings.forEach(({ key, configKey }) => {
        it(`allows zero (0) for ${key} and saves it to repository`, async () => {
          // Setting 0 should call configRepository.saveByKey with 0
          await service.setInstanceConfigSettings({ [key]: 0 })

          expect(configRepository.saveByKey).toHaveBeenCalledWith(configKey, 0)
        })
      })
    })

    describe('zero-refused numeric settings', () => {
      it('refuses 0 for maxAssignmentDistance with clear explanation', async () => {
        // Zero in maxAssignmentDistance means no limit in matcher, so it must be refused
        const promise = service.setInstanceConfigSettings({ maxAssignmentDistance: 0 })

        await expect(promise).rejects.toThrow(BadRequestException)
        await expect(promise).rejects.toThrow(
          'maxAssignmentDistance cannot be 0: the matcher reads 0 as "no limit" and would offer deliveries to couriers at any distance'
        )
        expect(configRepository.saveByKey).not.toHaveBeenCalled()
      })

      it('refuses 0 for quoteExpirationMinutes with clear explanation', async () => {
        // Zero expiration minutes causes instant expiry on quote creation
        const promise = service.setInstanceConfigSettings({ quoteExpirationMinutes: 0 })

        await expect(promise).rejects.toThrow(BadRequestException)
        await expect(promise).rejects.toThrow(
          'quoteExpirationMinutes cannot be 0: a quote would expire the moment it is made, so no delivery could be booked'
        )
        expect(configRepository.saveByKey).not.toHaveBeenCalled()
      })

      it('refuses 0 for defaultMaxWorkingHours with clear explanation', async () => {
        // Zero working hours leaves courier no time to work
        const promise = service.setInstanceConfigSettings({ defaultMaxWorkingHours: 0 })

        await expect(promise).rejects.toThrow(BadRequestException)
        await expect(promise).rejects.toThrow(
          'defaultMaxWorkingHours cannot be 0: a courier given this default would have no time to work'
        )
        expect(configRepository.saveByKey).not.toHaveBeenCalled()
      })
    })

    describe('negative numeric settings rejection', () => {
      const allNumericKeys: Array<keyof InstanceConfigSettingsInput> = [
        'feePercentageAmount',
        'quoteRatePerDistanceUnit',
        'defaultCourierPayRate',
        'defaultMinimumCourierPay',
        'maxDriftDistance',
        'maxAssignmentDistance',
        'quoteExpirationMinutes',
        'defaultMaxWorkingHours',
      ]

      allNumericKeys.forEach((key) => {
        it(`rejects negative values for ${key}`, async () => {
          // Negative values are invalid for all numeric settings
          const promise = service.setInstanceConfigSettings({ [key]: -5 })

          await expect(promise).rejects.toThrow(BadRequestException)
          await expect(promise).rejects.toThrow(`${key} cannot be negative`)
          expect(configRepository.saveByKey).not.toHaveBeenCalled()
        })
      })
    })

    describe('invalid non-number types rejection', () => {
      const allNumericKeys: Array<keyof InstanceConfigSettingsInput> = [
        'feePercentageAmount',
        'quoteRatePerDistanceUnit',
        'defaultCourierPayRate',
        'defaultMinimumCourierPay',
        'maxDriftDistance',
        'maxAssignmentDistance',
        'quoteExpirationMinutes',
        'defaultMaxWorkingHours',
      ]

      allNumericKeys.forEach((key) => {
        it(`rejects null value for ${key} with "must be a number"`, async () => {
          // JSON null is passed by @IsOptional(), service must reject it
          const promise = service.setInstanceConfigSettings({ [key]: null as any })

          await expect(promise).rejects.toThrow(BadRequestException)
          await expect(promise).rejects.toThrow(`${key} must be a number`)
          expect(configRepository.saveByKey).not.toHaveBeenCalled()
        })

        it(`rejects NaN value for ${key}`, async () => {
          // NaN is not a finite number
          const promise = service.setInstanceConfigSettings({ [key]: NaN })

          await expect(promise).rejects.toThrow(BadRequestException)
          await expect(promise).rejects.toThrow(`${key} must be a number`)
          expect(configRepository.saveByKey).not.toHaveBeenCalled()
        })
      })
    })

    describe('truthy check guard', () => {
      it('fails if numeric setting saves switch back to truthy checks (if (data.x)) instead of !== undefined', async () => {
        // Test all zero-allowed settings in a single payload of zeros
        await service.setInstanceConfigSettings({
          feePercentageAmount: 0,
          quoteRatePerDistanceUnit: 0,
          defaultCourierPayRate: 0,
          defaultMinimumCourierPay: 0,
          maxDriftDistance: 0,
        })

        // Assert each key was saved as 0, proving none was dropped by a truthy check
        expect(configRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.FEE_PERCENTAGE_AMOUNT, 0)
        expect(configRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.QUOTE_RATE_PER_DISTANCE_UNIT, 0)
        expect(configRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.DEFAULT_COURIER_PAY_RATE, 0)
        expect(configRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.DEFAULT_MINIMUM_COURIER_PAY, 0)
        expect(configRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.MAX_DRIFT_DISTANCE, 0)
      })
    })
  })
})

