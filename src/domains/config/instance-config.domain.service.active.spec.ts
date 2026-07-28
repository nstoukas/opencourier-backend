import { BadRequestException } from '@nestjs/common'
import { InstanceConfigDomainService } from './instance-config.domain.service'
import { ConfigRepository } from '../../persistence/repositories/config.repository'
import { ConfigService } from '@nestjs/config'
import { ConfigKey, EnumCurrency, FALLBACK_REASSIGNMENT_PAYOUT_POLICIES } from 'src/shared-types'
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

      // Attempt to save a menu that drops 'HALF_COMPENSATION' without sending a new default
      await expect(
        service.setInstanceConfigSettings({
          reassignmentPayoutPolicies: { FULL_COMPENSATION: 100 },
        })
      ).rejects.toThrow(BadRequestException)

      await expect(
        service.setInstanceConfigSettings({
          reassignmentPayoutPolicies: { FULL_COMPENSATION: 100 },
        })
      ).rejects.toMatchObject({
        message: expect.stringContaining('HALF_COMPENSATION'),
      })

      await expect(
        service.setInstanceConfigSettings({
          reassignmentPayoutPolicies: { FULL_COMPENSATION: 100 },
        })
      ).rejects.toMatchObject({
        message: expect.stringContaining('FULL_COMPENSATION'),
      })

      await expect(
        service.setInstanceConfigSettings({
          reassignmentPayoutPolicies: { FULL_COMPENSATION: 100 },
        })
      ).rejects.toMatchObject({
        message: expect.stringContaining(
          'Send reassignmentPayoutDefaultPolicy together with reassignmentPayoutPolicies'
        ),
      })
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
