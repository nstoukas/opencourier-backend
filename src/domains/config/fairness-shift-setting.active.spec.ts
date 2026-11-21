import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import { DEFAULT_FAIRNESS_WEIGHT_SHIFT, FAIRNESS_WEIGHT_MAX, FAIRNESS_WEIGHT_MIN } from 'src/constants'
import { PRISMA_RECORD_NOT_FOUND_ERROR } from 'src/prisma.util'
import { InstanceConfigSettingsAdminInput } from 'src/rest-api/config/admin/queries/instance-config-settings.admin.input'
import { ConfigKey } from 'src/shared-types'
import { RIDER_FACING_SETTINGS } from 'src/shared-types/rider-facing-settings'
import { ConfigRepository } from '../../persistence/repositories/config.repository'
import { ConfigEntity } from './entities/config.entity'
import { InstanceConfigDomainService, NUMERIC_SETTING_RULES } from './instance-config.domain.service'

// Spec 0049 (row 79; AC-1, cross check 5; decision 79.2): the co-op setting `fairnessWeightShift`, 0 to
// 100, default 0. Written from the spec. It never counts toward spec 0044's "the three weights cannot
// all be 0" rule, in either direction.
describe('fairnessWeightShift, the co-op setting (spec 0049: AC-1, cross check 5)', () => {
  const ZERO_RULE =
    'fairnessWeightRoadTime, fairnessWeightEarnings and fairnessWeightWaiting cannot all be 0: the fairness matcher would have nothing to weigh'

  let service: InstanceConfigDomainService
  let configRepository: jest.Mocked<ConfigRepository>
  let mockTx: { $executeRaw: jest.Mock; settingChange: { create: jest.Mock } }

  const notFoundError = new PrismaClientKnownRequestError('Record not found', {
    code: PRISMA_RECORD_NOT_FOUND_ERROR,
    clientVersion: '5.3.1',
  })

  // The stored settings: only these keys have a row; every other read falls back to its default.
  function stored(values: Record<string, number>) {
    configRepository.getByKey.mockImplementation(async (key: string) => {
      const value = values[key]
      if (value === undefined) throw notFoundError
      return new ConfigEntity({ key, value: String(value), type: 'number' })
    })
  }

  beforeEach(() => {
    mockTx = { $executeRaw: jest.fn(), settingChange: { create: jest.fn() } }
    configRepository = {
      getByKey: jest.fn().mockRejectedValue(notFoundError),
      saveByKey: jest.fn(),
      inTransaction: jest.fn((callback) => callback(mockTx)),
    } as unknown as jest.Mocked<ConfigRepository>
    const fileConfigService = { get: jest.fn(() => '200') } as unknown as ConfigService
    service = new InstanceConfigDomainService(configRepository, fileConfigService)
  })

  describe('the value', () => {
    test('starts at 0, so nothing changes until the assembly sets it', async () => {
      expect(DEFAULT_FAIRNESS_WEIGHT_SHIFT).toBe(0)
      expect(await service.getFairnessWeightShift()).toBe(0)
    })

    test('reads the saved value', async () => {
      stored({ [ConfigKey.FAIRNESS_WEIGHT_SHIFT]: 40 })
      expect(await service.getFairnessWeightShift()).toBe(40)
    })

    test('is stored under the key fairnessWeightShift', () => {
      expect(ConfigKey.FAIRNESS_WEIGHT_SHIFT).toBe('fairnessWeightShift')
    })

    test('is part of the settings an admin reads', async () => {
      stored({ [ConfigKey.FAIRNESS_WEIGHT_SHIFT]: 40 })
      const settings = await service.getInstanceConfigSettings()
      expect(settings.fairnessWeightShift).toBe(40)
    })
  })

  describe('NUMERIC_SETTING_RULES', () => {
    const rule = NUMERIC_SETTING_RULES.find((r) => r.key === 'fairnessWeightShift')

    test('has a rule: a whole number from 0 to 100, with 0 allowed', () => {
      expect(rule).toBeDefined()
      expect(rule!.min).toBe(0)
      expect(rule!.max).toBe(100)
      expect(rule!.min).toBe(FAIRNESS_WEIGHT_MIN)
      expect(rule!.max).toBe(FAIRNESS_WEIGHT_MAX)
      expect(rule!.mustBeInteger).toBe(true)
      expect(rule!.whyZeroIsRefused).toBeNull()
    })

    test('has exactly one rule', () => {
      expect(NUMERIC_SETTING_RULES.filter((r) => r.key === 'fairnessWeightShift')).toHaveLength(1)
    })
  })

  describe('saving', () => {
    test.each([0, 1, 40, 100])('accepts %p and saves it under its key', async (value) => {
      stored({ [ConfigKey.FAIRNESS_WEIGHT_SHIFT]: 7 })
      await service.setInstanceConfigSettings({ fairnessWeightShift: value }, 'admin-1')
      expect(configRepository.saveByKey).toHaveBeenCalledWith(
        ConfigKey.FAIRNESS_WEIGHT_SHIFT,
        expect.anything(),
        mockTx
      )
      const call = configRepository.saveByKey.mock.calls.find(([key]) => key === ConfigKey.FAIRNESS_WEIGHT_SHIFT)!
      expect(JSON.stringify(call[1])).toContain(String(value))
    })

    test.each([-1, 101, 1000, 2.5])('refuses %p, naming the setting, and saves nothing', async (value) => {
      const save = service.setInstanceConfigSettings({ fairnessWeightShift: value }, 'admin-1')
      await expect(save).rejects.toBeInstanceOf(BadRequestException)
      await expect(save).rejects.toThrow(/fairnessWeightShift/)
      expect(configRepository.saveByKey).not.toHaveBeenCalled()
    })

    // Binding value 1 and 2: who changed a weight, from what, to what.
    test('a changed value leaves a SettingChange with the old and new value and the admin', async () => {
      stored({ [ConfigKey.FAIRNESS_WEIGHT_SHIFT]: 0 })
      await service.setInstanceConfigSettings({ fairnessWeightShift: 60 }, 'admin-1')
      expect(mockTx.settingChange.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          key: ConfigKey.FAIRNESS_WEIGHT_SHIFT,
          oldValue: 0,
          newValue: 60,
          changedByUserId: 'admin-1',
        }),
      })
    })

    test('a save that leaves it out does not write it', async () => {
      await service.setInstanceConfigSettings({ maxAssignmentDistance: 25 }, 'admin-1')
      expect(configRepository.saveByKey).not.toHaveBeenCalledWith(
        ConfigKey.FAIRNESS_WEIGHT_SHIFT,
        expect.anything(),
        expect.anything()
      )
    })
  })

  // Cross check 5: "it never counts toward the 'not every weight 0' rule (spec 0044, cross check 12)".
  describe('the "three weights cannot all be 0" rule ignores it', () => {
    test('a shift weight above 0 does not rescue three core weights sent as 0', async () => {
      const payload = {
        fairnessWeightRoadTime: 0,
        fairnessWeightEarnings: 0,
        fairnessWeightWaiting: 0,
        fairnessWeightShift: 100,
      }
      await expect(service.setInstanceConfigSettings(payload)).rejects.toThrow(BadRequestException)
      await expect(service.setInstanceConfigSettings(payload)).rejects.toThrow(ZERO_RULE)
      expect(configRepository.saveByKey).not.toHaveBeenCalled()
    })

    test('a stored shift weight above 0 does not rescue lowering the last core weight to 0', async () => {
      stored({
        [ConfigKey.FAIRNESS_WEIGHT_ROAD_TIME]: 0,
        [ConfigKey.FAIRNESS_WEIGHT_EARNINGS]: 0,
        [ConfigKey.FAIRNESS_WEIGHT_WAITING]: 20,
        [ConfigKey.FAIRNESS_WEIGHT_SHIFT]: 100,
      })
      await expect(service.setInstanceConfigSettings({ fairnessWeightWaiting: 0 })).rejects.toThrow(ZERO_RULE)
    })

    test('the shift weight can be saved as 0 while a core weight is above 0', async () => {
      stored({
        [ConfigKey.FAIRNESS_WEIGHT_ROAD_TIME]: 50,
        [ConfigKey.FAIRNESS_WEIGHT_EARNINGS]: 30,
        [ConfigKey.FAIRNESS_WEIGHT_WAITING]: 20,
        [ConfigKey.FAIRNESS_WEIGHT_SHIFT]: 40,
      })
      await expect(service.setInstanceConfigSettings({ fairnessWeightShift: 0 })).resolves.toBeDefined()
    })

    test('sending only the shift weight does not run the rule (it is checked only when a core weight is sent)', async () => {
      stored({
        [ConfigKey.FAIRNESS_WEIGHT_ROAD_TIME]: 0,
        [ConfigKey.FAIRNESS_WEIGHT_EARNINGS]: 0,
        [ConfigKey.FAIRNESS_WEIGHT_WAITING]: 0,
      })
      await expect(service.setInstanceConfigSettings({ fairnessWeightShift: 0 })).resolves.toBeDefined()
      await expect(service.setInstanceConfigSettings({ fairnessWeightShift: 50 })).resolves.toBeDefined()
    })

    test('the refusal names the three core weights and not the shift weight', async () => {
      const save = service.setInstanceConfigSettings({
        fairnessWeightRoadTime: 0,
        fairnessWeightEarnings: 0,
        fairnessWeightWaiting: 0,
        fairnessWeightShift: 0,
      })
      await expect(save).rejects.toThrow(ZERO_RULE)
      await expect(save).rejects.not.toThrow(/fairnessWeightShift/)
    })
  })

  // The backend gotcha: the global pipe turns '' into a real 0 before any check, so every number setting
  // needs @RefuseIfNotSentAsNumber().
  describe('the admin input refuses a value not sent as a number', () => {
    // The global pipe, with the options of src/main.ts.
    const pipe = new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } })
    const send = (value: unknown) =>
      pipe.transform({ fairnessWeightShift: value }, { type: 'body', metatype: InstanceConfigSettingsAdminInput })

    test.each([[''], ['   '], ['5'], [true], [false], [[]], ['abc']])('refuses %p', async (value) => {
      await expect(send(value)).rejects.toBeInstanceOf(BadRequestException)
    })

    test('an empty value is refused by name, never saved as a real 0', async () => {
      await expect(send('')).rejects.toThrow('fairnessWeightShift cannot be empty')
    })

    test.each([0, 40, 100])('lets the number %p through unchanged', async (value) => {
      const input = await send(value)
      expect(input.fairnessWeightShift).toBe(value)
    })

    test('it is optional: a save without it passes', async () => {
      const input = await pipe.transform({}, { type: 'body', metatype: InstanceConfigSettingsAdminInput })
      expect(input.fairnessWeightShift).toBeUndefined()
    })
  })

  // Spec 0038: a rider facing setting needs a label, or the rider's What changed list drops the line.
  describe('the rider facing label', () => {
    const context = { distanceUnit: 'KILOMETERS', currency: 'EUR' }

    test('has a label that says what it weighs and that it applies only while shifts are on', () => {
      const entry = RIDER_FACING_SETTINGS.fairnessWeightShift
      expect(entry).toBeDefined()
      expect(entry!.label).toBe(
        'Weight of being on a booked shift, when choosing who gets an offer (only while shifts are on)'
      )
    })

    test('formats the value as the other weights do', () => {
      expect(RIDER_FACING_SETTINGS.fairnessWeightShift!.format(40, context)).toBe('40 of 100')
      expect(RIDER_FACING_SETTINGS.fairnessWeightShift!.format(0, context)).toBe('0 of 100')
    })
  })
})
