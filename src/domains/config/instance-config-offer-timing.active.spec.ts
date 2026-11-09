import { BadRequestException } from '@nestjs/common'
import { InstanceConfigDomainService, NUMERIC_SETTING_RULES } from './instance-config.domain.service'
import { ConfigRepository } from '../../persistence/repositories/config.repository'
import { ConfigService } from '@nestjs/config'
import { ConfigKey } from 'src/shared-types'
import {
  DEFAULT_OFFER_TIMING_ENABLED,
  DEFAULT_OFFER_LEAD_MINUTES,
  OFFER_LEAD_MINUTES_MIN,
  OFFER_LEAD_MINUTES_MAX,
  DEFAULT_OFFER_TIMING_CANDIDATES,
  OFFER_TIMING_CANDIDATES_MIN,
  OFFER_TIMING_CANDIDATES_MAX,
} from 'src/constants'
import { ConfigEntity } from './entities/config.entity'

describe('InstanceConfigDomainService - Offer Timing Settings (Spec 0031: AC-1)', () => {
  let service: InstanceConfigDomainService
  let configRepository: jest.Mocked<ConfigRepository>
  let fileConfigService: jest.Mocked<ConfigService>

  beforeEach(() => {
    const notFoundError = new Error('Record not found in config table')
    notFoundError.name = 'NotFoundError'

    configRepository = {
      getByKey: jest.fn().mockRejectedValue(notFoundError),
      saveByKey: jest.fn().mockResolvedValue(undefined),
    } as any

    fileConfigService = {
      get: jest.fn().mockReturnValue('STATIC'),
    } as any

    service = new InstanceConfigDomainService(configRepository, fileConfigService)
  })

  describe('NUMERIC_SETTING_RULES for offer timing settings', () => {
    it('defines offerLeadMinutes rule: 0 to 30, integer, 0 allowed', () => {
      const rule = NUMERIC_SETTING_RULES.find((r) => r.key === 'offerLeadMinutes')
      expect(rule).toBeDefined()
      expect(rule?.min).toBe(OFFER_LEAD_MINUTES_MIN)
      expect(rule?.min).toBe(0)
      expect(rule?.max).toBe(OFFER_LEAD_MINUTES_MAX)
      expect(rule?.max).toBe(30)
      expect(rule?.mustBeInteger).toBe(true)
      expect(rule?.whyZeroIsRefused).toBeNull() // 0 is allowed
    })

    it('defines offerTimingCandidates rule: 1 to 20, integer, 0 refused', () => {
      const rule = NUMERIC_SETTING_RULES.find((r) => r.key === 'offerTimingCandidates')
      expect(rule).toBeDefined()
      expect(rule?.min).toBe(OFFER_TIMING_CANDIDATES_MIN)
      expect(rule?.min).toBe(1)
      expect(rule?.max).toBe(OFFER_TIMING_CANDIDATES_MAX)
      expect(rule?.max).toBe(20)
      expect(rule?.mustBeInteger).toBe(true)
      expect(rule?.whyZeroIsRefused).toBe('no rider could be compared at all')
    })
  })

  describe('getOfferTimingEnabled', () => {
    it('returns stored boolean true when true', async () => {
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.OFFER_TIMING_ENABLED, value: 'true', type: 'boolean' })
      )
      const result = await service.getOfferTimingEnabled()
      expect(result).toBe(true)
    })

    it('returns stored boolean false when false', async () => {
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.OFFER_TIMING_ENABLED, value: 'false', type: 'boolean' })
      )
      const result = await service.getOfferTimingEnabled()
      expect(result).toBe(false)
    })

    it('falls back to DEFAULT_OFFER_TIMING_ENABLED (false) when missing from config table', async () => {
      const notFound = new Error('Not found')
      notFound.name = 'NotFoundError'
      configRepository.getByKey.mockRejectedValueOnce(notFound)

      const result = await service.getOfferTimingEnabled()
      expect(result).toBe(DEFAULT_OFFER_TIMING_ENABLED)
      expect(result).toBe(false)
    })
  })

  describe('getOfferLeadMinutes', () => {
    it('returns stored value when valid within [0, 30]', async () => {
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.OFFER_LEAD_MINUTES, value: '5', type: 'number' })
      )
      expect(await service.getOfferLeadMinutes()).toBe(5)
    })

    it('returns 0 when stored as 0 (0 minutes is allowed)', async () => {
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.OFFER_LEAD_MINUTES, value: '0', type: 'number' })
      )
      expect(await service.getOfferLeadMinutes()).toBe(0)
    })

    it('returns 30 when stored as 30 (boundary value)', async () => {
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.OFFER_LEAD_MINUTES, value: '30', type: 'number' })
      )
      expect(await service.getOfferLeadMinutes()).toBe(30)
    })

    it('falls back to DEFAULT_OFFER_LEAD_MINUTES (3) when missing or out of range', async () => {
      // Missing (rejected with notFoundError by default)
      expect(await service.getOfferLeadMinutes()).toBe(DEFAULT_OFFER_LEAD_MINUTES)

      // Out of range (>30)
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.OFFER_LEAD_MINUTES, value: '35', type: 'number' })
      )
      expect(await service.getOfferLeadMinutes()).toBe(3)

      // Negative (<0)
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.OFFER_LEAD_MINUTES, value: '-1', type: 'number' })
      )
      expect(await service.getOfferLeadMinutes()).toBe(3)
    })
  })

  describe('getOfferTimingCandidates', () => {
    it('returns stored value when valid within [1, 20]', async () => {
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.OFFER_TIMING_CANDIDATES, value: '10', type: 'number' })
      )
      expect(await service.getOfferTimingCandidates()).toBe(10)
    })

    it('returns 1 when stored as 1 (minimum boundary)', async () => {
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.OFFER_TIMING_CANDIDATES, value: '1', type: 'number' })
      )
      expect(await service.getOfferTimingCandidates()).toBe(1)
    })

    it('returns 20 when stored as 20 (maximum boundary)', async () => {
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.OFFER_TIMING_CANDIDATES, value: '20', type: 'number' })
      )
      expect(await service.getOfferTimingCandidates()).toBe(20)
    })

    it('falls back to DEFAULT_OFFER_TIMING_CANDIDATES (5) when missing or out of range', async () => {
      // Missing (rejected with notFoundError by default)
      expect(await service.getOfferTimingCandidates()).toBe(DEFAULT_OFFER_TIMING_CANDIDATES)

      // 0 is out of range (< 1)
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.OFFER_TIMING_CANDIDATES, value: '0', type: 'number' })
      )
      expect(await service.getOfferTimingCandidates()).toBe(5)

      // > 20 is out of range
      configRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.OFFER_TIMING_CANDIDATES, value: '25', type: 'number' })
      )
      expect(await service.getOfferTimingCandidates()).toBe(5)
    })
  })

  describe('setInstanceConfigSettings - saving offer timing settings', () => {
    it('saves offerTimingEnabled, offerLeadMinutes, and offerTimingCandidates to repository', async () => {
      await service.setInstanceConfigSettings({
        offerTimingEnabled: true,
        offerLeadMinutes: 5,
        offerTimingCandidates: 8,
      })

      expect(configRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.OFFER_TIMING_ENABLED, true)
      expect(configRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.OFFER_LEAD_MINUTES, 5)
      expect(configRepository.saveByKey).toHaveBeenCalledWith(ConfigKey.OFFER_TIMING_CANDIDATES, 8)
    })

    it('rejects offerTimingEnabled when not a boolean', async () => {
      await expect(
        service.setInstanceConfigSettings({
          offerTimingEnabled: 'true' as any,
        })
      ).rejects.toThrow(new BadRequestException('offerTimingEnabled must be a boolean'))

      await expect(
        service.setInstanceConfigSettings({
          offerTimingEnabled: 1 as any,
        })
      ).rejects.toThrow(new BadRequestException('offerTimingEnabled must be a boolean'))
    })

    it('rejects offerLeadMinutes when out of range or not integer', async () => {
      // Negative
      await expect(
        service.setInstanceConfigSettings({
          offerLeadMinutes: -1,
        })
      ).rejects.toThrow(BadRequestException)

      // Greater than 30
      await expect(
        service.setInstanceConfigSettings({
          offerLeadMinutes: 31,
        })
      ).rejects.toThrow(BadRequestException)

      // Decimal / float
      await expect(
        service.setInstanceConfigSettings({
          offerLeadMinutes: 4.5,
        })
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects offerTimingCandidates when 0, out of range, or not integer', async () => {
      // 0 is refused with the reason
      await expect(
        service.setInstanceConfigSettings({
          offerTimingCandidates: 0,
        })
      ).rejects.toThrow(BadRequestException)

      // Greater than 20
      await expect(
        service.setInstanceConfigSettings({
          offerTimingCandidates: 21,
        })
      ).rejects.toThrow(BadRequestException)

      // Negative
      await expect(
        service.setInstanceConfigSettings({
          offerTimingCandidates: -2,
        })
      ).rejects.toThrow(BadRequestException)

      // Float
      await expect(
        service.setInstanceConfigSettings({
          offerTimingCandidates: 3.5,
        })
      ).rejects.toThrow(BadRequestException)
    })
  })
})
