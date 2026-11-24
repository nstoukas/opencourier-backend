import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaClient } from '@prisma/types'
import { DEFAULT_OFFER_SKIP_MINUTES, OFFER_SKIP_MINUTES_MAX, OFFER_SKIP_MINUTES_MIN } from 'src/constants'
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

// Scope row 144: How long a skipped rider waits is a co-op setting.
// Clauses 2, 3, 5, 6: NUMERIC_SETTING_RULES, validation, getter fallback & warnings,
// SettingChange persistence, DTO/input mappings, rider-facing formatters (EN/EL), and DB seed.
describe('the offerSkipMinutes setting (row 144, Clauses 2, 3, 5, 6)', () => {
  let service: InstanceConfigDomainService
  let configRepository: any
  let mockTx: { $executeRaw: jest.Mock; settingChange: { create: jest.Mock } }

  const notFound = Object.assign(new Error('Record not found in config table'), { name: 'NotFoundError' })
  const stored =
    (value: string | number, type = 'number') =>
    async (key: string) => {
      if (key === ConfigKey.OFFER_SKIP_MINUTES) {
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
    it('has an entry in NUMERIC_SETTING_RULES for offerSkipMinutes with integer constraint and range 1-60', () => {
      const rule = NUMERIC_SETTING_RULES.find((r) => r.key === 'offerSkipMinutes')
      expect(rule).toBeDefined()
      expect(rule?.mustBeInteger).toBe(true)
      expect(rule?.min).toBe(OFFER_SKIP_MINUTES_MIN)
      expect(rule?.max).toBe(OFFER_SKIP_MINUTES_MAX)
      expect(rule?.min).toBe(1)
      expect(rule?.max).toBe(60)
      expect(rule?.whyZeroIsRefused).toBe(
        'a rider who declined an offer could be offered the same delivery again at once'
      )
    })

    it('refuses 0 with 400 BadRequestException explaining why (decision 144.1)', async () => {
      await expect(service.setInstanceConfigSettings({ offerSkipMinutes: 0 } as any)).rejects.toThrow(
        BadRequestException
      )

      await expect(service.setInstanceConfigSettings({ offerSkipMinutes: 0 } as any)).rejects.toThrow(
        'offerSkipMinutes cannot be 0: a rider who declined an offer could be offered the same delivery again at once'
      )
      expect(configRepository.saveByKey).not.toHaveBeenCalled()
    })

    it.each([61, 241, 500, -1, -5])('refuses out of range value %p', async (value) => {
      await expect(service.setInstanceConfigSettings({ offerSkipMinutes: value } as any)).rejects.toThrow(
        BadRequestException
      )
      expect(configRepository.saveByKey).not.toHaveBeenCalled()
    })

    it('refuses 61 with its sentence (offerSkipMinutes must be 60 or less)', async () => {
      await expect(service.setInstanceConfigSettings({ offerSkipMinutes: 61 } as any)).rejects.toThrow(
        BadRequestException
      )
      await expect(service.setInstanceConfigSettings({ offerSkipMinutes: 61 } as any)).rejects.toThrow(
        'offerSkipMinutes must be 60 or less'
      )
      expect(configRepository.saveByKey).not.toHaveBeenCalled()
    })

    it('refuses null with BadRequestException and never saves (review test gap 3)', async () => {
      await expect(service.setInstanceConfigSettings({ offerSkipMinutes: null } as any)).rejects.toThrow(
        BadRequestException
      )
      await expect(service.setInstanceConfigSettings({ offerSkipMinutes: null } as any)).rejects.toThrow(
        'offerSkipMinutes must be a number'
      )
      expect(configRepository.saveByKey).not.toHaveBeenCalled()
    })

    it.each([1.5, 2.5, 20.3])('refuses non-integer fractional value %p', async (value) => {
      await expect(service.setInstanceConfigSettings({ offerSkipMinutes: value } as any)).rejects.toThrow(
        BadRequestException
      )
      await expect(service.setInstanceConfigSettings({ offerSkipMinutes: value } as any)).rejects.toThrow(
        'offerSkipMinutes must be a whole number'
      )
      expect(configRepository.saveByKey).not.toHaveBeenCalled()
    })

    it.each([1, 20, 60])('accepts valid boundary value %i and saves to database', async (value) => {
      await service.setInstanceConfigSettings({ offerSkipMinutes: value } as any)
      expect(configRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.OFFER_SKIP_MINUTES, value, expect.anything())
    })

    describe('admin form input validation pipe (empty string and types)', () => {
      const pipe = new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } })
      const check = (body: Record<string, unknown>) =>
        pipe.transform(body, { type: 'body', metatype: InstanceConfigSettingsAdminInput })

      it('accepts a valid JSON number', async () => {
        const result = (await check({ offerSkipMinutes: 20 })) as InstanceConfigSettingsAdminInput
        expect(result.offerSkipMinutes).toBe(20)
      })

      it('refuses an empty value ("") instead of converting it to 0', async () => {
        await expect(check({ offerSkipMinutes: '' })).rejects.toThrow('offerSkipMinutes cannot be empty')
      })

      it.each(['20', true, false, []])('refuses non-number %p with RefuseIfNotSentAsNumber message', async (value) => {
        await expect(check({ offerSkipMinutes: value })).rejects.toThrow('offerSkipMinutes must be sent as a number')
      })
    })
  })

  // --------------------------------------------------------------------------
  // Clause 3: getOfferSkipMinutes() fallback and warnings
  // --------------------------------------------------------------------------
  describe('Clause 3: getOfferSkipMinutes()', () => {
    it('reads quietly as default 20 with NO warning when row is missing in config table (decision 144.2)', async () => {
      configRepository.getByKey.mockRejectedValue(notFound)
      const warnSpy = jest.spyOn((service as any).logger, 'warn')

      const result = await service.getOfferSkipMinutes()

      expect(result).toBe(DEFAULT_OFFER_SKIP_MINUTES)
      expect(result).toBe(20)
      expect(warnSpy).not.toHaveBeenCalled()
    })

    it.each([
      [0, '0'],
      [61, '61'],
      [240, '240'],
      [999, '999'],
      [-1, '-1'],
      [2.5, '2.5'],
      ['abc', 'abc'],
    ])('warns and returns default 20 for invalid stored value %p', async (rawVal, displayVal) => {
      configRepository.getByKey.mockImplementation(stored(rawVal, typeof rawVal === 'number' ? 'number' : 'string'))
      const warnSpy = jest.spyOn((service as any).logger, 'warn')

      const result = await service.getOfferSkipMinutes()

      expect(result).toBe(20)
      expect(warnSpy).toHaveBeenCalledWith(
        `Invalid ${ConfigKey.OFFER_SKIP_MINUTES} in config (${displayVal}), using the default ${DEFAULT_OFFER_SKIP_MINUTES}`
      )
    })

    it.each([1, 5, 20, 60])('returns valid stored value %i without warning', async (value) => {
      configRepository.getByKey.mockImplementation(stored(value, 'number'))
      const warnSpy = jest.spyOn((service as any).logger, 'warn')

      const result = await service.getOfferSkipMinutes()

      expect(result).toBe(value)
      expect(warnSpy).not.toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // Clause 5: What changed (RIDER_FACING_SETTINGS and Greek twin)
  // --------------------------------------------------------------------------
  describe('Clause 5: RIDER_FACING_SETTINGS (EN & EL)', () => {
    const ctx = { distanceUnit: 'KILOMETERS', currency: 'EUR' }

    it('has offerSkipMinutes in English RIDER_FACING_SETTINGS with label and minutes formatter', () => {
      const entry = RIDER_FACING_SETTINGS.offerSkipMinutes
      expect(entry).toBeDefined()
      expect(entry!.label).toBe('Time before an order you declined or missed can be offered to you again')
      expect(entry!.format(20, ctx)).toBe('20 minutes')
      expect(entry!.format(1, ctx)).toBe('1 minute')
      expect(entry!.format(null, ctx)).toBe('not set')
      expect(entry!.format(undefined, ctx)).toBe('not set')
      expect(entry!.format('', ctx)).toBe('not set')
    })

    it('has offerSkipMinutes in Greek RIDER_FACING_SETTINGS_EL with label and minutes formatter', () => {
      const entry = RIDER_FACING_SETTINGS_EL.offerSkipMinutes
      expect(entry).toBeDefined()
      expect(entry!.label).toBe('Χρόνος πριν μπορέσει να σας ξαναπροταθεί μια παραγγελία που απορρίψατε ή χάσατε')
      expect(entry!.format(20, ctx)).toBe('20 λεπτά')
      expect(entry!.format(1, ctx)).toBe('1 λεπτό')
      expect(entry!.format(null, ctx)).toBe('δεν έχει οριστεί')
      expect(entry!.format(undefined, ctx)).toBe('δεν έχει οριστεί')
      expect(entry!.format('', ctx)).toBe('δεν έχει οριστεί')
    })
  })

  // --------------------------------------------------------------------------
  // Clause 6: Settings record (SettingChange), DTO/Input, and DB Seed
  // --------------------------------------------------------------------------
  describe('Clause 6: SettingChange audit trail, DTO, input and seed', () => {
    it('writes a SettingChange row (oldValue, newValue, changedByUserId) when offerSkipMinutes value moves', async () => {
      // Prior value in effect is 20 (the default when unconfigured)
      configRepository.getByKey.mockRejectedValue(notFound)

      await service.setInstanceConfigSettings({ offerSkipMinutes: 5 }, 'admin-user-1')

      expect(mockTx.settingChange.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          key: ConfigKey.OFFER_SKIP_MINUTES,
          oldValue: 20,
          newValue: 5,
          changedByUserId: 'admin-user-1',
        }),
      })
    })

    it('writes NO SettingChange row when offerSkipMinutes is resent with the same value', async () => {
      // Value in effect is already 20
      configRepository.getByKey.mockImplementation(stored(20, 'number'))

      await service.setInstanceConfigSettings({ offerSkipMinutes: 20 }, 'admin-user-1')

      const calls = mockTx.settingChange.create.mock.calls.filter(
        ([arg]: any) => arg?.data?.key === ConfigKey.OFFER_SKIP_MINUTES
      )
      expect(calls).toHaveLength(0)
    })

    it('getInstanceConfigSettings includes offerSkipMinutes', async () => {
      configRepository.getByKey.mockImplementation(stored(15, 'number'))

      const settings = await service.getInstanceConfigSettings()

      expect(settings.offerSkipMinutes).toBe(15)
    })

    it('admin DTO carries offerSkipMinutes through', () => {
      const dto = new InstanceConfigSettingsDto({
        offerSkipMinutes: 30,
      } as any)
      expect(dto.offerSkipMinutes).toBe(30)
    })

    it('InstanceConfigSettingsInput accepts offerSkipMinutes', () => {
      const input = new InstanceConfigSettingsInput()
      input.offerSkipMinutes = 45
      expect(input.offerSkipMinutes).toBe(45)
    })

    it('seedInitialInstanceConfig seeds offerSkipMinutes as 20 with number type', async () => {
      const mockFindUnique = jest.fn().mockResolvedValue(null)
      const mockCreate = jest.fn().mockResolvedValue({})
      const prismaStub = {
        config: { findUnique: mockFindUnique, create: mockCreate },
      } as unknown as PrismaClient

      await seedInitialInstanceConfig(prismaStub)

      const seedCall = mockCreate.mock.calls.find(([arg]: any) => arg?.data?.key === 'offerSkipMinutes')
      expect(seedCall).toBeDefined()
      expect(seedCall[0].data.value).toBe('20')
      expect(seedCall[0].data.type).toBe('number')
    })

    it('seedInitialInstanceConfig does not overwrite existing offerSkipMinutes row', async () => {
      const mockFindUnique = jest.fn().mockImplementation(async ({ where }: { where: { key: string } }) => {
        if (where.key === 'offerSkipMinutes') {
          return { key: 'offerSkipMinutes', value: '45', type: 'number' }
        }
        return null
      })
      const mockCreate = jest.fn().mockResolvedValue({})
      const prismaStub = {
        config: { findUnique: mockFindUnique, create: mockCreate },
      } as unknown as PrismaClient

      await seedInitialInstanceConfig(prismaStub)

      const seedCall = mockCreate.mock.calls.find(([arg]: any) => arg?.data?.key === 'offerSkipMinutes')
      expect(seedCall).toBeUndefined()
    })
  })
})
