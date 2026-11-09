import { BadRequestException } from '@nestjs/common'
import { InstanceConfigDomainService, NUMERIC_SETTING_RULES } from './instance-config.domain.service'
import { ConfigRepository } from '../../persistence/repositories/config.repository'
import { ConfigService } from '@nestjs/config'
import {
  ConfigKey,
  EnumCourierMatcherType,
  EnumCurrency,
  FALLBACK_REASSIGNMENT_PAYOUT_POLICIES,
  FALLBACK_REASSIGNMENT_PAYOUT_DEFAULT_POLICY,
} from 'src/shared-types'
import {
  DEFAULT_QUOTE_RATE_PER_DISTANCE_UNIT,
  DEFAULT_QUOTE_BASE_FEE,
  DEFAULT_ARRIVAL_RADIUS_METRES,
  ARRIVAL_RADIUS_METRES_MIN,
  ARRIVAL_RADIUS_METRES_MAX,
  DEFAULT_SOS_LOCATION_RETENTION_DAYS,
  SOS_LOCATION_RETENTION_DAYS_MIN,
  SOS_LOCATION_RETENTION_DAYS_MAX,
} from 'src/constants'
import { ConfigEntity } from './entities/config.entity'
import { DISPATCH_PHONE_NUMBER_REFUSAL } from './dispatch-phone-number'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import { PRISMA_RECORD_NOT_FOUND_ERROR } from 'src/prisma.util'

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

    describe('cancellationPayoutPolicy (Spec 0015 AC-4)', () => {
      it('getCancellationPayoutPolicy returns stored policy when present', async () => {
        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({
            key: ConfigKey.CANCELLATION_PAYOUT_POLICY,
            value: 'HALF_COMPENSATION',
            type: 'string',
          })
        )
        const policy = await service.getCancellationPayoutPolicy()
        expect(policy).toBe('HALF_COMPENSATION')
      })

      it('getCancellationPayoutPolicy falls back to FULL_COMPENSATION quietly when missing from DB', async () => {
        configRepository.getByKey.mockRejectedValueOnce(notFoundError)
        const policy = await service.getCancellationPayoutPolicy()
        expect(policy).toBe('FULL_COMPENSATION')
      })

      it('getStoredCancellationPayoutPolicy returns null quietly when missing from DB', async () => {
        configRepository.getByKey.mockRejectedValueOnce(notFoundError)
        const policy = await service.getStoredCancellationPayoutPolicy()
        expect(policy).toBeNull()
      })

      it('throws BadRequestException (400) when saving cancellationPayoutPolicy not on the menu', async () => {
        configRepository.getByKey.mockImplementation(async (key: string) => {
          if (key === ConfigKey.REASSIGNMENT_PAYOUT_POLICIES) {
            return new ConfigEntity({
              key: ConfigKey.REASSIGNMENT_PAYOUT_POLICIES,
              value: JSON.stringify({ FULL_COMPENSATION: 100, HALF_COMPENSATION: 50 }),
              type: 'object',
            })
          }
          throw notFoundError
        })

        await expect(
          service.setInstanceConfigSettings({
            cancellationPayoutPolicy: 'NOT_ON_MENU',
          })
        ).rejects.toThrow(BadRequestException)

        try {
          await service.setInstanceConfigSettings({
            cancellationPayoutPolicy: 'NOT_ON_MENU',
          })
        } catch (err: any) {
          expect(err.message).toContain("Invalid cancellationPayoutPolicy 'NOT_ON_MENU'")
          expect(err.message).toContain('Allowed policies: FULL_COMPENSATION, HALF_COMPENSATION')
        }
      })

      it('throws BadRequestException (400) when menu save drops the stored cancellationPayoutPolicy', async () => {
        configRepository.getByKey.mockImplementation(async (key: string) => {
          if (key === ConfigKey.CANCELLATION_PAYOUT_POLICY) {
            return new ConfigEntity({
              key: ConfigKey.CANCELLATION_PAYOUT_POLICY,
              value: 'HALF_COMPENSATION',
              type: 'string',
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

        // The new menu keeps FULL_COMPENSATION (so default policy check passes) but drops HALF_COMPENSATION
        await expect(
          service.setInstanceConfigSettings({
            reassignmentPayoutPolicies: { FULL_COMPENSATION: 100 },
          })
        ).rejects.toThrow(BadRequestException)

        try {
          await service.setInstanceConfigSettings({
            reassignmentPayoutPolicies: { FULL_COMPENSATION: 100 },
          })
        } catch (err: any) {
          expect(err.message).toContain(
            "the stored cancellationPayoutPolicy 'HALF_COMPENSATION' is not a key in the new menu"
          )
          expect(err.message).toContain('Send cancellationPayoutPolicy together with reassignmentPayoutPolicies')
        }
      })

      it('throws BadRequestException (400) when menu save drops FULL_COMPENSATION with no stored cancellation rule', async () => {
        // Pass reassignmentPayoutDefaultPolicy too, so the reassignment check does not answer first
        configRepository.getByKey.mockImplementation(async () => {
          throw notFoundError
        })

        await expect(
          service.setInstanceConfigSettings({
            reassignmentPayoutPolicies: { CUSTOM_POLICY: 80 },
            reassignmentPayoutDefaultPolicy: 'CUSTOM_POLICY',
          })
        ).rejects.toThrow(BadRequestException)

        try {
          await service.setInstanceConfigSettings({
            reassignmentPayoutPolicies: { CUSTOM_POLICY: 80 },
            reassignmentPayoutDefaultPolicy: 'CUSTOM_POLICY',
          })
        } catch (err: any) {
          expect(err.message).toContain(
            "this instance has no stored cancellationPayoutPolicy, so the built-in fallback 'FULL_COMPENSATION' applies"
          )
          expect(err.message).toContain('Send cancellationPayoutPolicy together with reassignmentPayoutPolicies')
        }
      })

      it('succeeds when same request sets both new menu and new cancellationPayoutPolicy', async () => {
        configRepository.getByKey.mockImplementation(async () => {
          throw notFoundError
        })

        await service.setInstanceConfigSettings({
          reassignmentPayoutPolicies: { CUSTOM_A: 100, CUSTOM_B: 70 },
          reassignmentPayoutDefaultPolicy: 'CUSTOM_A',
          cancellationPayoutPolicy: 'CUSTOM_B',
        })

        expect(configRepository.saveByKey).toHaveBeenCalledWith(
          ConfigKey.REASSIGNMENT_PAYOUT_POLICIES,
          JSON.stringify({ CUSTOM_A: 100, CUSTOM_B: 70 })
        )
        expect(configRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.CANCELLATION_PAYOUT_POLICY, 'CUSTOM_B')
      })
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
          // A minimum of 0 puts min - 1 at -1, which the negative check refuses as cannot be negative.
          const expected =
            rule.min! - 1 === 0 && rule.whyZeroIsRefused !== null
              ? `${rule.key} cannot be 0`
              : rule.min === 0
                ? `${rule.key} cannot be negative`
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

    describe('getRestaurantHistoryDays (Spec 0017 AC-1, review fix)', () => {
      // Pin: missing Config row returns 30 and logs NO warning (both NotFoundError and Prisma P2025)
      it('returns default 30 and logs no warning when config row is missing with NotFoundError', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockRejectedValueOnce(notFoundError)

        const result = await service.getRestaurantHistoryDays()

        expect(result).toBe(30)
        expect(warnSpy).not.toHaveBeenCalled()
        warnSpy.mockRestore()
      })

      it('returns default 30 and logs no warning when config row is missing with PrismaClientKnownRequestError P2025', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        const p2025Error = new PrismaClientKnownRequestError('Record not found in config table', {
          code: PRISMA_RECORD_NOT_FOUND_ERROR,
          clientVersion: '5.3.1',
        })
        configRepository.getByKey.mockRejectedValueOnce(p2025Error)

        const result = await service.getRestaurantHistoryDays()

        expect(result).toBe(30)
        expect(warnSpy).not.toHaveBeenCalled()
        warnSpy.mockRestore()
      })

      // Pin: stored valid value (e.g. 7) is returned with no warning
      it('returns stored valid value (e.g. 7) with no warning', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.RESTAURANT_HISTORY_DAYS, value: '7', type: 'number' })
        )

        const result = await service.getRestaurantHistoryDays()

        expect(result).toBe(7)
        expect(warnSpy).not.toHaveBeenCalled()
        warnSpy.mockRestore()
      })

      it('returns stored boundary values (1 and 365) with no warning', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()

        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.RESTAURANT_HISTORY_DAYS, value: '1', type: 'number' })
        )
        expect(await service.getRestaurantHistoryDays()).toBe(1)
        expect(warnSpy).not.toHaveBeenCalled()

        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.RESTAURANT_HISTORY_DAYS, value: '365', type: 'number' })
        )
        expect(await service.getRestaurantHistoryDays()).toBe(365)
        expect(warnSpy).not.toHaveBeenCalled()

        warnSpy.mockRestore()
      })

      // Pin: stored invalid value (0, 366, 2.5, a string, null) returns 30 and logs a warning naming restaurantHistoryDays
      it('returns default 30 and logs a warning naming restaurantHistoryDays when stored value is 0', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.RESTAURANT_HISTORY_DAYS, value: '0', type: 'number' })
        )

        const result = await service.getRestaurantHistoryDays()

        expect(result).toBe(30)
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(`Invalid ${ConfigKey.RESTAURANT_HISTORY_DAYS} in config`)
        )
        warnSpy.mockRestore()
      })

      it('returns default 30 and logs a warning naming restaurantHistoryDays when stored value is 366', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.RESTAURANT_HISTORY_DAYS, value: '366', type: 'number' })
        )

        const result = await service.getRestaurantHistoryDays()

        expect(result).toBe(30)
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(`Invalid ${ConfigKey.RESTAURANT_HISTORY_DAYS} in config`)
        )
        warnSpy.mockRestore()
      })

      it('returns default 30 and logs a warning naming restaurantHistoryDays when stored value is 2.5', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.RESTAURANT_HISTORY_DAYS, value: '2.5', type: 'number' })
        )

        const result = await service.getRestaurantHistoryDays()

        expect(result).toBe(30)
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(`Invalid ${ConfigKey.RESTAURANT_HISTORY_DAYS} in config`)
        )
        warnSpy.mockRestore()
      })

      it('returns default 30 and logs a warning naming restaurantHistoryDays when stored value is a string ("invalid")', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.RESTAURANT_HISTORY_DAYS, value: 'invalid', type: 'string' })
        )

        const result = await service.getRestaurantHistoryDays()

        expect(result).toBe(30)
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(`Invalid ${ConfigKey.RESTAURANT_HISTORY_DAYS} in config`)
        )
        warnSpy.mockRestore()
      })

      it('returns default 30 and logs a warning naming restaurantHistoryDays when stored value is null', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.RESTAURANT_HISTORY_DAYS, value: null as any, type: 'string' })
        )

        const result = await service.getRestaurantHistoryDays()

        expect(result).toBe(30)
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(`Invalid ${ConfigKey.RESTAURANT_HISTORY_DAYS} in config`)
        )
        warnSpy.mockRestore()
      })

      // Pin: any other error from getByKey is rethrown
      it('throws any other error from getByKey rather than swallowing it', async () => {
        const dbError = new Error('Database connection failed')
        configRepository.getByKey.mockRejectedValueOnce(dbError)

        await expect(service.getRestaurantHistoryDays()).rejects.toThrow('Database connection failed')
      })

      it('throws non-P2025 Prisma errors from getByKey rather than swallowing them', async () => {
        const otherPrismaError = new PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.3.1',
        })
        configRepository.getByKey.mockRejectedValueOnce(otherPrismaError)

        await expect(service.getRestaurantHistoryDays()).rejects.toThrow(otherPrismaError)
      })

      // Verify getInstanceConfigSettings output with missing row
      it('returns restaurantHistoryDays: 30 in getInstanceConfigSettings with no row and logs no "Missing variable \'restaurantHistoryDays\'" warning', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockImplementation(async () => {
          throw notFoundError
        })

        const settings = await service.getInstanceConfigSettings()

        expect(settings.restaurantHistoryDays).toBe(30)
        expect(warnSpy).not.toHaveBeenCalledWith(
          expect.stringContaining(`Missing variable '${ConfigKey.RESTAURANT_HISTORY_DAYS}'`)
        )
        warnSpy.mockRestore()
      })
    })

    describe('setInstanceConfigSettings - restaurantHistoryDays (Spec 0017 AC-1)', () => {
      it('refuses 0 with sentence, "", 366, 2.5, "30", -1 naming the setting', async () => {
        // 0 refused with whyZeroIsRefused sentence
        await expect(
          service.setInstanceConfigSettings({ restaurantHistoryDays: 0 } as any)
        ).rejects.toThrow('restaurantHistoryDays cannot be 0: a restaurant would not see the orders it sent today once they ended')

        // "" refused
        await expect(
          service.setInstanceConfigSettings({ restaurantHistoryDays: '' } as any)
        ).rejects.toThrow('restaurantHistoryDays')

        // 366 refused (> max 365)
        await expect(
          service.setInstanceConfigSettings({ restaurantHistoryDays: 366 } as any)
        ).rejects.toThrow('restaurantHistoryDays must be 365 or less')

        // 2.5 refused (must be whole)
        await expect(
          service.setInstanceConfigSettings({ restaurantHistoryDays: 2.5 } as any)
        ).rejects.toThrow('restaurantHistoryDays must be a whole number')

        // "30" string refused
        await expect(
          service.setInstanceConfigSettings({ restaurantHistoryDays: '30' } as any)
        ).rejects.toThrow('restaurantHistoryDays')

        // -1 refused (< 0)
        await expect(
          service.setInstanceConfigSettings({ restaurantHistoryDays: -1 } as any)
        ).rejects.toThrow('restaurantHistoryDays cannot be negative')
      })

      it('saves valid whole values 1, 30 and 365 under ConfigKey.RESTAURANT_HISTORY_DAYS', async () => {
        configRepository.getByKey.mockRejectedValue(notFoundError)

        for (const validVal of [1, 30, 365]) {
          await service.setInstanceConfigSettings({ restaurantHistoryDays: validVal })
          expect(configRepository.saveByKey).toHaveBeenCalledWith(
            ConfigKey.RESTAURANT_HISTORY_DAYS,
            validVal
          )
        }
      })

      it('includes restaurantHistoryDays in getInstanceConfigSettings output', async () => {
        configRepository.getByKey.mockImplementation(async (key: string) => {
          if (key === ConfigKey.RESTAURANT_HISTORY_DAYS) {
            return new ConfigEntity({
              key: ConfigKey.RESTAURANT_HISTORY_DAYS,
              value: '45',
              type: 'number',
            })
          }
          throw notFoundError
        })

        const settings = await service.getInstanceConfigSettings()
        expect(settings.restaurantHistoryDays).toBe(45)
      })
    })

    describe('getSosLocationRetentionDays (Spec 0022 AC-11, Decision 73.8)', () => {
      it('returns default 30 and logs no warning when config row is missing with NotFoundError', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockRejectedValueOnce(notFoundError)

        const result = await service.getSosLocationRetentionDays()

        expect(result).toBe(DEFAULT_SOS_LOCATION_RETENTION_DAYS)
        expect(warnSpy).not.toHaveBeenCalled()
        warnSpy.mockRestore()
      })

      it('returns valid stored number when within 1 to 365', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.SOS_LOCATION_RETENTION_DAYS, value: '45', type: 'number' })
        )

        const result = await service.getSosLocationRetentionDays()

        expect(result).toBe(45)
        expect(warnSpy).not.toHaveBeenCalled()
        warnSpy.mockRestore()
      })

      it('returns default 30 and logs a warning naming sosLocationRetentionDays when stored value is 0', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.SOS_LOCATION_RETENTION_DAYS, value: '0', type: 'number' })
        )

        const result = await service.getSosLocationRetentionDays()

        expect(result).toBe(DEFAULT_SOS_LOCATION_RETENTION_DAYS)
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(`Invalid ${ConfigKey.SOS_LOCATION_RETENTION_DAYS} in config`)
        )
        warnSpy.mockRestore()
      })

      it('returns default 30 and logs a warning naming sosLocationRetentionDays when stored value is 366', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.SOS_LOCATION_RETENTION_DAYS, value: '366', type: 'number' })
        )

        const result = await service.getSosLocationRetentionDays()

        expect(result).toBe(DEFAULT_SOS_LOCATION_RETENTION_DAYS)
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(`Invalid ${ConfigKey.SOS_LOCATION_RETENTION_DAYS} in config`)
        )
        warnSpy.mockRestore()
      })

      it('returns default 30 and logs a warning naming sosLocationRetentionDays when stored value is 2.5', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.SOS_LOCATION_RETENTION_DAYS, value: '2.5', type: 'number' })
        )

        const result = await service.getSosLocationRetentionDays()

        expect(result).toBe(DEFAULT_SOS_LOCATION_RETENTION_DAYS)
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(`Invalid ${ConfigKey.SOS_LOCATION_RETENTION_DAYS} in config`)
        )
        warnSpy.mockRestore()
      })

      it('returns default 30 and logs a warning naming sosLocationRetentionDays when stored value is a string ("invalid")', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.SOS_LOCATION_RETENTION_DAYS, value: 'invalid', type: 'string' })
        )

        const result = await service.getSosLocationRetentionDays()

        expect(result).toBe(DEFAULT_SOS_LOCATION_RETENTION_DAYS)
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(`Invalid ${ConfigKey.SOS_LOCATION_RETENTION_DAYS} in config`)
        )
        warnSpy.mockRestore()
      })

      it('returns default 30 and logs a warning naming sosLocationRetentionDays when stored value is null', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.SOS_LOCATION_RETENTION_DAYS, value: null as any, type: 'string' })
        )

        const result = await service.getSosLocationRetentionDays()

        expect(result).toBe(DEFAULT_SOS_LOCATION_RETENTION_DAYS)
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(`Invalid ${ConfigKey.SOS_LOCATION_RETENTION_DAYS} in config`)
        )
        warnSpy.mockRestore()
      })

      it('rethrows when repository throws an error other than NotFoundError', async () => {
        const otherPrismaError = new PrismaClientKnownRequestError('Connection timeout', {
          code: 'P1001',
          clientVersion: '5.0.0',
        })
        configRepository.getByKey.mockRejectedValueOnce(otherPrismaError)

        await expect(service.getSosLocationRetentionDays()).rejects.toThrow(otherPrismaError)
      })

      it('returns sosLocationRetentionDays: 30 in getInstanceConfigSettings with no row and logs no missing variable warning', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockImplementation(async () => {
          throw notFoundError
        })

        const settings = await service.getInstanceConfigSettings()

        expect(settings.sosLocationRetentionDays).toBe(DEFAULT_SOS_LOCATION_RETENTION_DAYS)
        expect(warnSpy).not.toHaveBeenCalledWith(
          expect.stringContaining(`Missing variable '${ConfigKey.SOS_LOCATION_RETENTION_DAYS}'`)
        )
        warnSpy.mockRestore()
      })
    })

    describe('setInstanceConfigSettings - sosLocationRetentionDays (Spec 0022 AC-11, Decision 73.8)', () => {
      it('refuses 0 with whyZeroIsRefused sentence, "", 366, 2.5, "30", -1 naming the setting', async () => {
        // 0 refused with whyZeroIsRefused sentence
        await expect(
          service.setInstanceConfigSettings({ sosLocationRetentionDays: 0 } as any)
        ).rejects.toThrow('sosLocationRetentionDays cannot be 0: the positions shared during an SOS would be deleted the day they were recorded')

        // "" refused
        await expect(
          service.setInstanceConfigSettings({ sosLocationRetentionDays: '' } as any)
        ).rejects.toThrow('sosLocationRetentionDays')

        // 366 refused (> max 365)
        await expect(
          service.setInstanceConfigSettings({ sosLocationRetentionDays: 366 } as any)
        ).rejects.toThrow('sosLocationRetentionDays must be 365 or less')

        // 2.5 refused (must be whole)
        await expect(
          service.setInstanceConfigSettings({ sosLocationRetentionDays: 2.5 } as any)
        ).rejects.toThrow('sosLocationRetentionDays must be a whole number')

        // "30" string refused
        await expect(
          service.setInstanceConfigSettings({ sosLocationRetentionDays: '30' } as any)
        ).rejects.toThrow('sosLocationRetentionDays')

        // -1 refused (< 0)
        await expect(
          service.setInstanceConfigSettings({ sosLocationRetentionDays: -1 } as any)
        ).rejects.toThrow('sosLocationRetentionDays cannot be negative')
      })

      it('saves valid whole values 1, 30 and 365 under ConfigKey.SOS_LOCATION_RETENTION_DAYS', async () => {
        configRepository.getByKey.mockRejectedValue(notFoundError)

        for (const validVal of [1, 30, 365]) {
          await service.setInstanceConfigSettings({ sosLocationRetentionDays: validVal })
          expect(configRepository.saveByKey).toHaveBeenCalledWith(
            ConfigKey.SOS_LOCATION_RETENTION_DAYS,
            validVal
          )
        }
      })

      it('includes sosLocationRetentionDays in getInstanceConfigSettings output', async () => {
        configRepository.getByKey.mockImplementation(async (key: string) => {
          if (key === ConfigKey.SOS_LOCATION_RETENTION_DAYS) {
            return new ConfigEntity({
              key: ConfigKey.SOS_LOCATION_RETENTION_DAYS,
              value: '60',
              type: 'number',
            })
          }
          throw notFoundError
        })

        const settings = await service.getInstanceConfigSettings()
        expect(settings.sosLocationRetentionDays).toBe(60)
      })
    })

    describe('getHandBackSeconds (Spec 0020 AC-2)', () => {
      it('returns default 60 and logs no warning when config row is missing with NotFoundError', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockRejectedValueOnce(notFoundError)

        const result = await service.getHandBackSeconds()

        expect(result).toBe(60)
        expect(warnSpy).not.toHaveBeenCalled()
        warnSpy.mockRestore()
      })

      it('returns default 60 and logs no warning when config row is missing with PrismaClientKnownRequestError P2025', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        const prismaP2025 = new PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: '5.3.1',
        })
        configRepository.getByKey.mockRejectedValueOnce(prismaP2025)

        const result = await service.getHandBackSeconds()

        expect(result).toBe(60)
        expect(warnSpy).not.toHaveBeenCalled()
        warnSpy.mockRestore()
      })

      it('returns stored valid value (e.g. 120) with no warning', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.HAND_BACK_SECONDS, value: '120', type: 'number' })
        )

        const result = await service.getHandBackSeconds()

        expect(result).toBe(120)
        expect(warnSpy).not.toHaveBeenCalled()
        warnSpy.mockRestore()
      })

      it('returns stored boundary values (0 and 300) with no warning', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()

        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.HAND_BACK_SECONDS, value: '0', type: 'number' })
        )
        expect(await service.getHandBackSeconds()).toBe(0)
        expect(warnSpy).not.toHaveBeenCalled()

        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.HAND_BACK_SECONDS, value: '300', type: 'number' })
        )
        expect(await service.getHandBackSeconds()).toBe(300)
        expect(warnSpy).not.toHaveBeenCalled()

        warnSpy.mockRestore()
      })

      it('returns default 60 and logs a warning naming handBackSeconds when stored value is -1', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.HAND_BACK_SECONDS, value: '-1', type: 'number' })
        )

        const result = await service.getHandBackSeconds()

        expect(result).toBe(60)
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(`Invalid ${ConfigKey.HAND_BACK_SECONDS} in config`)
        )
        warnSpy.mockRestore()
      })

      it('returns default 60 and logs a warning naming handBackSeconds when stored value is 301', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.HAND_BACK_SECONDS, value: '301', type: 'number' })
        )

        const result = await service.getHandBackSeconds()

        expect(result).toBe(60)
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(`Invalid ${ConfigKey.HAND_BACK_SECONDS} in config`)
        )
        warnSpy.mockRestore()
      })

      it('returns default 60 and logs a warning naming handBackSeconds when stored value is 2.5', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.HAND_BACK_SECONDS, value: '2.5', type: 'number' })
        )

        const result = await service.getHandBackSeconds()

        expect(result).toBe(60)
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(`Invalid ${ConfigKey.HAND_BACK_SECONDS} in config`)
        )
        warnSpy.mockRestore()
      })

      it('returns default 60 and logs a warning naming handBackSeconds when stored value is a string ("invalid")', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.HAND_BACK_SECONDS, value: 'invalid', type: 'string' })
        )

        const result = await service.getHandBackSeconds()

        expect(result).toBe(60)
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(`Invalid ${ConfigKey.HAND_BACK_SECONDS} in config`)
        )
        warnSpy.mockRestore()
      })

      it('returns default 60 and logs a warning naming handBackSeconds when stored value is null', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.HAND_BACK_SECONDS, value: null as any, type: 'string' })
        )

        const result = await service.getHandBackSeconds()

        expect(result).toBe(60)
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(`Invalid ${ConfigKey.HAND_BACK_SECONDS} in config`)
        )
        warnSpy.mockRestore()
      })

      it('throws any other error from getByKey rather than swallowing it', async () => {
        const genericError = new Error('Database connection failed')
        configRepository.getByKey.mockRejectedValueOnce(genericError)

        await expect(service.getHandBackSeconds()).rejects.toThrow(genericError)
      })

      it('throws non-P2025 Prisma errors from getByKey rather than swallowing them', async () => {
        const otherPrismaError = new PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.3.1',
        })
        configRepository.getByKey.mockRejectedValueOnce(otherPrismaError)

        await expect(service.getHandBackSeconds()).rejects.toThrow(otherPrismaError)
      })

      it('returns handBackSeconds: 60 in getInstanceConfigSettings with no row and logs no "Missing variable \'handBackSeconds\'" warning', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockImplementation(async () => {
          throw notFoundError
        })

        const settings = await service.getInstanceConfigSettings()

        expect(settings.handBackSeconds).toBe(60)
        expect(warnSpy).not.toHaveBeenCalledWith(
          expect.stringContaining(`Missing variable '${ConfigKey.HAND_BACK_SECONDS}'`)
        )
        warnSpy.mockRestore()
      })
    })

    describe('setInstanceConfigSettings - handBackSeconds (Spec 0020 AC-2)', () => {
      it('refuses -1, 301, 2.5, "60" naming the setting, and accepts 0', async () => {
        // -1 refused
        await expect(
          service.setInstanceConfigSettings({ handBackSeconds: -1 } as any)
        ).rejects.toThrow('handBackSeconds cannot be negative')

        // 301 refused (> max 300)
        await expect(
          service.setInstanceConfigSettings({ handBackSeconds: 301 } as any)
        ).rejects.toThrow('handBackSeconds must be 300 or less')

        // 2.5 refused (must be integer)
        await expect(
          service.setInstanceConfigSettings({ handBackSeconds: 2.5 } as any)
        ).rejects.toThrow('handBackSeconds must be a whole number')

        // "60" string refused
        await expect(
          service.setInstanceConfigSettings({ handBackSeconds: '60' } as any)
        ).rejects.toThrow('handBackSeconds')

        // 0 is valid (switches hand back off)
        configRepository.getByKey.mockRejectedValue(notFoundError)
        await service.setInstanceConfigSettings({ handBackSeconds: 0 })
        expect(configRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.HAND_BACK_SECONDS, 0)
      })

      it('saves valid whole values 0, 60 and 300 under ConfigKey.HAND_BACK_SECONDS', async () => {
        configRepository.getByKey.mockRejectedValue(notFoundError)

        for (const validVal of [0, 60, 300]) {
          await service.setInstanceConfigSettings({ handBackSeconds: validVal })
          expect(configRepository.saveByKey).toHaveBeenCalledWith(
            ConfigKey.HAND_BACK_SECONDS,
            validVal
          )
        }
      })

      it('includes handBackSeconds in getInstanceConfigSettings output', async () => {
        configRepository.getByKey.mockImplementation(async (key: string) => {
          if (key === ConfigKey.HAND_BACK_SECONDS) {
            return new ConfigEntity({
              key: ConfigKey.HAND_BACK_SECONDS,
              value: '120',
              type: 'number',
            })
          }
          throw notFoundError
        })

        const settings = await service.getInstanceConfigSettings()
        expect(settings.handBackSeconds).toBe(120)
      })
    })

    describe('getArrivalRadiusMetres (Spec 0021 AC-11)', () => {
      it('returns default 50 and logs no warning when config row is missing with NotFoundError', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockRejectedValueOnce(notFoundError)

        const result = await service.getArrivalRadiusMetres()

        expect(result).toBe(DEFAULT_ARRIVAL_RADIUS_METRES)
        expect(warnSpy).not.toHaveBeenCalled()
        warnSpy.mockRestore()
      })

      it('returns default 50 and logs no warning when config row is missing with PrismaClientKnownRequestError P2025', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        const prismaP2025 = new PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: '5.3.1',
        })
        configRepository.getByKey.mockRejectedValueOnce(prismaP2025)

        const result = await service.getArrivalRadiusMetres()

        expect(result).toBe(DEFAULT_ARRIVAL_RADIUS_METRES)
        expect(warnSpy).not.toHaveBeenCalled()
        warnSpy.mockRestore()
      })

      it('returns stored valid value (e.g. 100) with no warning', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.ARRIVAL_RADIUS_METRES, value: '100', type: 'number' })
        )

        const result = await service.getArrivalRadiusMetres()

        expect(result).toBe(100)
        expect(warnSpy).not.toHaveBeenCalled()
        warnSpy.mockRestore()
      })

      it('returns stored boundary values (0, 20 and 300) with no warning', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()

        for (const boundary of [0, ARRIVAL_RADIUS_METRES_MIN, ARRIVAL_RADIUS_METRES_MAX]) {
          configRepository.getByKey.mockResolvedValueOnce(
            new ConfigEntity({ key: ConfigKey.ARRIVAL_RADIUS_METRES, value: String(boundary), type: 'number' })
          )
          expect(await service.getArrivalRadiusMetres()).toBe(boundary)
          expect(warnSpy).not.toHaveBeenCalled()
        }

        warnSpy.mockRestore()
      })

      it('returns default 50 and logs a warning naming arrivalRadiusMetres when stored value is negative (-1)', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.ARRIVAL_RADIUS_METRES, value: '-1', type: 'number' })
        )

        const result = await service.getArrivalRadiusMetres()

        expect(result).toBe(50)
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(`Invalid ${ConfigKey.ARRIVAL_RADIUS_METRES} in config (-1), using the default 50`)
        )
        warnSpy.mockRestore()
      })

      it('returns default 50 and logs a warning naming arrivalRadiusMetres when stored value is 1 to 19 (e.g. 10)', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.ARRIVAL_RADIUS_METRES, value: '10', type: 'number' })
        )

        const result = await service.getArrivalRadiusMetres()

        expect(result).toBe(50)
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(`Invalid ${ConfigKey.ARRIVAL_RADIUS_METRES} in config (10), using the default 50`)
        )
        warnSpy.mockRestore()
      })

      it('returns default 50 and logs a warning naming arrivalRadiusMetres when stored value is 301', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.ARRIVAL_RADIUS_METRES, value: '301', type: 'number' })
        )

        const result = await service.getArrivalRadiusMetres()

        expect(result).toBe(50)
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(`Invalid ${ConfigKey.ARRIVAL_RADIUS_METRES} in config (301), using the default 50`)
        )
        warnSpy.mockRestore()
      })

      it('returns default 50 and logs a warning naming arrivalRadiusMetres when stored value is non-integer (25.5)', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.ARRIVAL_RADIUS_METRES, value: '25.5', type: 'number' })
        )

        const result = await service.getArrivalRadiusMetres()

        expect(result).toBe(50)
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(`Invalid ${ConfigKey.ARRIVAL_RADIUS_METRES} in config (25.5), using the default 50`)
        )
        warnSpy.mockRestore()
      })

      it('returns default 50 and logs a warning naming arrivalRadiusMetres when stored value is a string ("invalid")', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.ARRIVAL_RADIUS_METRES, value: 'invalid', type: 'string' })
        )

        const result = await service.getArrivalRadiusMetres()

        expect(result).toBe(50)
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(`Invalid ${ConfigKey.ARRIVAL_RADIUS_METRES} in config (invalid), using the default 50`)
        )
        warnSpy.mockRestore()
      })

      it('returns default 50 and logs a warning naming arrivalRadiusMetres when stored value is null', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.ARRIVAL_RADIUS_METRES, value: null as any, type: 'string' })
        )

        const result = await service.getArrivalRadiusMetres()

        expect(result).toBe(50)
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(`Invalid ${ConfigKey.ARRIVAL_RADIUS_METRES} in config (null), using the default 50`)
        )
        warnSpy.mockRestore()
      })

      it('throws any other error from getByKey rather than swallowing it', async () => {
        const genericError = new Error('Database connection failed')
        configRepository.getByKey.mockRejectedValueOnce(genericError)

        await expect(service.getArrivalRadiusMetres()).rejects.toThrow(genericError)
      })

      it('throws non-P2025 Prisma errors from getByKey rather than swallowing them', async () => {
        const otherPrismaError = new PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.3.1',
        })
        configRepository.getByKey.mockRejectedValueOnce(otherPrismaError)

        await expect(service.getArrivalRadiusMetres()).rejects.toThrow(otherPrismaError)
      })

      it('returns arrivalRadiusMetres: 50 in getInstanceConfigSettings with no row and logs no warning', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        configRepository.getByKey.mockImplementation(async () => {
          throw notFoundError
        })

        const settings = await service.getInstanceConfigSettings()

        expect(settings.arrivalRadiusMetres).toBe(50)
        expect(warnSpy).not.toHaveBeenCalledWith(
          expect.stringContaining(`Missing variable '${ConfigKey.ARRIVAL_RADIUS_METRES}'`)
        )
        expect(warnSpy).not.toHaveBeenCalledWith(
          expect.stringContaining(`Invalid ${ConfigKey.ARRIVAL_RADIUS_METRES}`)
        )
        warnSpy.mockRestore()
      })
    })

    describe('setInstanceConfigSettings - arrivalRadiusMetres (Spec 0021 AC-11)', () => {
      it('refuses 1 to 19 with exactly "arrivalRadiusMetres must be 20 or more, or 0 to switch detection off"', async () => {
        for (const val of [1, 10, 19]) {
          await expect(
            service.setInstanceConfigSettings({ arrivalRadiusMetres: val } as any)
          ).rejects.toThrow('arrivalRadiusMetres must be 20 or more, or 0 to switch detection off')
        }
      })

      it('refuses 301 (> max 300) with exactly "arrivalRadiusMetres must be 300 or less"', async () => {
        await expect(
          service.setInstanceConfigSettings({ arrivalRadiusMetres: 301 } as any)
        ).rejects.toThrow('arrivalRadiusMetres must be 300 or less')
      })

      it('refuses 25.5 (non-integer) with exactly "arrivalRadiusMetres must be a whole number"', async () => {
        await expect(
          service.setInstanceConfigSettings({ arrivalRadiusMetres: 25.5 } as any)
        ).rejects.toThrow('arrivalRadiusMetres must be a whole number')
      })

      it('refuses negative (-1) with exactly "arrivalRadiusMetres cannot be negative"', async () => {
        await expect(
          service.setInstanceConfigSettings({ arrivalRadiusMetres: -1 } as any)
        ).rejects.toThrow('arrivalRadiusMetres cannot be negative')
      })

      it('refuses non-number types ("50", null, true) with "arrivalRadiusMetres must be a number"', async () => {
        for (const badVal of ['50', null, true]) {
          await expect(
            service.setInstanceConfigSettings({ arrivalRadiusMetres: badVal } as any)
          ).rejects.toThrow('arrivalRadiusMetres must be a number')
        }
      })

      it('accepts and saves 0 (switches detection off)', async () => {
        configRepository.getByKey.mockRejectedValue(notFoundError)
        await service.setInstanceConfigSettings({ arrivalRadiusMetres: 0 })
        expect(configRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.ARRIVAL_RADIUS_METRES, 0)
      })

      it('saves valid whole values 0, 20, 50 and 300 under ConfigKey.ARRIVAL_RADIUS_METRES', async () => {
        configRepository.getByKey.mockRejectedValue(notFoundError)

        for (const validVal of [0, 20, 50, 300]) {
          await service.setInstanceConfigSettings({ arrivalRadiusMetres: validVal })
          expect(configRepository.saveByKey).toHaveBeenCalledWith(
            ConfigKey.ARRIVAL_RADIUS_METRES,
            validVal
          )
        }
      })

      it('includes arrivalRadiusMetres in getInstanceConfigSettings output when row is stored', async () => {
        configRepository.getByKey.mockImplementation(async (key: string) => {
          if (key === ConfigKey.ARRIVAL_RADIUS_METRES) {
            return new ConfigEntity({
              key: ConfigKey.ARRIVAL_RADIUS_METRES,
              value: '100',
              type: 'number',
            })
          }
          throw notFoundError
        })

        const settings = await service.getInstanceConfigSettings()
        expect(settings.arrivalRadiusMetres).toBe(100)
      })

      it('ensures zeroSwitchesOff does not alter behaviour of other numeric setting rules (Spec 0021 AC-11)', async () => {
        // handBackSeconds still accepts 0 through its own min of 0 (not via zeroSwitchesOff)
        configRepository.getByKey.mockRejectedValue(notFoundError)
        await expect(service.setInstanceConfigSettings({ handBackSeconds: 0 })).resolves.not.toThrow()

        // offerExpirySeconds still refuses 10 with 'must be 20 or more' WITHOUT the 'or 0' suffix
        await expect(
          service.setInstanceConfigSettings({ offerExpirySeconds: 10 } as any)
        ).rejects.toThrow(/^offerExpirySeconds must be 20 or more$/)

        // Verify only arrivalRadiusMetres has zeroSwitchesOff defined among rules
        const rulesWithZeroSwitchesOff = NUMERIC_SETTING_RULES.filter((r) => r.zeroSwitchesOff !== undefined)
        expect(rulesWithZeroSwitchesOff).toHaveLength(1)
        expect(rulesWithZeroSwitchesOff[0]?.key).toBe('arrivalRadiusMetres')
        expect(rulesWithZeroSwitchesOff[0]?.zeroSwitchesOff).toBe('detection')
      })
    })

    describe('setInstanceConfigSettings - dispatchPhoneNumber (row 72, decisions 72.1 to 72.3)', () => {
      it('refuses invalid phone numbers and throws BadRequestException with DISPATCH_PHONE_NUMBER_REFUSAL', async () => {
        const invalidNumbers = [
          'call me',
          '123a456',
          '123+456',
          '12', // under 3 digits
          '1234567890123456', // over 15 digits
          null,
          12345,
        ]

        for (const invalid of invalidNumbers) {
          await expect(
            service.setInstanceConfigSettings({ dispatchPhoneNumber: invalid as any })
          ).rejects.toThrow(DISPATCH_PHONE_NUMBER_REFUSAL)
          expect(configRepository.saveByKey).not.toHaveBeenCalled()
        }
      })

      it('writes NOTHING to config repository when dispatchPhoneNumber is invalid (validate-first rule)', async () => {
        await expect(
          service.setInstanceConfigSettings({
            courierMatcherType: EnumCourierMatcherType.STATIC,
            quoteBaseFee: 300,
            dispatchPhoneNumber: 'invalid-number',
          })
        ).rejects.toThrow(DISPATCH_PHONE_NUMBER_REFUSAL)

        expect(configRepository.saveByKey).not.toHaveBeenCalled()
      })

      it('saves normalized phone number under ConfigKey.DISPATCH_PHONE_NUMBER', async () => {
        configRepository.getByKey.mockRejectedValue(notFoundError)

        await service.setInstanceConfigSettings({ dispatchPhoneNumber: '+30 24210 12345' })

        expect(configRepository.saveByKey).toHaveBeenCalledWith(
          ConfigKey.DISPATCH_PHONE_NUMBER,
          '+302421012345'
        )
        expect(configRepository.saveByKey).toHaveBeenCalledWith(
          ConfigKey.UPDATED_AT,
          expect.any(String)
        )
      })

      it('saves empty string "" when passed "" or whitespace "   " (truthy check would drop it)', async () => {
        configRepository.getByKey.mockRejectedValue(notFoundError)

        await service.setInstanceConfigSettings({ dispatchPhoneNumber: '' })
        expect(configRepository.saveByKey).toHaveBeenCalledWith(
          ConfigKey.DISPATCH_PHONE_NUMBER,
          ''
        )

        configRepository.saveByKey.mockClear()

        await service.setInstanceConfigSettings({ dispatchPhoneNumber: '   ' })
        expect(configRepository.saveByKey).toHaveBeenCalledWith(
          ConfigKey.DISPATCH_PHONE_NUMBER,
          ''
        )
      })

      it('leaves dispatchPhoneNumber untouched when undefined', async () => {
        configRepository.getByKey.mockRejectedValue(notFoundError)

        await service.setInstanceConfigSettings({
          courierMatcherType: EnumCourierMatcherType.STATIC,
        })

        expect(configRepository.saveByKey).not.toHaveBeenCalledWith(
          ConfigKey.DISPATCH_PHONE_NUMBER,
          expect.anything()
        )
      })

      it('throws BadRequestException with DISPATCH_PHONE_NUMBER_REFUSAL when passed null', async () => {
        await expect(
          service.setInstanceConfigSettings({ dispatchPhoneNumber: null as any })
        ).rejects.toThrow(DISPATCH_PHONE_NUMBER_REFUSAL)

        expect(configRepository.saveByKey).not.toHaveBeenCalled()
      })
    })
  })

  describe('getDispatchPhoneNumber (row 72, decisions 72.1 to 72.3, review fix)', () => {
    const notFoundError = new Error('Record not found in config table')
    notFoundError.name = 'NotFoundError'

    // Requirement 1: Missing row (Prisma record not found error) returns null quietly without logger.warn
    it('returns null and logs no warning when config row is missing with NotFoundError', async () => {
      const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
      // Simulate Prisma error with name: 'NotFoundError'
      configRepository.getByKey.mockRejectedValueOnce(notFoundError)

      const result = await service.getDispatchPhoneNumber()

      expect(result).toBeNull()
      expect(warnSpy).not.toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('returns null and logs no warning when config row is missing with PrismaClientKnownRequestError P2025', async () => {
      const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
      // Simulate Prisma error with code: 'P2025'
      const p2025Error = new PrismaClientKnownRequestError('Record not found in config table', {
        code: PRISMA_RECORD_NOT_FOUND_ERROR,
        clientVersion: '5.3.1',
      })
      configRepository.getByKey.mockRejectedValueOnce(p2025Error)

      const result = await service.getDispatchPhoneNumber()

      expect(result).toBeNull()
      expect(warnSpy).not.toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    // Requirement 2: Any other error from getByKey is thrown, not swallowed
    it('throws any other error from getByKey rather than swallowing it', async () => {
      const dbError = new Error('Database connection failed')
      configRepository.getByKey.mockRejectedValueOnce(dbError)

      await expect(service.getDispatchPhoneNumber()).rejects.toThrow('Database connection failed')
    })

    it('throws non-P2025 Prisma errors rather than swallowing them', async () => {
      const otherPrismaError = new PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.3.1',
      })
      configRepository.getByKey.mockRejectedValueOnce(otherPrismaError)

      await expect(service.getDispatchPhoneNumber()).rejects.toThrow(otherPrismaError)
    })

    // Requirement 3: Earlier behaviour still holds
    it('returns null without a warning when stored value is empty string "" or null', async () => {
      const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()

      // Empty string represents a cleared dispatch line; must return null with no warning
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.DISPATCH_PHONE_NUMBER, value: '', type: 'string' })
      )
      expect(await service.getDispatchPhoneNumber()).toBeNull()
      expect(warnSpy).not.toHaveBeenCalled()

      // Stored null also returns null with no warning
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.DISPATCH_PHONE_NUMBER, value: null as any, type: 'string' })
      )
      expect(await service.getDispatchPhoneNumber()).toBeNull()
      expect(warnSpy).not.toHaveBeenCalled()

      warnSpy.mockRestore()
    })

    it('returns stored value itself without a warning when valid and normalized', async () => {
      const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()

      // Valid E.164 phone number with leading +
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.DISPATCH_PHONE_NUMBER, value: '+302421012345', type: 'string' })
      )
      expect(await service.getDispatchPhoneNumber()).toBe('+302421012345')
      expect(warnSpy).not.toHaveBeenCalled()

      // Valid national phone number without leading +
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.DISPATCH_PHONE_NUMBER, value: '2421012345', type: 'string' })
      )
      expect(await service.getDispatchPhoneNumber()).toBe('2421012345')
      expect(warnSpy).not.toHaveBeenCalled()

      warnSpy.mockRestore()
    })

    it('returns null and logs a warning for hand-edited bad value ("call me", number type, unnormalized)', async () => {
      const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()

      // 1. Hand-edited string with letters ("call me")
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.DISPATCH_PHONE_NUMBER, value: 'call me', type: 'string' })
      )
      expect(await service.getDispatchPhoneNumber()).toBeNull()
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Invalid ${ConfigKey.DISPATCH_PHONE_NUMBER} in config`)
      )

      warnSpy.mockClear()

      // 2. Hand-edited number type
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.DISPATCH_PHONE_NUMBER, value: 302421012345 as any, type: 'number' })
      )
      expect(await service.getDispatchPhoneNumber()).toBeNull()
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Invalid ${ConfigKey.DISPATCH_PHONE_NUMBER} in config`)
      )

      warnSpy.mockClear()

      // 3. Hand-edited unnormalized string with spaces
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.DISPATCH_PHONE_NUMBER, value: '+30 24210 12345', type: 'string' })
      )
      expect(await service.getDispatchPhoneNumber()).toBeNull()
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Invalid ${ConfigKey.DISPATCH_PHONE_NUMBER} in config`)
      )

      warnSpy.mockRestore()
    })

    it('includes dispatchPhoneNumber in getInstanceConfigSettings output when present', async () => {
      configRepository.getByKey.mockImplementation(async (key: string) => {
        if (key === ConfigKey.DISPATCH_PHONE_NUMBER) {
          return new ConfigEntity({
            key: ConfigKey.DISPATCH_PHONE_NUMBER,
            value: '+302421012345',
            type: 'string',
          })
        }
        throw notFoundError
      })

      const settings = await service.getInstanceConfigSettings()
      expect(settings.dispatchPhoneNumber).toBe('+302421012345')
    })

    // Requirement 4: getInstanceConfigSettings returns null and logs no missing variable warning for dispatchPhoneNumber
    it('returns dispatchPhoneNumber: null in getInstanceConfigSettings with no dispatchPhoneNumber row and logs no "Missing variable \'dispatchPhoneNumber\'" warning', async () => {
      const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()

      // All keys reject with notFoundError, simulating missing configuration rows
      configRepository.getByKey.mockImplementation(async () => {
        throw notFoundError
      })

      const settings = await service.getInstanceConfigSettings()

      expect(settings.dispatchPhoneNumber).toBeNull()
      // Other keys may log warnings, but dispatchPhoneNumber must NOT log "Missing variable 'dispatchPhoneNumber'"
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining(`Missing variable '${ConfigKey.DISPATCH_PHONE_NUMBER}'`)
      )

      warnSpy.mockRestore()
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

  describe('shift settings (spec 0026, AC-5, decision 77.3)', () => {
    const notFoundError = new Error('Record not found in config table')
    notFoundError.name = 'NotFoundError'

    beforeEach(() => {
      configRepository.getByKey.mockRejectedValue(notFoundError)
    })

    describe('setInstanceConfigSettings - shiftsEnabled', () => {
      it('saves false (Shifts off), not dropped by a truthy check', async () => {
        await service.setInstanceConfigSettings({ shiftsEnabled: false })
        expect(configRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.SHIFTS_ENABLED, false)
      })

      it('saves true', async () => {
        await service.setInstanceConfigSettings({ shiftsEnabled: true })
        expect(configRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.SHIFTS_ENABLED, true)
      })

      it('saves nothing for it when left out', async () => {
        await service.setInstanceConfigSettings({ handBackSeconds: 60 })
        expect(configRepository.saveByKey).not.toHaveBeenCalledWith(ConfigKey.SHIFTS_ENABLED, expect.anything())
      })

      it.each(['false', 'true', 0, 1, null])('refuses %p sent past the pipe, saving nothing', async (value) => {
        const promise = service.setInstanceConfigSettings({ shiftsEnabled: value as any })
        await expect(promise).rejects.toBeInstanceOf(BadRequestException)
        await expect(promise).rejects.toThrow('shiftsEnabled must be true or false')
        expect(configRepository.saveByKey).not.toHaveBeenCalled()
      })
    })

    describe('setInstanceConfigSettings - shiftDropNoticeHours', () => {
      it.each([0, 1, 12, 168])('saves %p hours', async (value) => {
        await service.setInstanceConfigSettings({ shiftDropNoticeHours: value })
        expect(configRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.SHIFT_DROP_NOTICE_HOURS, value)
      })

      it.each([
        [169, 'shiftDropNoticeHours must be 168 or less'],
        [-1, 'shiftDropNoticeHours cannot be negative'],
        [1.5, 'shiftDropNoticeHours must be a whole number'],
        ['12', 'shiftDropNoticeHours must be a number'],
        [null, 'shiftDropNoticeHours must be a number'],
      ])('refuses %p with "%s", saving nothing', async (value, sentence) => {
        const promise = service.setInstanceConfigSettings({ shiftDropNoticeHours: value as any })
        await expect(promise).rejects.toBeInstanceOf(BadRequestException)
        await expect(promise).rejects.toThrow(sentence)
        expect(configRepository.saveByKey).not.toHaveBeenCalled()
      })

      it('a refused notice also stops a valid shiftsEnabled in the same save (validate first)', async () => {
        await expect(
          service.setInstanceConfigSettings({ shiftsEnabled: true, shiftDropNoticeHours: 169 })
        ).rejects.toThrow(BadRequestException)
        expect(configRepository.saveByKey).not.toHaveBeenCalled()
      })

      it('saves both together, false and 0 included', async () => {
        await service.setInstanceConfigSettings({ shiftsEnabled: false, shiftDropNoticeHours: 0 })
        expect(configRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.SHIFTS_ENABLED, false)
        expect(configRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.SHIFT_DROP_NOTICE_HOURS, 0)
      })
    })

    describe('getters', () => {
      it('getShiftsEnabled: false with no row, true only for a stored boolean true', async () => {
        expect(await service.getShiftsEnabled()).toBe(false)

        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.SHIFTS_ENABLED, value: 'true', type: 'boolean' })
        )
        expect(await service.getShiftsEnabled()).toBe(true)

        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.SHIFTS_ENABLED, value: 'false', type: 'boolean' })
        )
        expect(await service.getShiftsEnabled()).toBe(false)

        configRepository.getByKey.mockResolvedValueOnce(
          new ConfigEntity({ key: ConfigKey.SHIFTS_ENABLED, value: 'yes', type: 'string' })
        )
        expect(await service.getShiftsEnabled()).toBe(false)
      })

      it('getShiftDropNoticeHours: 12 with no row, the stored value when valid, 12 when out of range', async () => {
        expect(await service.getShiftDropNoticeHours()).toBe(12)

        for (const valid of [0, 24, 168]) {
          configRepository.getByKey.mockResolvedValueOnce(
            new ConfigEntity({ key: ConfigKey.SHIFT_DROP_NOTICE_HOURS, value: String(valid), type: 'number' })
          )
          expect(await service.getShiftDropNoticeHours()).toBe(valid)
        }

        const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()
        for (const bad of ['169', '-1', '1.5']) {
          configRepository.getByKey.mockResolvedValueOnce(
            new ConfigEntity({ key: ConfigKey.SHIFT_DROP_NOTICE_HOURS, value: bad, type: 'number' })
          )
          expect(await service.getShiftDropNoticeHours()).toBe(12)
        }
        warnSpy.mockRestore()
      })

      it('getInstanceConfigSettings carries the defaults false and 12 with no rows', async () => {
        const settings = await service.getInstanceConfigSettings()
        expect(settings.shiftsEnabled).toBe(false)
        expect(settings.shiftDropNoticeHours).toBe(12)
        expect(settings.waitPayFreeMinutes).toBe(10)
      })

      it('getWaitPayFreeMinutes defaults to 10 with no config row (spec 0033 decision 23.18)', async () => {
        configRepository.getByKey.mockRejectedValue(notFoundError)
        expect(await service.getWaitPayFreeMinutes()).toBe(10)
      })

      it('getInstanceConfigSettings carries stored values', async () => {
        configRepository.getByKey.mockImplementation((key: string) => {
          if (key === ConfigKey.SHIFTS_ENABLED) {
            return Promise.resolve(new ConfigEntity({ key, value: 'true', type: 'boolean' }))
          }
          if (key === ConfigKey.SHIFT_DROP_NOTICE_HOURS) {
            return Promise.resolve(new ConfigEntity({ key, value: '48', type: 'number' }))
          }
          return Promise.reject(notFoundError)
        })
        const settings = await service.getInstanceConfigSettings()
        expect(settings.shiftsEnabled).toBe(true)
        expect(settings.shiftDropNoticeHours).toBe(48)
      })
    })
  })
})
