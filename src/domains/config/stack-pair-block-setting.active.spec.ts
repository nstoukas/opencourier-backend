import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaClient } from '@prisma/types'
import {
  DEFAULT_STACK_PAIR_BLOCK_MINUTES,
  STACK_PAIR_BLOCK_MINUTES_MAX,
  STACK_PAIR_BLOCK_MINUTES_MIN,
} from 'src/constants'
import { ConfigRepository } from 'src/persistence/repositories/config.repository'
import { InstanceConfigSettingsAdminInput } from 'src/rest-api/config/admin/queries/instance-config-settings.admin.input'
import { InstanceConfigSettingsInput } from 'src/rest-api/config/admin/queries/instance-config-settings.input'
import { InstanceConfigSettingsDto } from 'src/rest-api/config/admin/dtos/instance-config-settings.dto'
import { ConfigKey } from 'src/shared-types'
import { RIDER_FACING_SETTINGS } from 'src/shared-types/rider-facing-settings'
import { RIDER_FACING_SETTINGS_EL } from 'src/shared-types/rider-facing-settings.el'
import { ConfigEntity } from './entities/config.entity'
import { InstanceConfigDomainService, NUMERIC_SETTING_RULES } from './instance-config.domain.service'
import { seedInitialInstanceConfig } from 'src/db-seeds/instance-config'

// Scope row 147: How long a declined pair stays apart is a co-op setting.
// Clauses 2, 3, 4, 5: NUMERIC_SETTING_RULES, validation, getter fallback & warnings,
// SettingChange persistence, DTO/input mappings, rider-facing formatters (EN/EL), and DB seed.
describe('the stackPairBlockMinutes setting (row 147, Clauses 2, 3, 4, 5)', () => {
  let service: InstanceConfigDomainService
  let configRepository: any
  let mockTx: { $executeRaw: jest.Mock; settingChange: { create: jest.Mock } }

  const notFound = Object.assign(new Error('Record not found in config table'), { name: 'NotFoundError' })
  const stored =
    (value: string | number, type = 'number') =>
    async (key: string) => {
      if (key === ConfigKey.STACK_PAIR_BLOCK_MINUTES) {
        return new ConfigEntity({ key, value: String(value), type } as any)
      }
      throw notFound
    }

  beforeEach(() => {
    mockTx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      settingChange: { create: jest.fn().mockResolvedValue({ id: 'change-1' }) },
    }
    configRepository = {
      getByKey: jest.fn().mockRejectedValue(notFound),
      saveByKey: jest.fn().mockResolvedValue({}),
      inTransaction: jest.fn().mockImplementation(async (callback: any) => callback(mockTx)),
    }
    const fileConfigService = { get: jest.fn().mockReturnValue('200') } as unknown as ConfigService
    service = new InstanceConfigDomainService(configRepository as unknown as ConfigRepository, fileConfigService)
  })

  // --------------------------------------------------------------------------
  // Clause 2: Validation and NUMERIC_SETTING_RULES
  // --------------------------------------------------------------------------
  describe('Clause 2: NUMERIC_SETTING_RULES & Validation', () => {
    it('has an entry in NUMERIC_SETTING_RULES for stackPairBlockMinutes with integer constraint and range 0-60', () => {
      const rule = NUMERIC_SETTING_RULES.find((r) => r.key === 'stackPairBlockMinutes')
      expect(rule).toBeDefined()
      expect(rule?.mustBeInteger).toBe(true)
      expect(rule?.min).toBe(STACK_PAIR_BLOCK_MINUTES_MIN)
      expect(rule?.max).toBe(STACK_PAIR_BLOCK_MINUTES_MAX)
      expect(rule?.min).toBe(0)
      expect(rule?.max).toBe(60)
      // Decision 147.1: 0 is allowed (meaning no block)
      expect(rule?.whyZeroIsRefused).toBeNull()
    })

    it('accepts 0 and saves to database (decision 147.1)', async () => {
      await service.setInstanceConfigSettings({ stackPairBlockMinutes: 0 } as any)
      expect(configRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.STACK_PAIR_BLOCK_MINUTES, 0, expect.anything())
    })

    it.each([61, 100, -1, -5])('refuses out of range value %p', async (value) => {
      await expect(service.setInstanceConfigSettings({ stackPairBlockMinutes: value } as any)).rejects.toThrow(
        BadRequestException
      )
      expect(configRepository.saveByKey).not.toHaveBeenCalled()
    })

    it('refuses 61 with sentence (stackPairBlockMinutes must be 60 or less)', async () => {
      await expect(service.setInstanceConfigSettings({ stackPairBlockMinutes: 61 } as any)).rejects.toThrow(
        BadRequestException
      )
      await expect(service.setInstanceConfigSettings({ stackPairBlockMinutes: 61 } as any)).rejects.toThrow(
        'stackPairBlockMinutes must be 60 or less'
      )
      expect(configRepository.saveByKey).not.toHaveBeenCalled()
    })

    it('refuses -1 with sentence (stackPairBlockMinutes cannot be negative)', async () => {
      await expect(service.setInstanceConfigSettings({ stackPairBlockMinutes: -1 } as any)).rejects.toThrow(
        BadRequestException
      )
      await expect(service.setInstanceConfigSettings({ stackPairBlockMinutes: -1 } as any)).rejects.toThrow(
        'stackPairBlockMinutes cannot be negative'
      )
      expect(configRepository.saveByKey).not.toHaveBeenCalled()
    })

    it('refuses null with BadRequestException and never saves', async () => {
      await expect(service.setInstanceConfigSettings({ stackPairBlockMinutes: null } as any)).rejects.toThrow(
        BadRequestException
      )
      await expect(service.setInstanceConfigSettings({ stackPairBlockMinutes: null } as any)).rejects.toThrow(
        'stackPairBlockMinutes must be a number'
      )
      expect(configRepository.saveByKey).not.toHaveBeenCalled()
    })

    it.each([0.5, 1.5, 2.5, 20.3])('refuses non-integer fractional value %p', async (value) => {
      await expect(service.setInstanceConfigSettings({ stackPairBlockMinutes: value } as any)).rejects.toThrow(
        BadRequestException
      )
      await expect(service.setInstanceConfigSettings({ stackPairBlockMinutes: value } as any)).rejects.toThrow(
        'stackPairBlockMinutes must be a whole number'
      )
      expect(configRepository.saveByKey).not.toHaveBeenCalled()
    })

    it.each([0, 1, 20, 60])('accepts valid boundary value %i and saves to database', async (value) => {
      await service.setInstanceConfigSettings({ stackPairBlockMinutes: value } as any)
      expect(configRepository.saveByKey).toHaveBeenCalledWith(
        ConfigKey.STACK_PAIR_BLOCK_MINUTES,
        value,
        expect.anything()
      )
    })

    describe('admin form input validation pipe (empty string and types)', () => {
      const pipe = new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } })
      const check = (body: Record<string, unknown>) =>
        pipe.transform(body, { type: 'body', metatype: InstanceConfigSettingsAdminInput })

      it('accepts a valid JSON number including 0', async () => {
        const result20 = (await check({ stackPairBlockMinutes: 20 })) as InstanceConfigSettingsAdminInput
        expect(result20.stackPairBlockMinutes).toBe(20)

        const result0 = (await check({ stackPairBlockMinutes: 0 })) as InstanceConfigSettingsAdminInput
        expect(result0.stackPairBlockMinutes).toBe(0)
      })

      it('refuses an empty value ("") instead of converting it to 0', async () => {
        await expect(check({ stackPairBlockMinutes: '' })).rejects.toThrow('stackPairBlockMinutes cannot be empty')
      })

      it.each(['20', true, false, []])('refuses non-number %p with RefuseIfNotSentAsNumber message', async (value) => {
        await expect(check({ stackPairBlockMinutes: value })).rejects.toThrow(
          'stackPairBlockMinutes must be sent as a number'
        )
      })
    })
  })

  // --------------------------------------------------------------------------
  // Clause 3: getStackPairBlockMinutes() fallback and warnings
  // --------------------------------------------------------------------------
  describe('Clause 3: getStackPairBlockMinutes()', () => {
    it('reads quietly as default 20 with NO warning when row is missing in config table', async () => {
      configRepository.getByKey.mockRejectedValue(notFound)
      const warnSpy = jest.spyOn((service as any).logger, 'warn')

      const result = await service.getStackPairBlockMinutes()

      expect(result).toBe(DEFAULT_STACK_PAIR_BLOCK_MINUTES)
      expect(result).toBe(20)
      expect(warnSpy).not.toHaveBeenCalled()
    })

    it.each([
      [61, '61'],
      [100, '100'],
      [-1, '-1'],
      [2.5, '2.5'],
      ['abc', 'abc'],
    ])('warns and returns default 20 for invalid stored value %p', async (rawVal, displayVal) => {
      configRepository.getByKey.mockImplementation(stored(rawVal, typeof rawVal === 'number' ? 'number' : 'string'))
      const warnSpy = jest.spyOn((service as any).logger, 'warn')

      const result = await service.getStackPairBlockMinutes()

      expect(result).toBe(20)
      expect(warnSpy).toHaveBeenCalledWith(
        `Invalid ${ConfigKey.STACK_PAIR_BLOCK_MINUTES} in config (${displayVal}), using the default ${DEFAULT_STACK_PAIR_BLOCK_MINUTES}`
      )
    })

    it.each([0, 1, 20, 60])('returns valid stored value %i without warning', async (value) => {
      configRepository.getByKey.mockImplementation(stored(value, 'number'))
      const warnSpy = jest.spyOn((service as any).logger, 'warn')

      const result = await service.getStackPairBlockMinutes()

      expect(result).toBe(value)
      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('rethrows unexpected database errors from repository', async () => {
      const dbError = new Error('Database connection failed')
      configRepository.getByKey.mockRejectedValue(dbError)

      await expect(service.getStackPairBlockMinutes()).rejects.toThrow('Database connection failed')
    })
  })

  // --------------------------------------------------------------------------
  // Clause 4: SettingChange audit trail, DTO, input and seed
  // --------------------------------------------------------------------------
  describe('Clause 4: SettingChange audit trail, DTO, input and seed', () => {
    it('writes a SettingChange row (oldValue, newValue, changedByUserId) when stackPairBlockMinutes value moves', async () => {
      // Prior value in effect is 20 (the default when unconfigured)
      configRepository.getByKey.mockRejectedValue(notFound)

      await service.setInstanceConfigSettings({ stackPairBlockMinutes: 5 }, 'admin-user-1')

      expect(mockTx.settingChange.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          key: ConfigKey.STACK_PAIR_BLOCK_MINUTES,
          oldValue: 20,
          newValue: 5,
          changedByUserId: 'admin-user-1',
        }),
      })
    })

    it('writes a SettingChange row when stackPairBlockMinutes is set to 0', async () => {
      configRepository.getByKey.mockRejectedValue(notFound)

      await service.setInstanceConfigSettings({ stackPairBlockMinutes: 0 }, 'admin-user-1')

      expect(mockTx.settingChange.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          key: ConfigKey.STACK_PAIR_BLOCK_MINUTES,
          oldValue: 20,
          newValue: 0,
          changedByUserId: 'admin-user-1',
        }),
      })
    })

    it('writes NO SettingChange row when stackPairBlockMinutes is resent with the same value', async () => {
      // Value in effect is already 20
      configRepository.getByKey.mockImplementation(stored(20, 'number'))

      await service.setInstanceConfigSettings({ stackPairBlockMinutes: 20 }, 'admin-user-1')

      const calls = mockTx.settingChange.create.mock.calls.filter(
        ([arg]: any) => arg?.data?.key === ConfigKey.STACK_PAIR_BLOCK_MINUTES
      )
      expect(calls).toHaveLength(0)
    })

    it('getInstanceConfigSettings includes stackPairBlockMinutes', async () => {
      configRepository.getByKey.mockImplementation(stored(15, 'number'))

      const settings = await service.getInstanceConfigSettings()

      expect(settings.stackPairBlockMinutes).toBe(15)
    })

    it('admin DTO carries stackPairBlockMinutes through', () => {
      const dto = new InstanceConfigSettingsDto({
        stackPairBlockMinutes: 30,
      } as any)
      expect(dto.stackPairBlockMinutes).toBe(30)
    })

    it('InstanceConfigSettingsInput accepts stackPairBlockMinutes', () => {
      const input = new InstanceConfigSettingsInput()
      input.stackPairBlockMinutes = 45
      expect(input.stackPairBlockMinutes).toBe(45)
    })

    it('seedInitialInstanceConfig seeds stackPairBlockMinutes as 20 with number type', async () => {
      const mockFindUnique = jest.fn().mockResolvedValue(null)
      const mockCreate = jest.fn().mockResolvedValue({})
      const prismaStub = {
        config: { findUnique: mockFindUnique, create: mockCreate },
      } as unknown as PrismaClient

      await seedInitialInstanceConfig(prismaStub)

      const seedCall = mockCreate.mock.calls.find(([arg]: any) => arg?.data?.key === 'stackPairBlockMinutes')
      expect(seedCall).toBeDefined()
      expect(seedCall[0].data.value).toBe('20')
      expect(seedCall[0].data.type).toBe('number')
    })

    it('seedInitialInstanceConfig does not overwrite existing stackPairBlockMinutes row', async () => {
      const mockFindUnique = jest.fn().mockImplementation(async ({ where }: { where: { key: string } }) => {
        if (where.key === 'stackPairBlockMinutes') {
          return { key: 'stackPairBlockMinutes', value: '10', type: 'number' }
        }
        return null
      })
      const mockCreate = jest.fn().mockResolvedValue({})
      const prismaStub = {
        config: { findUnique: mockFindUnique, create: mockCreate },
      } as unknown as PrismaClient

      await seedInitialInstanceConfig(prismaStub)

      const seedCall = mockCreate.mock.calls.find(([arg]: any) => arg?.data?.key === 'stackPairBlockMinutes')
      expect(seedCall).toBeUndefined()
    })
  })

  // --------------------------------------------------------------------------
  // Clause 5: Rider facing settings (EN & EL)
  // --------------------------------------------------------------------------
  describe('Clause 5: RIDER_FACING_SETTINGS (EN & EL)', () => {
    const ctx = { distanceUnit: 'KILOMETERS', currency: 'EUR' }

    it('has stackPairBlockMinutes in English RIDER_FACING_SETTINGS with label and formatter', () => {
      const entry = RIDER_FACING_SETTINGS.stackPairBlockMinutes
      expect(entry).toBeDefined()
      expect(entry!.label).toBe('Time before a declined or missed pair can be offered again')
      expect(entry!.format(0, ctx)).toBe('no wait')
      expect(entry!.format(1, ctx)).toBe('1 minute')
      expect(entry!.format(5, ctx)).toBe('5 minutes')
      expect(entry!.format(20, ctx)).toBe('20 minutes')
      expect(entry!.format(null, ctx)).toBe('not set')
      expect(entry!.format(undefined, ctx)).toBe('not set')
      expect(entry!.format('', ctx)).toBe('not set')
    })

    it('has stackPairBlockMinutes in Greek RIDER_FACING_SETTINGS_EL with label and formatter', () => {
      const entry = RIDER_FACING_SETTINGS_EL.stackPairBlockMinutes
      expect(entry).toBeDefined()
      expect(entry!.label).toBe('Χρόνος πριν ξαναπροταθεί ζευγάρι που απορρίφθηκε ή χάθηκε')
      expect(entry!.format(0, ctx)).toBe('χωρίς αναμονή')
      expect(entry!.format(1, ctx)).toBe('1 λεπτό')
      expect(entry!.format(5, ctx)).toBe('5 λεπτά')
      expect(entry!.format(20, ctx)).toBe('20 λεπτά')
      expect(entry!.format(null, ctx)).toBe('δεν έχει οριστεί')
      expect(entry!.format(undefined, ctx)).toBe('δεν έχει οριστεί')
      expect(entry!.format('', ctx)).toBe('δεν έχει οριστεί')
    })
  })
})
