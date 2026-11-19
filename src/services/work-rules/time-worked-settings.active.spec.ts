import {
  DEFAULT_SHIFT_BREAK_MINUTES,
  SHIFT_BREAK_MINUTES_MAX,
  SHIFT_BREAK_MINUTES_MIN,
} from 'src/constants'
import {
  InstanceConfigDomainService,
  NUMERIC_SETTING_RULES,
} from 'src/domains/config/instance-config.domain.service'
import { RIDER_FACING_SETTINGS } from 'src/shared-types/rider-facing-settings'
import {
  TIME_WORKED_ADMIN_VIEW,
  WorkRulesService,
  timeWorkedSentences,
} from './work-rules.service'

describe('Time Worked Settings (spec 0040, AC-9, AC-13, AC-17)', () => {
  describe('NUMERIC_SETTING_RULES for shiftBreakMinutes (AC-17)', () => {
    test('shiftBreakMinutes is in NUMERIC_SETTING_RULES with min 0 and max 240 and default 30', () => {
      const rule = NUMERIC_SETTING_RULES.find((r) => r.key === 'shiftBreakMinutes')
      expect(rule).toBeDefined()
      expect(rule!.min).toBe(0)
      expect(rule!.max).toBe(240)
      expect(rule!.min).toBe(SHIFT_BREAK_MINUTES_MIN)
      expect(rule!.max).toBe(SHIFT_BREAK_MINUTES_MAX)
      expect(rule!.mustBeInteger).toBe(true)
      // 0 is a valid value, not refused
      expect(rule!.whyZeroIsRefused).toBeNull()

      expect(DEFAULT_SHIFT_BREAK_MINUTES).toBe(30)
    })

    test('getShiftBreakMinutes returns default 30 when unset', async () => {
      const notFoundErr = Object.assign(new Error('Not found'), { name: 'NotFoundError' })
      const mockConfigRepo = {
        getByKey: jest.fn().mockRejectedValue(notFoundErr),
      }
      const instanceConfigService = new InstanceConfigDomainService(
        mockConfigRepo as any,
        {} as any
      )

      const value = await instanceConfigService.getShiftBreakMinutes()
      expect(value).toBe(30)
    })
  })

  describe('RIDER_FACING_SETTINGS for shiftBreakMinutes (AC-13, decision 36.42)', () => {
    test('formats 0 as "none, every Offline with no job ends the shift" and 30 as "30 minutes"', () => {
      const setting = RIDER_FACING_SETTINGS.shiftBreakMinutes
      expect(setting).toBeDefined()
      expect(setting!.label).toBe('Longest break inside one shift of time worked')

      const context = { distanceUnit: 'KILOMETERS', currency: 'EUR' }
      expect(setting!.format(0, context)).toBe('none, every Offline with no job ends the shift')
      expect(setting!.format('0', context)).toBe('none, every Offline with no job ends the shift')
      expect(setting!.format(30, context)).toBe('30 minutes')
      expect(setting!.format('30', context)).toBe('30 minutes')
    })
  })

  describe('WorkRulesService.howItWorks().timeWorked (AC-13)', () => {
    test('howItWorks().timeWorked uses live shiftBreakMinutes and includes TIME_WORKED_ADMIN_VIEW', async () => {
      const mockConfigDomainService = {
        instanceConfig: {
          getInstanceConfigSettings: jest.fn().mockResolvedValue({
            courierMatcherType: 'STATIC',
            distanceUnit: 'KILOMETERS',
            currency: 'EUR',
            shiftBreakMinutes: 30,
            reviewAnswerDays: 14,
            reassignmentPayoutPolicies: {},
            reassignmentPayoutDefaultPolicy: 'FULL',
          }),
        },
      }
      const mockRemovalRequestRepo = {
        findActiveReasons: jest.fn().mockResolvedValue([]),
      }
      const mockSettingChangeRepo = {
        findRecentAdmin: jest.fn().mockResolvedValue([]),
        findRecentRider: jest.fn().mockResolvedValue([]),
      }

      const service = new WorkRulesService(
        mockConfigDomainService as any,
        mockRemovalRequestRepo as any,
        mockSettingChangeRepo as any
      )

      // When shiftBreakMinutes is 30:
      const result30 = await service.howItWorks()
      expect(result30.timeWorked).toBeDefined()
      expect(result30.timeWorked).toContain(TIME_WORKED_ADMIN_VIEW)
      const breakSentence30 = result30.timeWorked.find((s) => s.includes('break'))
      expect(breakSentence30).toContain('30 minutes')

      // When shiftBreakMinutes is 0:
      mockConfigDomainService.instanceConfig.getInstanceConfigSettings.mockResolvedValueOnce({
        courierMatcherType: 'STATIC',
        distanceUnit: 'KILOMETERS',
        currency: 'EUR',
        shiftBreakMinutes: 0,
        reviewAnswerDays: 14,
        reassignmentPayoutPolicies: {},
        reassignmentPayoutDefaultPolicy: 'FULL',
      })

      const result0 = await service.howItWorks()
      expect(result0.timeWorked).toContain(TIME_WORKED_ADMIN_VIEW)
      expect(result0.timeWorked).toContain('Every Offline with no job ends the shift.')

      // Also verify pure function timeWorkedSentences directly
      expect(timeWorkedSentences(0)).toContain('Every Offline with no job ends the shift.')
      expect(timeWorkedSentences(0)).toContain(TIME_WORKED_ADMIN_VIEW)
      expect(timeWorkedSentences(45).some((s) => s.includes('45 minutes'))).toBe(true)
      expect(timeWorkedSentences(45)).toContain(TIME_WORKED_ADMIN_VIEW)
    })
  })
})
