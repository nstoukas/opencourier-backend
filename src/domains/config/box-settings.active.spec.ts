import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { BoxSize } from '@prisma/types'
import { InstanceConfigDomainService } from './instance-config.domain.service'
import { ConfigRepository } from 'src/persistence/repositories/config.repository'
import { ConfigEntity } from './entities/config.entity'
import { ConfigKey } from 'src/shared-types'
import { InstanceConfigSettingsAdminInput } from 'src/rest-api/config/admin/queries/instance-config-settings.admin.input'

/**
 * Spec 0043 (Row 9) - Box Model Co-op Settings: AC-2
 */
describe('Box Model: Instance Configuration Settings (AC-2)', () => {
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  })

  let service: InstanceConfigDomainService
  let mockConfigRepository: any
  let mockTx: any

  const notFoundError = new Error('Record not found in config table')
  notFoundError.name = 'NotFoundError'

  beforeEach(() => {
    mockTx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      settingChange: {
        create: jest.fn().mockResolvedValue({ id: 'change-1' }),
      },
    }

    mockConfigRepository = {
      getByKey: jest.fn().mockRejectedValue(notFoundError),
      saveByKey: jest.fn().mockResolvedValue({}),
      inTransaction: jest.fn().mockImplementation(async (callback: any) => callback(mockTx)),
    }

    const mockFileConfigService = {
      get: jest.fn().mockReturnValue('100'),
    }

    service = new InstanceConfigDomainService(
      mockConfigRepository as unknown as ConfigRepository,
      mockFileConfigService as any
    )
  })

  describe('Settings defaults and fallback on missing or bad stored values', () => {
    test('reads defaults when missing from DB: boxUnitsSmall 30, boxUnitsMedium 50, boxUnitsLarge 100, boxDefaultSize MEDIUM', async () => {
      mockConfigRepository.getByKey.mockRejectedValue(notFoundError)

      expect(await service.getBoxUnitsSmall()).toBe(30)
      expect(await service.getBoxUnitsMedium()).toBe(50)
      expect(await service.getBoxUnitsLarge()).toBe(100)
      expect(await service.getBoxDefaultSize()).toBe(BoxSize.MEDIUM)
    })

    test('bad stored numeric values fall back to defaults (non-number, out of range 1..100)', async () => {
      // Stored as string 'not-a-number'
      mockConfigRepository.getByKey.mockImplementation(async (key: string) => {
        if (key === ConfigKey.BOX_UNITS_SMALL) {
          return new ConfigEntity({ key, value: 'bad', type: 'string' })
        }
        if (key === ConfigKey.BOX_UNITS_MEDIUM) {
          return new ConfigEntity({ key, value: '0', type: 'number' }) // below min 1
        }
        if (key === ConfigKey.BOX_UNITS_LARGE) {
          return new ConfigEntity({ key, value: '101', type: 'number' }) // above max 100
        }
        throw notFoundError
      })

      expect(await service.getBoxUnitsSmall()).toBe(30)
      expect(await service.getBoxUnitsMedium()).toBe(50)
      expect(await service.getBoxUnitsLarge()).toBe(100)
    })

    test('bad stored boxDefaultSize (unknown string or wrong type) logs warning and falls back to MEDIUM', async () => {
      const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined)

      mockConfigRepository.getByKey.mockResolvedValue(
        new ConfigEntity({ key: ConfigKey.BOX_DEFAULT_SIZE, value: 'EXTRA_LARGE', type: 'string' })
      )

      expect(await service.getBoxDefaultSize()).toBe(BoxSize.MEDIUM)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid boxDefaultSize in config (EXTRA_LARGE), using the default MEDIUM')
      )
    })
  })

  describe('Numeric validation: 0, below 1, above 100, fractional, empty string', () => {
    const boxKeys = ['boxUnitsSmall', 'boxUnitsMedium', 'boxUnitsLarge'] as const

    for (const key of boxKeys) {
      test(`refuses 0 for ${key} with clear explanation`, async () => {
        await expect(service.setInstanceConfigSettings({ [key]: 0 } as any)).rejects.toThrow(
          `${key} cannot be 0: every order takes some room in the box`
        )
      })

      test(`refuses below 1 (-1) for ${key}`, async () => {
        await expect(service.setInstanceConfigSettings({ [key]: -1 } as any)).rejects.toThrow(
          `${key} cannot be negative`
        )
      })

      test(`refuses above 100 (101) for ${key}`, async () => {
        await expect(service.setInstanceConfigSettings({ [key]: 101 } as any)).rejects.toThrow(
          `${key} must be 100 or less`
        )
      })

      test(`refuses fractional value (50.5) for ${key}`, async () => {
        await expect(service.setInstanceConfigSettings({ [key]: 50.5 } as any)).rejects.toThrow(
          `${key} must be a whole number`
        )
      })

      test(`DTO guard refuses empty string for ${key}`, async () => {
        await expect(
          pipe.transform({ [key]: '' }, { type: 'body', metatype: InstanceConfigSettingsAdminInput })
        ).rejects.toThrow(`${key} cannot be empty`)
      })
    }
  })

  describe('Size ordering validation (Small <= Medium <= Large) on merged values', () => {
    beforeEach(() => {
      // By default, DB has stored defaults: Small 30, Medium 50, Large 100
      mockConfigRepository.getByKey.mockImplementation(async (key: string) => {
        if (key === ConfigKey.BOX_UNITS_SMALL) {
          return new ConfigEntity({ key, value: '30', type: 'number' })
        }
        if (key === ConfigKey.BOX_UNITS_MEDIUM) {
          return new ConfigEntity({ key, value: '50', type: 'number' })
        }
        if (key === ConfigKey.BOX_UNITS_LARGE) {
          return new ConfigEntity({ key, value: '100', type: 'number' })
        }
        throw notFoundError
      })
    })

    test('refuses Small > Medium when only boxUnitsSmall is sent (e.g. Small 60 > stored Medium 50)', async () => {
      await expect(service.setInstanceConfigSettings({ boxUnitsSmall: 60 })).rejects.toThrow(
        'Small (60 units) cannot take more room than Medium (50 units).'
      )
      expect(mockConfigRepository.saveByKey).not.toHaveBeenCalled()
    })

    test('refuses Small > Medium when only boxUnitsMedium is sent (e.g. stored Small 30 > Medium 20)', async () => {
      await expect(service.setInstanceConfigSettings({ boxUnitsMedium: 20 })).rejects.toThrow(
        'Small (30 units) cannot take more room than Medium (20 units).'
      )
      expect(mockConfigRepository.saveByKey).not.toHaveBeenCalled()
    })

    test('refuses Medium > Large when only boxUnitsLarge is sent (e.g. stored Medium 50 > Large 40)', async () => {
      await expect(service.setInstanceConfigSettings({ boxUnitsLarge: 40 })).rejects.toThrow(
        'Medium (50 units) cannot take more room than Large (40 units).'
      )
      expect(mockConfigRepository.saveByKey).not.toHaveBeenCalled()
    })

    test('accepts equal values (Small 50 <= Medium 50 <= Large 50)', async () => {
      await expect(
        service.setInstanceConfigSettings({
          boxUnitsSmall: 50,
          boxUnitsMedium: 50,
          boxUnitsLarge: 50,
        })
      ).resolves.toBeDefined()

      expect(mockConfigRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.BOX_UNITS_SMALL, 50, mockTx)
      expect(mockConfigRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.BOX_UNITS_MEDIUM, 50, mockTx)
      expect(mockConfigRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.BOX_UNITS_LARGE, 50, mockTx)
    })

    test('a save that sends none of the three is not checked (stored bad order does not block an unrelated save)', async () => {
      // Simulate stored bad order in DB (e.g. legacy/corrupted: Small 60, Medium 50, Large 100)
      mockConfigRepository.getByKey.mockImplementation(async (key: string) => {
        if (key === ConfigKey.BOX_UNITS_SMALL) {
          return new ConfigEntity({ key, value: '60', type: 'number' })
        }
        if (key === ConfigKey.BOX_UNITS_MEDIUM) {
          return new ConfigEntity({ key, value: '50', type: 'number' })
        }
        if (key === ConfigKey.BOX_UNITS_LARGE) {
          return new ConfigEntity({ key, value: '100', type: 'number' })
        }
        throw notFoundError
      })

      // Unrelated setting save (e.g. maxAssignmentDistance)
      await expect(service.setInstanceConfigSettings({ maxAssignmentDistance: 15 })).resolves.toBeDefined()

      expect(mockConfigRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.MAX_ASSIGNMENT_DISTANCE, 15, mockTx)
    })
  })

  describe('boxDefaultSize validation', () => {
    test('accepts valid BoxSize values (SMALL, MEDIUM, LARGE)', async () => {
      for (const size of [BoxSize.SMALL, BoxSize.MEDIUM, BoxSize.LARGE]) {
        await expect(service.setInstanceConfigSettings({ boxDefaultSize: size })).resolves.toBeDefined()
        expect(mockConfigRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.BOX_DEFAULT_SIZE, size, mockTx)
      }
    })

    test('refuses invalid boxDefaultSize (not SMALL, MEDIUM, LARGE) with 400', async () => {
      await expect(service.setInstanceConfigSettings({ boxDefaultSize: 'INVALID_SIZE' as any })).rejects.toThrow(
        new BadRequestException('boxDefaultSize must be SMALL, MEDIUM or LARGE')
      )

      // DTO pipe validation refusal
      await expect(
        pipe.transform({ boxDefaultSize: 'EXTRA_LARGE' }, { type: 'body', metatype: InstanceConfigSettingsAdminInput })
      ).rejects.toThrow(BadRequestException)
    })
  })
})
