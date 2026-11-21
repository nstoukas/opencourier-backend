import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { DEFAULT_SPLIT_ANSWER_MINUTES, SPLIT_ANSWER_MINUTES_MAX, SPLIT_ANSWER_MINUTES_MIN } from 'src/constants'
import { ConfigRepository } from 'src/persistence/repositories/config.repository'
import { InstanceConfigSettingsAdminInput } from 'src/rest-api/config/admin/queries/instance-config-settings.admin.input'
import { ConfigKey } from 'src/shared-types'
import { RIDER_FACING_SETTINGS } from 'src/shared-types/rider-facing-settings'
import { ConfigEntity } from './entities/config.entity'
import { InstanceConfigDomainService, NUMERIC_SETTING_RULES } from './instance-config.domain.service'

// Spec 0047, AC-2: `splitAnswerMinutes` is a co-op setting (binding value 2: set by representatives in
// admin, never hard coded), default 10, from 1 to 60. It decides when a rider may leave an unanswered split.
describe('the splitAnswerMinutes setting (spec 0047, AC-2)', () => {
  let service: InstanceConfigDomainService
  let configRepository: any

  // What the repository throws when a setting was never saved.
  const notFound = Object.assign(new Error('Record not found in config table'), { name: 'NotFoundError' })
  const stored = (value: string, type = 'number') => async (key: string) => {
    if (key === ConfigKey.SPLIT_ANSWER_MINUTES) return new ConfigEntity({ key, value, type } as any)
    throw notFound
  }

  beforeEach(() => {
    // A save runs in one transaction that also writes the settings record (spec 0038).
    const tx = { $executeRaw: jest.fn().mockResolvedValue(1), settingChange: { create: jest.fn().mockResolvedValue({ id: 'change-1' }) } }
    configRepository = {
      getByKey: jest.fn().mockRejectedValue(notFound),
      saveByKey: jest.fn().mockResolvedValue({}),
      inTransaction: jest.fn().mockImplementation(async (callback: any) => callback(tx)),
    }
    service = new InstanceConfigDomainService(configRepository as unknown as ConfigRepository, { get: jest.fn().mockReturnValue('100') } as any)
  })

  it('the default is 10 minutes, and the range is 1 to 60', () => {
    expect(DEFAULT_SPLIT_ANSWER_MINUTES).toBe(10)
    expect(SPLIT_ANSWER_MINUTES_MIN).toBe(1)
    expect(SPLIT_ANSWER_MINUTES_MAX).toBe(60)
  })

  describe('reading it', () => {
    it('answers 10 when it was never saved', async () => {
      await expect(service.getSplitAnswerMinutes()).resolves.toBe(10)
    })

    it.each([1, 25, 60])('answers the saved value %i', async (value) => {
      configRepository.getByKey.mockImplementation(stored(String(value)))
      await expect(service.getSplitAnswerMinutes()).resolves.toBe(value)
    })

    it.each([
      ['0', 'number'],
      ['61', 'number'],
      ['-5', 'number'],
      ['2.5', 'number'],
      ['soon', 'string'],
    ])('falls back to 10 for a bad stored value %s', async (value, type) => {
      configRepository.getByKey.mockImplementation(stored(value, type))
      await expect(service.getSplitAnswerMinutes()).resolves.toBe(10)
    })
  })

  describe('saving it', () => {
    it('has a numeric rule: whole minutes, 1 to 60, and 0 refused with its reason', () => {
      const rule = NUMERIC_SETTING_RULES.find((candidate) => candidate.key === 'splitAnswerMinutes')
      expect(rule).toMatchObject({ mustBeInteger: true, min: 1, max: 60 })
      expect(rule?.whyZeroIsRefused).toEqual(expect.any(String))
    })

    it('refuses 0: a rider could leave the moment they flag a split', async () => {
      await expect(service.setInstanceConfigSettings({ splitAnswerMinutes: 0 } as any)).rejects.toThrow(BadRequestException)
      await expect(service.setInstanceConfigSettings({ splitAnswerMinutes: 0 } as any)).rejects.toThrow('splitAnswerMinutes cannot be 0')
      expect(configRepository.saveByKey).not.toHaveBeenCalled()
    })

    it.each([61, 600, -1, 2.5])('refuses %p', async (value) => {
      await expect(service.setInstanceConfigSettings({ splitAnswerMinutes: value } as any)).rejects.toThrow(BadRequestException)
      expect(configRepository.saveByKey).not.toHaveBeenCalled()
    })

    it.each([1, 10, 60])('saves %i under its own key', async (value) => {
      await service.setInstanceConfigSettings({ splitAnswerMinutes: value } as any)
      const saved = configRepository.saveByKey.mock.calls.find((call: any[]) => call[0] === ConfigKey.SPLIT_ANSWER_MINUTES)
      expect(saved).toBeDefined()
      expect(JSON.stringify(saved)).toContain(String(value))
    })
  })

  describe('the admin form body', () => {
    // The same pipe main.ts installs globally.
    const pipe = new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } })
    const check = (body: Record<string, unknown>) => pipe.transform(body, { type: 'body', metatype: InstanceConfigSettingsAdminInput })

    it('passes a JSON number through untouched', async () => {
      const result = (await check({ splitAnswerMinutes: 15 })) as InstanceConfigSettingsAdminInput
      expect(result.splitAnswerMinutes).toBe(15)
    })

    it.each(['15', true, false, []])('refuses %p: it must be sent as a number', async (value) => {
      await expect(check({ splitAnswerMinutes: value })).rejects.toThrow('splitAnswerMinutes must be sent as a number')
    })

    it('refuses empty text instead of turning it into 0', async () => {
      await expect(check({ splitAnswerMinutes: '' })).rejects.toThrow('splitAnswerMinutes cannot be empty')
    })
  })

  it('riders are told the setting in their own words (What changed, work rules)', () => {
    const facing = RIDER_FACING_SETTINGS.splitAnswerMinutes
    expect(facing).toBeDefined()
    expect(facing?.label).toEqual(expect.any(String))
    expect(facing?.format(10, {} as any)).toContain('10')
  })
})
