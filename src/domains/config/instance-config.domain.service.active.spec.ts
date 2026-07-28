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
})
