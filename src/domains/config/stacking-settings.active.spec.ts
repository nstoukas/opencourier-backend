import { BadRequestException, ValidationPipe } from '@nestjs/common'
import {
  DEFAULT_STACKING_ENABLED,
  DEFAULT_TWO_ORDER_DELAY_LIMIT_MINUTES,
  DEFAULT_TWO_ORDER_POLICY,
  TWO_ORDER_DELAY_LIMIT_MINUTES_MAX,
  TWO_ORDER_DELAY_LIMIT_MINUTES_MIN,
} from 'src/constants'
import { ConfigRepository } from 'src/persistence/repositories/config.repository'
import { InstanceConfigSettingsAdminInput } from 'src/rest-api/config/admin/queries/instance-config-settings.admin.input'
import { ConfigKey } from 'src/shared-types'
import { RIDER_FACING_SETTINGS } from 'src/shared-types/rider-facing-settings'
import { EnumTwoOrderPolicy } from 'src/shared-types/stacking'
import { ConfigEntity } from './entities/config.entity'
import { InstanceConfigDomainService, NUMERIC_SETTING_RULES } from './instance-config.domain.service'

// Spec 0048, AC-1: Co-op settings section "Two orders at once":
// - `stackingEnabled` (default false)
// - `twoOrderPolicy` (SHORTAGE_ONLY | WHENEVER_FITS, default SHORTAGE_ONLY)
// - `twoOrderDelayLimitMinutes` (0 to 30, default 10; 0 allowed: only stacks that delay nobody)
// Binding value 2: set by representatives in admin, never hard coded.
describe('Stacking co-op settings (spec 0048, AC-1)', () => {
  let service: InstanceConfigDomainService
  let configRepository: any

  const notFound = Object.assign(new Error('Record not found in config table'), { name: 'NotFoundError' })
  const stored = (storedKey: string, value: string, type = 'string') => async (key: string) => {
    if (key === storedKey) return new ConfigEntity({ key, value, type } as any)
    throw notFound
  }

  beforeEach(() => {
    // Saves run in a single transaction that also writes the settings record (spec 0038).
    const tx = { $executeRaw: jest.fn().mockResolvedValue(1), settingChange: { create: jest.fn().mockResolvedValue({ id: 'change-1' }) } }
    configRepository = {
      getByKey: jest.fn().mockRejectedValue(notFound),
      saveByKey: jest.fn().mockResolvedValue({}),
      inTransaction: jest.fn().mockImplementation(async (callback: any) => callback(tx)),
    }
    service = new InstanceConfigDomainService(configRepository as unknown as ConfigRepository, { get: jest.fn().mockReturnValue('100') } as any)
  })

  describe('defaults and limits', () => {
    it('stackingEnabled defaults to false', () => {
      expect(DEFAULT_STACKING_ENABLED).toBe(false)
    })

    it('twoOrderPolicy defaults to SHORTAGE_ONLY', () => {
      expect(DEFAULT_TWO_ORDER_POLICY).toBe(EnumTwoOrderPolicy.SHORTAGE_ONLY)
    })

    it('twoOrderDelayLimitMinutes defaults to 10 minutes, range 0 to 30', () => {
      expect(DEFAULT_TWO_ORDER_DELAY_LIMIT_MINUTES).toBe(10)
      expect(TWO_ORDER_DELAY_LIMIT_MINUTES_MIN).toBe(0)
      expect(TWO_ORDER_DELAY_LIMIT_MINUTES_MAX).toBe(30)
    })
  })

  describe('stackingEnabled', () => {
    it('answers false when never saved (default off)', async () => {
      await expect(service.getStackingEnabled()).resolves.toBe(false)
    })

    it('answers true when saved as true', async () => {
      configRepository.getByKey.mockImplementation(stored(ConfigKey.STACKING_ENABLED, 'true', 'boolean'))
      await expect(service.getStackingEnabled()).resolves.toBe(true)
    })

    it('refuses non-boolean values on save', async () => {
      await expect(service.setInstanceConfigSettings({ stackingEnabled: 'yes' as any })).rejects.toThrow(BadRequestException)
      await expect(service.setInstanceConfigSettings({ stackingEnabled: 'yes' as any })).rejects.toThrow('stackingEnabled must be true or false')
      expect(configRepository.saveByKey).not.toHaveBeenCalled()
    })

    it('saves boolean true under ConfigKey.STACKING_ENABLED', async () => {
      await service.setInstanceConfigSettings({ stackingEnabled: true })
      const saved = configRepository.saveByKey.mock.calls.find((call: any[]) => call[0] === ConfigKey.STACKING_ENABLED)
      expect(saved).toBeDefined()
      expect(saved[1]).toBe(true)
    })
  })

  describe('twoOrderPolicy', () => {
    it('answers SHORTAGE_ONLY when never saved', async () => {
      await expect(service.getTwoOrderPolicy()).resolves.toBe(EnumTwoOrderPolicy.SHORTAGE_ONLY)
    })

    it('answers WHENEVER_FITS when saved as WHENEVER_FITS', async () => {
      configRepository.getByKey.mockImplementation(stored(ConfigKey.TWO_ORDER_POLICY, EnumTwoOrderPolicy.WHENEVER_FITS))
      await expect(service.getTwoOrderPolicy()).resolves.toBe(EnumTwoOrderPolicy.WHENEVER_FITS)
    })

    it('falls back to SHORTAGE_ONLY for an unknown stored string', async () => {
      configRepository.getByKey.mockImplementation(stored(ConfigKey.TWO_ORDER_POLICY, 'UNKNOWN_MODE'))
      await expect(service.getTwoOrderPolicy()).resolves.toBe(EnumTwoOrderPolicy.SHORTAGE_ONLY)
    })

    it('refuses invalid policy on save', async () => {
      await expect(service.setInstanceConfigSettings({ twoOrderPolicy: 'ALWAYS' as any })).rejects.toThrow(BadRequestException)
      expect(configRepository.saveByKey).not.toHaveBeenCalled()
    })

    it.each([EnumTwoOrderPolicy.SHORTAGE_ONLY, EnumTwoOrderPolicy.WHENEVER_FITS])('saves %s under ConfigKey.TWO_ORDER_POLICY', async (policy) => {
      await service.setInstanceConfigSettings({ twoOrderPolicy: policy })
      const saved = configRepository.saveByKey.mock.calls.find((call: any[]) => call[0] === ConfigKey.TWO_ORDER_POLICY)
      expect(saved).toBeDefined()
      expect(saved[1]).toBe(policy)
    })
  })

  describe('twoOrderDelayLimitMinutes', () => {
    it('answers 10 when never saved', async () => {
      await expect(service.getTwoOrderDelayLimitMinutes()).resolves.toBe(10)
    })

    it.each([0, 5, 10, 30])('answers the saved value %i', async (value) => {
      configRepository.getByKey.mockImplementation(stored(ConfigKey.TWO_ORDER_DELAY_LIMIT_MINUTES, String(value), 'number'))
      await expect(service.getTwoOrderDelayLimitMinutes()).resolves.toBe(value)
    })

    it.each([
      ['-1', 'number'],
      ['31', 'number'],
      ['not-a-number', 'string'],
    ])('falls back to 10 for out-of-range or malformed value %s', async (value, type) => {
      configRepository.getByKey.mockImplementation(stored(ConfigKey.TWO_ORDER_DELAY_LIMIT_MINUTES, value, type))
      await expect(service.getTwoOrderDelayLimitMinutes()).resolves.toBe(10)
    })

    it('allows 0 (decision 80.2: zeroSwitchesOff is false, 0 means only stacks that delay nobody)', () => {
      const rule = NUMERIC_SETTING_RULES.find((candidate) => candidate.key === 'twoOrderDelayLimitMinutes')
      expect(rule).toMatchObject({ mustBeInteger: true, min: 0, max: 30 })
      expect(rule?.zeroSwitchesOff).toBeFalsy()
    })

    it.each([-1, 31, 12.5])('refuses out of range or fractional minutes %p', async (value) => {
      await expect(service.setInstanceConfigSettings({ twoOrderDelayLimitMinutes: value } as any)).rejects.toThrow(BadRequestException)
      expect(configRepository.saveByKey).not.toHaveBeenCalled()
    })

    it.each([0, 10, 30])('saves %i under ConfigKey.TWO_ORDER_DELAY_LIMIT_MINUTES', async (value) => {
      await service.setInstanceConfigSettings({ twoOrderDelayLimitMinutes: value })
      const saved = configRepository.saveByKey.mock.calls.find((call: any[]) => call[0] === ConfigKey.TWO_ORDER_DELAY_LIMIT_MINUTES)
      expect(saved).toBeDefined()
      expect(JSON.stringify(saved)).toContain(String(value))
    })
  })

  describe('the admin form body (ValidationPipe)', () => {
    const pipe = new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } })
    const check = (body: Record<string, unknown>) => pipe.transform(body, { type: 'body', metatype: InstanceConfigSettingsAdminInput })

    it('passes valid settings through untouched', async () => {
      const result = (await check({
        stackingEnabled: true,
        twoOrderPolicy: EnumTwoOrderPolicy.WHENEVER_FITS,
        twoOrderDelayLimitMinutes: 15,
      })) as InstanceConfigSettingsAdminInput

      expect(result.stackingEnabled).toBe(true)
      expect(result.twoOrderPolicy).toBe(EnumTwoOrderPolicy.WHENEVER_FITS)
      expect(result.twoOrderDelayLimitMinutes).toBe(15)
    })

    it.each(['15', true, false, []])('refuses twoOrderDelayLimitMinutes = %p: must be sent as a number', async (value) => {
      await expect(check({ twoOrderDelayLimitMinutes: value })).rejects.toThrow('twoOrderDelayLimitMinutes must be sent as a number')
    })
  })

  describe('rider facing labels (AC-1, review of row 80, ruling 2)', () => {
    it('declares rider-facing entries for stackingEnabled, twoOrderPolicy, and twoOrderDelayLimitMinutes', () => {
      const keys = Object.keys(RIDER_FACING_SETTINGS)
      expect(keys).toContain('stackingEnabled')
      expect(keys).toContain('twoOrderPolicy')
      expect(keys).toContain('twoOrderDelayLimitMinutes')

      expect(RIDER_FACING_SETTINGS.stackingEnabled?.label).toBe('Two orders offered together')
      expect(RIDER_FACING_SETTINGS.twoOrderDelayLimitMinutes?.label).toBe('Most minutes a pair may delay a customer')

      expect(RIDER_FACING_SETTINGS.stackingEnabled?.format(true, { distanceUnit: 'KILOMETERS', currency: 'EUR' })).toBe('on')
      expect(RIDER_FACING_SETTINGS.twoOrderPolicy?.format('WHENEVER_FITS', { distanceUnit: 'KILOMETERS', currency: 'EUR' })).toBe('whenever they fit')
      expect(RIDER_FACING_SETTINGS.twoOrderPolicy?.format('SHORTAGE_ONLY', { distanceUnit: 'KILOMETERS', currency: 'EUR' })).toBe('only when no free rider is a good fit')
      expect(RIDER_FACING_SETTINGS.twoOrderDelayLimitMinutes?.format(15, { distanceUnit: 'KILOMETERS', currency: 'EUR' })).toBe('15 minutes')
    })
  })
})
