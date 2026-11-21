import { BadRequestException } from '@nestjs/common'
import { InstanceConfigDomainService, NUMERIC_SETTING_RULES } from './instance-config.domain.service'
import { ConfigRepository } from '../../persistence/repositories/config.repository'
import { ConfigService } from '@nestjs/config'
import { ConfigKey } from 'src/shared-types'
import {
  DEFAULT_FAIRNESS_WEIGHT_ROAD_TIME,
  DEFAULT_FAIRNESS_WEIGHT_EARNINGS,
  DEFAULT_FAIRNESS_WEIGHT_WAITING,
  DEFAULT_FAIRNESS_CANDIDATE_LIMIT,
  DEFAULT_FAIRNESS_MIN_ONLINE_MINUTES,
  FAIRNESS_WEIGHT_MIN,
  FAIRNESS_WEIGHT_MAX,
  FAIRNESS_CANDIDATE_LIMIT_MIN,
  FAIRNESS_CANDIDATE_LIMIT_MAX,
  FAIRNESS_MIN_ONLINE_MINUTES_MIN,
  FAIRNESS_MIN_ONLINE_MINUTES_MAX,
} from 'src/constants'
import { ConfigEntity } from './entities/config.entity'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import { PRISMA_RECORD_NOT_FOUND_ERROR } from 'src/prisma.util'
import { RIDER_FACING_SETTINGS } from 'src/shared-types/rider-facing-settings'

describe('Fairness Settings (Spec 0044: AC-5)', () => {
  let service: InstanceConfigDomainService
  let configRepository: jest.Mocked<ConfigRepository>
  let fileConfigService: jest.Mocked<ConfigService>
  let mockTx: any

  const notFoundError = new PrismaClientKnownRequestError('Record not found', {
    code: PRISMA_RECORD_NOT_FOUND_ERROR,
    clientVersion: '5.3.1',
  })

  beforeEach(() => {
    mockTx = {
      $executeRaw: jest.fn(),
      settingChange: {
        create: jest.fn(),
      },
    }

    configRepository = {
      getByKey: jest.fn().mockRejectedValue(notFoundError),
      saveByKey: jest.fn(),
      inTransaction: jest.fn((callback) => callback(mockTx)),
    } as any

    fileConfigService = {
      get: jest.fn((key: string) => {
        const defaults: Record<string, any> = {
          FAIRNESS_WEIGHT_ROAD_TIME: DEFAULT_FAIRNESS_WEIGHT_ROAD_TIME,
          FAIRNESS_WEIGHT_EARNINGS: DEFAULT_FAIRNESS_WEIGHT_EARNINGS,
          FAIRNESS_WEIGHT_WAITING: DEFAULT_FAIRNESS_WEIGHT_WAITING,
          FAIRNESS_CANDIDATE_LIMIT: DEFAULT_FAIRNESS_CANDIDATE_LIMIT,
          FAIRNESS_MIN_ONLINE_MINUTES: DEFAULT_FAIRNESS_MIN_ONLINE_MINUTES,
        }
        return defaults[key] ?? '200'
      }),
    } as any

    service = new InstanceConfigDomainService(configRepository, fileConfigService)
  })

  describe('Default values', () => {
    test('the five fairness settings have defaults 50/30/20/10/30 when not stored in DB', async () => {
      expect(await service.getFairnessWeightRoadTime()).toBe(50)
      expect(await service.getFairnessWeightEarnings()).toBe(30)
      expect(await service.getFairnessWeightWaiting()).toBe(20)
      expect(await service.getFairnessCandidateLimit()).toBe(10)
      expect(await service.getFairnessMinOnlineMinutes()).toBe(30)
    })
  })

  describe('Ranges and numeric setting rules', () => {
    test('weights have range 0 to 100', () => {
      const roadRule = NUMERIC_SETTING_RULES.find((r) => r.key === 'fairnessWeightRoadTime')!
      const earningsRule = NUMERIC_SETTING_RULES.find((r) => r.key === 'fairnessWeightEarnings')!
      const waitingRule = NUMERIC_SETTING_RULES.find((r) => r.key === 'fairnessWeightWaiting')!

      expect(roadRule.min).toBe(FAIRNESS_WEIGHT_MIN)
      expect(roadRule.max).toBe(FAIRNESS_WEIGHT_MAX)
      expect(roadRule.mustBeInteger).toBe(true)

      expect(earningsRule.min).toBe(FAIRNESS_WEIGHT_MIN)
      expect(earningsRule.max).toBe(FAIRNESS_WEIGHT_MAX)
      expect(earningsRule.mustBeInteger).toBe(true)

      expect(waitingRule.min).toBe(FAIRNESS_WEIGHT_MIN)
      expect(waitingRule.max).toBe(FAIRNESS_WEIGHT_MAX)
      expect(waitingRule.mustBeInteger).toBe(true)
    })

    test('candidate limit has range 1 to 50 with 0 refused', () => {
      const limitRule = NUMERIC_SETTING_RULES.find((r) => r.key === 'fairnessCandidateLimit')!
      expect(limitRule.min).toBe(FAIRNESS_CANDIDATE_LIMIT_MIN)
      expect(limitRule.max).toBe(FAIRNESS_CANDIDATE_LIMIT_MAX)
      expect(limitRule.whyZeroIsRefused).toBe('no rider could be compared at all')
      expect(limitRule.mustBeInteger).toBe(true)
    })

    test('min online minutes has range 0 to 240', () => {
      const minutesRule = NUMERIC_SETTING_RULES.find((r) => r.key === 'fairnessMinOnlineMinutes')!
      expect(minutesRule.min).toBe(FAIRNESS_MIN_ONLINE_MINUTES_MIN)
      expect(minutesRule.max).toBe(FAIRNESS_MIN_ONLINE_MINUTES_MAX)
      expect(minutesRule.whyZeroIsRefused).toBeNull()
      expect(minutesRule.mustBeInteger).toBe(true)
    })
  })

  describe('All three weights 0 refusal on merged values', () => {
    test('refuses save when all three weights are sent as 0', async () => {
      const payload = {
        fairnessWeightRoadTime: 0,
        fairnessWeightEarnings: 0,
        fairnessWeightWaiting: 0,
      }

      await expect(service.setInstanceConfigSettings(payload)).rejects.toThrow(BadRequestException)
      await expect(service.setInstanceConfigSettings(payload)).rejects.toThrow(
        'fairnessWeightRoadTime, fairnessWeightEarnings and fairnessWeightWaiting cannot all be 0: the fairness matcher would have nothing to weigh'
      )
    })

    test('refuses save on merged values when two stored weights are 0 and payload lowers the third to 0', async () => {
      // Mock existing settings in DB: roadTime = 0, earnings = 0, waiting = 20
      configRepository.getByKey.mockImplementation(async (key: string) => {
        if (key === ConfigKey.FAIRNESS_WEIGHT_ROAD_TIME) return new ConfigEntity({ key, value: '0', type: 'number' })
        if (key === ConfigKey.FAIRNESS_WEIGHT_EARNINGS) return new ConfigEntity({ key, value: '0', type: 'number' })
        if (key === ConfigKey.FAIRNESS_WEIGHT_WAITING) return new ConfigEntity({ key, value: '20', type: 'number' })
        throw notFoundError
      })

      // Admin tries to set waiting to 0
      const payload = { fairnessWeightWaiting: 0 }

      await expect(service.setInstanceConfigSettings(payload)).rejects.toThrow(BadRequestException)
      await expect(service.setInstanceConfigSettings(payload)).rejects.toThrow(
        'fairnessWeightRoadTime, fairnessWeightEarnings and fairnessWeightWaiting cannot all be 0: the fairness matcher would have nothing to weigh'
      )
    })

    test('checked only when one of the three weights is sent', async () => {
      // Suppose stored values in DB somehow had 0, 0, 0
      configRepository.getByKey.mockImplementation(async (key: string) => {
        if (key === ConfigKey.FAIRNESS_WEIGHT_ROAD_TIME) return new ConfigEntity({ key, value: '0', type: 'number' })
        if (key === ConfigKey.FAIRNESS_WEIGHT_EARNINGS) return new ConfigEntity({ key, value: '0', type: 'number' })
        if (key === ConfigKey.FAIRNESS_WEIGHT_WAITING) return new ConfigEntity({ key, value: '0', type: 'number' })
        throw notFoundError
      })

      // Admin saves an unrelated setting (e.g. maxAssignmentDistance)
      const payload = { maxAssignmentDistance: 25 }

      // Must NOT throw the fairness weights error
      await expect(service.setInstanceConfigSettings(payload)).resolves.toBeDefined()
    })
  })

  describe('SettingChange persistence', () => {
    test('each changed fairness setting writes a SettingChange row in the transaction', async () => {
      configRepository.getByKey.mockImplementation(async (key: string) => {
        if (key === ConfigKey.FAIRNESS_WEIGHT_ROAD_TIME) return new ConfigEntity({ key, value: '50', type: 'number' })
        if (key === ConfigKey.FAIRNESS_WEIGHT_EARNINGS) return new ConfigEntity({ key, value: '30', type: 'number' })
        if (key === ConfigKey.FAIRNESS_WEIGHT_WAITING) return new ConfigEntity({ key, value: '20', type: 'number' })
        throw notFoundError
      })

      const adminId = 'admin-user-fairness'
      await service.setInstanceConfigSettings(
        {
          fairnessWeightRoadTime: 40,
          fairnessWeightEarnings: 40,
        },
        adminId
      )

      expect(mockTx.settingChange.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          key: ConfigKey.FAIRNESS_WEIGHT_ROAD_TIME,
          oldValue: 50,
          newValue: 40,
          changedByUserId: adminId,
        }),
      })

      expect(mockTx.settingChange.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          key: ConfigKey.FAIRNESS_WEIGHT_EARNINGS,
          oldValue: 30,
          newValue: 40,
          changedByUserId: adminId,
        }),
      })

      // fairnessWeightWaiting was not changed, so no SettingChange for it
      expect(mockTx.settingChange.create).not.toHaveBeenCalledWith({
        data: expect.objectContaining({
          key: ConfigKey.FAIRNESS_WEIGHT_WAITING,
        }),
      })
    })
  })

  describe('RIDER_FACING_SETTINGS', () => {
    test('contains all five fairness settings with labels and formatters', () => {
      const context = { distanceUnit: 'KILOMETERS', currency: 'EUR' }

      expect(RIDER_FACING_SETTINGS.fairnessWeightRoadTime).toBeDefined()
      expect(RIDER_FACING_SETTINGS.fairnessWeightRoadTime!.label).toContain('Weight of road time')
      expect(RIDER_FACING_SETTINGS.fairnessWeightRoadTime!.format(50, context)).toBe('50 of 100')

      expect(RIDER_FACING_SETTINGS.fairnessWeightEarnings).toBeDefined()
      expect(RIDER_FACING_SETTINGS.fairnessWeightEarnings!.label).toContain('Weight of what you have earned')
      expect(RIDER_FACING_SETTINGS.fairnessWeightEarnings!.format(30, context)).toBe('30 of 100')

      expect(RIDER_FACING_SETTINGS.fairnessWeightWaiting).toBeDefined()
      expect(RIDER_FACING_SETTINGS.fairnessWeightWaiting!.label).toContain('Weight of how long you have waited')
      expect(RIDER_FACING_SETTINGS.fairnessWeightWaiting!.format(20, context)).toBe('20 of 100')

      expect(RIDER_FACING_SETTINGS.fairnessCandidateLimit).toBeDefined()
      expect(RIDER_FACING_SETTINGS.fairnessCandidateLimit!.label).toContain('Nearest riders compared')
      expect(RIDER_FACING_SETTINGS.fairnessCandidateLimit!.format(10, context)).toBe('10 riders')

      expect(RIDER_FACING_SETTINGS.fairnessMinOnlineMinutes).toBeDefined()
      expect(RIDER_FACING_SETTINGS.fairnessMinOnlineMinutes!.label).toContain(
        'Minutes online today before your own earnings count'
      )
      expect(RIDER_FACING_SETTINGS.fairnessMinOnlineMinutes!.format(30, context)).toBe('30 minutes')
    })
  })
})
