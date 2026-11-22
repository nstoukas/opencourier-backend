import { BadRequestException } from '@nestjs/common'
import {
  DEFAULT_ADD_ON_MOMENT,
  DEFAULT_ADD_ON_OFFERS_ENABLED,
  DEFAULT_TWO_ORDER_DELAY_LIMIT_MINUTES,
  DEFAULT_TWO_ORDER_POLICY,
} from 'src/constants'
import { ConfigRepository } from 'src/persistence/repositories/config.repository'
import { ConfigKey } from 'src/shared-types'
import { RIDER_FACING_SETTINGS } from 'src/shared-types/rider-facing-settings'
import { EnumAddOnMoment, EnumTwoOrderPolicy } from 'src/shared-types/stacking'
import { ConfigEntity } from './entities/config.entity'
import { InstanceConfigDomainService } from './instance-config.domain.service'
import { WorkRulesService } from 'src/services/work-rules/work-rules.service'

// Spec 0048, AC-1: Co-op settings section "Two orders at once":
// - `addOnOffersEnabled` (default false)
// - `addOnMoment` (BEFORE_PICKUP | BEFORE_DROPOFF | SAME_RESTAURANT, default BEFORE_PICKUP)
// - `twoOrderPolicy` and `twoOrderDelayLimitMinutes` apply to add-ons as well
// Binding value 2: set by representatives in admin, never hard coded.
describe('Add-on co-op settings (spec 0048, AC-1, row 81)', () => {
  let service: InstanceConfigDomainService
  let configRepository: any

  const notFound = Object.assign(new Error('Record not found in config table'), { name: 'NotFoundError' })
  const stored = (storedKey: string, value: string, type = 'string') => async (key: string) => {
    if (key === storedKey) return new ConfigEntity({ key, value, type } as any)
    throw notFound
  }

  beforeEach(() => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      settingChange: { create: jest.fn().mockResolvedValue({ id: 'change-1' }) },
    }
    configRepository = {
      getByKey: jest.fn().mockRejectedValue(notFound),
      saveByKey: jest.fn().mockResolvedValue({}),
      inTransaction: jest.fn().mockImplementation(async (callback: any) => callback(tx)),
    }
    service = new InstanceConfigDomainService(
      configRepository as unknown as ConfigRepository,
      { get: jest.fn().mockReturnValue('100') } as any
    )
  })

  describe('defaults (AC-1)', () => {
    it('addOnOffersEnabled defaults to false (switch off by default)', () => {
      expect(DEFAULT_ADD_ON_OFFERS_ENABLED).toBe(false)
    })

    it('addOnMoment defaults to BEFORE_PICKUP', () => {
      expect(DEFAULT_ADD_ON_MOMENT).toBe(EnumAddOnMoment.BEFORE_PICKUP)
    })
  })

  describe('addOnOffersEnabled getter & setter', () => {
    it('answers false when never saved (default off)', async () => {
      await expect(service.getAddOnOffersEnabled()).resolves.toBe(false)
    })

    it('answers true when saved as true', async () => {
      configRepository.getByKey.mockImplementation(stored(ConfigKey.ADD_ON_OFFERS_ENABLED, 'true', 'boolean'))
      await expect(service.getAddOnOffersEnabled()).resolves.toBe(true)
    })

    it('refuses non-boolean values on save', async () => {
      await expect(service.setInstanceConfigSettings({ addOnOffersEnabled: 'yes' as any })).rejects.toThrow(
        BadRequestException
      )
      await expect(service.setInstanceConfigSettings({ addOnOffersEnabled: 'yes' as any })).rejects.toThrow(
        'addOnOffersEnabled must be true or false'
      )
      expect(configRepository.saveByKey).not.toHaveBeenCalled()
    })

    it('saves boolean true under ConfigKey.ADD_ON_OFFERS_ENABLED', async () => {
      await service.setInstanceConfigSettings({ addOnOffersEnabled: true })
      const saved = configRepository.saveByKey.mock.calls.find(
        (call: any[]) => call[0] === ConfigKey.ADD_ON_OFFERS_ENABLED
      )
      expect(saved).toBeDefined()
      expect(saved[1]).toBe(true)
    })
  })

  describe('addOnMoment getter & setter', () => {
    it('answers BEFORE_PICKUP when never saved (default moment)', async () => {
      await expect(service.getAddOnMoment()).resolves.toBe(EnumAddOnMoment.BEFORE_PICKUP)
    })

    it('answers BEFORE_DROPOFF when saved as BEFORE_DROPOFF', async () => {
      configRepository.getByKey.mockImplementation(stored(ConfigKey.ADD_ON_MOMENT, EnumAddOnMoment.BEFORE_DROPOFF))
      await expect(service.getAddOnMoment()).resolves.toBe(EnumAddOnMoment.BEFORE_DROPOFF)
    })

    it('answers SAME_RESTAURANT when saved as SAME_RESTAURANT', async () => {
      configRepository.getByKey.mockImplementation(stored(ConfigKey.ADD_ON_MOMENT, EnumAddOnMoment.SAME_RESTAURANT))
      await expect(service.getAddOnMoment()).resolves.toBe(EnumAddOnMoment.SAME_RESTAURANT)
    })

    it('falls back to BEFORE_PICKUP for an unknown stored string', async () => {
      configRepository.getByKey.mockImplementation(stored(ConfigKey.ADD_ON_MOMENT, 'INVALID_MOMENT'))
      await expect(service.getAddOnMoment()).resolves.toBe(EnumAddOnMoment.BEFORE_PICKUP)
    })

    it('refuses invalid moment on save', async () => {
      await expect(service.setInstanceConfigSettings({ addOnMoment: 'WHENEVER' as any })).rejects.toThrow(
        BadRequestException
      )
      await expect(service.setInstanceConfigSettings({ addOnMoment: 'WHENEVER' as any })).rejects.toThrow(
        'addOnMoment must be BEFORE_PICKUP, BEFORE_DROPOFF or SAME_RESTAURANT'
      )
      expect(configRepository.saveByKey).not.toHaveBeenCalled()
    })

    it('saves valid moment under ConfigKey.ADD_ON_MOMENT', async () => {
      await service.setInstanceConfigSettings({ addOnMoment: EnumAddOnMoment.BEFORE_DROPOFF })
      const saved = configRepository.saveByKey.mock.calls.find((call: any[]) => call[0] === ConfigKey.ADD_ON_MOMENT)
      expect(saved).toBeDefined()
      expect(saved[1]).toBe(EnumAddOnMoment.BEFORE_DROPOFF)
    })
  })

  describe('rider facing labels & formatting (RIDER_FACING_SETTINGS)', () => {
    const emptyContext = {} as any

    it('has rider facing setting for addOnOffersEnabled', () => {
      const setting = RIDER_FACING_SETTINGS.addOnOffersEnabled!
      expect(setting).toBeDefined()
      expect(setting.label).toBe('One more order offered while on a job')
      expect(setting.format(true, emptyContext)).toBe('on')
      expect(setting.format(false, emptyContext)).toBe('off')
    })

    it('has rider facing setting for addOnMoment', () => {
      const setting = RIDER_FACING_SETTINGS.addOnMoment!
      expect(setting).toBeDefined()
      expect(setting.label).toBe('When one more order may be offered')
      expect(setting.format(EnumAddOnMoment.BEFORE_PICKUP, emptyContext)).toBe('before you pick up the first order')
      expect(setting.format(EnumAddOnMoment.BEFORE_DROPOFF, emptyContext)).toBe('any time before the first drop off')
      expect(setting.format(EnumAddOnMoment.SAME_RESTAURANT, emptyContext)).toBe(
        'only at the same restaurant, before the pickup'
      )
      expect(setting.format(null, emptyContext)).toBe('not set')
    })
  })

  describe('WorkRulesService: How offers and pay work sentence', () => {
    let workRulesService: WorkRulesService
    let mockConfigDomainService: any

    const mockBaseSettings = {
      courierMatcherType: 'NEAREST_COURIER',
      maxAssignmentDistance: 20,
      distanceUnit: 'KILOMETERS',
      currency: 'EUR',
      quoteBaseFee: 200,
      quoteRatePerDistanceUnit: 150,
      reassignmentPayoutPolicies: { FULL_COMPENSATION: 100 },
      reassignmentPayoutDefaultPolicy: 'FULL_COMPENSATION',
      cancellationPayoutPolicy: 'FULL_COMPENSATION',
      waitPayEnabled: false,
      waitPayCentsPerMinute: 0,
      waitPayFreeMinutes: 5,
      waitLimitMinutes: 10,
      splitAnswerMinutes: 10,
      returnTripPayPercent: 100,
      handBackSeconds: 60,
      reviewCorrectionMaxCents: 5000,
      offerExpiryEnabled: false,
      offerExpirySeconds: 60,
      offerTimingEnabled: false,
      offerLeadMinutes: 3,
      stackingEnabled: false,
      twoOrderPolicy: EnumTwoOrderPolicy.SHORTAGE_ONLY,
      twoOrderDelayLimitMinutes: 10,
      addOnOffersEnabled: false,
      addOnMoment: EnumAddOnMoment.BEFORE_PICKUP,
      addressNoteRetentionDays: 182,
      shiftBreakMinutes: 30,
      reviewAnswerDays: 14,
    }

    beforeEach(() => {
      mockConfigDomainService = {
        instanceConfig: {
          getInstanceConfigSettings: jest.fn(),
          getTwoOrderPolicy: jest.fn().mockResolvedValue(DEFAULT_TWO_ORDER_POLICY),
          getTwoOrderDelayLimitMinutes: jest.fn().mockResolvedValue(DEFAULT_TWO_ORDER_DELAY_LIMIT_MINUTES),
        },
      }
      workRulesService = new WorkRulesService(
        mockConfigDomainService,
        { findActiveReasons: jest.fn().mockResolvedValue([]) } as any,
        { findPage: jest.fn().mockResolvedValue({ data: [] }), findOldest: jest.fn().mockResolvedValue(null) } as any
      )
    })

    it('omits add on sentence when addOnOffersEnabled is false', async () => {
      mockConfigDomainService.instanceConfig.getInstanceConfigSettings.mockResolvedValueOnce({
        ...mockBaseSettings,
        addOnOffersEnabled: false,
      })

      const rules = await workRulesService.howItWorks()
      const addOnSentence = rules.offers.find((s: string) => s.includes('one more order on the way'))
      expect(addOnSentence).toBeUndefined()
    })

    it('includes add on sentence with calm notice when addOnOffersEnabled is true', async () => {
      mockConfigDomainService.instanceConfig.getInstanceConfigSettings.mockResolvedValueOnce({
        ...mockBaseSettings,
        addOnOffersEnabled: true,
        addOnMoment: EnumAddOnMoment.BEFORE_PICKUP,
        twoOrderPolicy: EnumTwoOrderPolicy.SHORTAGE_ONLY,
        twoOrderDelayLimitMinutes: 10,
      })

      const rules = await workRulesService.howItWorks()
      const addOnSentence = rules.offers.find((s: string) => s.includes('one more order on the way'))
      expect(addOnSentence).toBeDefined()
      expect(addOnSentence).toContain('before you pick up your current order')
      expect(addOnSentence).toContain('only when that order found no free rider')
      expect(addOnSentence).toContain('arrives at most 10 minutes later')
      expect(addOnSentence).toContain(
        'Answer an add on only when you are stopped: one offered while you carry food never rings insistently and gives you twice the usual time to answer.'
      )
    })

    it('describes whenever it fits and before dropoff accurately', async () => {
      mockConfigDomainService.instanceConfig.getInstanceConfigSettings.mockResolvedValueOnce({
        ...mockBaseSettings,
        addOnOffersEnabled: true,
        addOnMoment: EnumAddOnMoment.BEFORE_DROPOFF,
        twoOrderPolicy: EnumTwoOrderPolicy.WHENEVER_FITS,
        twoOrderDelayLimitMinutes: 15,
      })

      const rules = await workRulesService.howItWorks()
      const addOnSentence = rules.offers.find((s: string) => s.includes('one more order on the way'))
      expect(addOnSentence).toBeDefined()
      expect(addOnSentence).toContain('any time before you drop off your current order')
      expect(addOnSentence).toContain('whenever it fits')
      expect(addOnSentence).toContain('arrives at most 15 minutes later')
    })
  })
})
