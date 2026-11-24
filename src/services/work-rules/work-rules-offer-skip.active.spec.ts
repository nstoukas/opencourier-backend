import { WorkRulesService, EN_WORDS } from './work-rules.service'
import { EL_WORDS } from './work-rules.el'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { RemovalRequestRepository } from 'src/persistence/repositories/removal-request.repository'
import { SettingChangeRepository } from 'src/persistence/repositories/setting-change.repository'
import {
  EnumCourierCompensationCalculationType,
  EnumCourierDietaryRestrictions,
  EnumCourierMatcherType,
  EnumCurrency,
  EnumDeliveryDurationCalculationType,
  EnumDistanceUnit,
  EnumGeoCalculationType,
  EnumQuoteCalculationType,
  InstanceConfigSettings,
  InstanceDetails,
} from 'src/shared-types'
import { EnumAddOnMoment, EnumTwoOrderPolicy } from 'src/shared-types/stacking'

// Scope row 144, Clause 4:
// The How offers and pay work page (src/services/work-rules/work-rules.service.ts and its Greek words in work-rules.el.ts)
// shows the setting's minutes in English and Greek, not a fixed 20.
describe('How offers and pay work shows offerSkipMinutes setting (row 144, Clause 4)', () => {
  let service: WorkRulesService
  let mockConfigDomainService: any

  const baseSettings: InstanceConfigSettings = {
    courierMatcherType: EnumCourierMatcherType.NEAREST_COURIER,
    quoteCalculationType: EnumQuoteCalculationType.BY_DISTANCE,
    geoCalculationType: EnumGeoCalculationType.HAVERSINE,
    deliveryDurationCalculationType: EnumDeliveryDurationCalculationType.OSRM,
    courierCompensationCalculationType: EnumCourierCompensationCalculationType.FROM_QUOTE_FROM,
    defaultDietaryRestrictions: EnumCourierDietaryRestrictions.NONE,
    distanceUnit: EnumDistanceUnit.KILOMETERS,
    currency: EnumCurrency.EUR,
    maxAssignmentDistance: 20,
    maxDriftDistance: 5,
    quoteExpirationMinutes: 15,
    feePercentageAmount: 10,
    feePercentageCeiling: 25,
    quoteRatePerDistanceUnit: 150,
    quoteBaseFee: 200,
    defaultCourierPayRate: 300,
    defaultMaxWorkingHours: 8,
    details: {} as InstanceDetails,
    updatedAt: '2026-11-24T10:00:00.000Z',
    registeredRegistries: [],
    reassignmentPayoutPolicies: { FULL_COMPENSATION: 100 },
    reassignmentPayoutDefaultPolicy: 'FULL_COMPENSATION',
    offerExpiryEnabled: true,
    offerExpirySeconds: 60,
    noCourierRetrySeconds: 30,
    offerTimingEnabled: false,
    offerLeadMinutes: 3,
    offerTimingCandidates: 5,
    stackingEnabled: false,
    twoOrderPolicy: EnumTwoOrderPolicy.SHORTAGE_ONLY,
    twoOrderDelayLimitMinutes: 10,
    addOnOffersEnabled: false,
    addOnMoment: EnumAddOnMoment.BEFORE_PICKUP,
    savedCustomerRetentionMonths: 12,
    restaurantHistoryDays: 30,
    handBackSeconds: 60,
    offerSkipMinutes: 20,
    sosLocationRetentionDays: 30,
    arrivalRadiusMetres: 50,
    shiftsEnabled: false,
    shiftDropNoticeHours: 12,
    dispatchPhoneNumber: '+302421012345',
    cancellationPayoutPolicy: 'FULL_COMPENSATION',
    waitPayEnabled: false,
    waitPayFreeMinutes: 5,
    waitPayCentsPerMinute: 10,
    waitLimitMinutes: 10,
    splitAnswerMinutes: 10,
    shiftBreakMinutes: 30,
    returnTripPayPercent: 100,
    chatQuickRepliesDispatch: [],
    chatQuickRepliesCourier: [],
    chatRetentionDays: 90,
    addressNoteRetentionDays: 182,
    reviewAnswerDays: 14,
    reviewCorrectionMaxCents: 5000,
    boxUnitsSmall: 30,
    boxUnitsMedium: 50,
    boxUnitsLarge: 100,
    boxDefaultSize: 'MEDIUM',
    fairnessWeightRoadTime: 50,
    fairnessWeightEarnings: 30,
    fairnessWeightWaiting: 20,
    fairnessWeightShift: 0,
    fairnessCandidateLimit: 10,
    fairnessMinOnlineMinutes: 30,
  }

  beforeEach(() => {
    mockConfigDomainService = {
      instanceConfig: {
        getInstanceConfigSettings: jest.fn().mockResolvedValue({ ...baseSettings }),
        getCourierCompensationCalculationType: jest.fn().mockResolvedValue('FROM_QUOTE_FROM'),
      },
    }
    const mockRemovalRequestRepo = {
      findActiveReasons: jest.fn().mockResolvedValue([]),
    }
    const mockSettingChangeRepo = {
      findPage: jest.fn().mockResolvedValue({ data: [], pagination: {} }),
      findOldest: jest.fn().mockResolvedValue(null),
    }

    service = new WorkRulesService(
      mockConfigDomainService as unknown as ConfigDomainService,
      mockRemovalRequestRepo as unknown as RemovalRequestRepository,
      mockSettingChangeRepo as unknown as SettingChangeRepository
    )
  })

  describe('English wording', () => {
    it('shows 5 minutes when offerSkipMinutes is 5 (not fixed 20)', async () => {
      mockConfigDomainService.instanceConfig.getInstanceConfigSettings.mockResolvedValue({
        ...baseSettings,
        offerSkipMinutes: 5,
      })

      const result = await service.howItWorks('en')

      expect(result.offers).toContain(
        'If you decline or miss an offer, that order is not offered to you again for 5 minutes.'
      )
      expect(result.offers).not.toContain(
        'If you decline or miss an offer, that order is not offered to you again for 20 minutes.'
      )
    })

    it('shows 7 minutes when offerSkipMinutes is 7', async () => {
      mockConfigDomainService.instanceConfig.getInstanceConfigSettings.mockResolvedValue({
        ...baseSettings,
        offerSkipMinutes: 7,
      })

      const result = await service.howItWorks('en')

      expect(result.offers).toContain(
        'If you decline or miss an offer, that order is not offered to you again for 7 minutes.'
      )
    })

    it('EN_WORDS.notOfferedAgain formats dynamic minutes', () => {
      expect(EN_WORDS.notOfferedAgain(5)).toBe(
        'If you decline or miss an offer, that order is not offered to you again for 5 minutes.'
      )
      expect(EN_WORDS.notOfferedAgain(7)).toBe(
        'If you decline or miss an offer, that order is not offered to you again for 7 minutes.'
      )
    })
  })

  describe('Greek wording', () => {
    it('shows 5 λεπτά when offerSkipMinutes is 5 (not fixed 20)', async () => {
      mockConfigDomainService.instanceConfig.getInstanceConfigSettings.mockResolvedValue({
        ...baseSettings,
        offerSkipMinutes: 5,
      })

      const result = await service.howItWorks('el')

      expect(result.offers).toContain(
        'Αν απορρίψετε ή χάσετε μια πρόταση, η παραγγελία αυτή δεν σας ξαναπροτείνεται για 5 λεπτά.'
      )
      expect(result.offers).not.toContain(
        'Αν απορρίψετε ή χάσετε μια πρόταση, η παραγγελία αυτή δεν σας ξαναπροτείνεται για 20 λεπτά.'
      )
    })

    it('shows 7 λεπτά when offerSkipMinutes is 7', async () => {
      mockConfigDomainService.instanceConfig.getInstanceConfigSettings.mockResolvedValue({
        ...baseSettings,
        offerSkipMinutes: 7,
      })

      const result = await service.howItWorks('el')

      expect(result.offers).toContain(
        'Αν απορρίψετε ή χάσετε μια πρόταση, η παραγγελία αυτή δεν σας ξαναπροτείνεται για 7 λεπτά.'
      )
    })

    it('EL_WORDS.notOfferedAgain formats dynamic minutes in Greek', () => {
      expect(EL_WORDS.notOfferedAgain(5)).toBe(
        'Αν απορρίψετε ή χάσετε μια πρόταση, η παραγγελία αυτή δεν σας ξαναπροτείνεται για 5 λεπτά.'
      )
      expect(EL_WORDS.notOfferedAgain(7)).toBe(
        'Αν απορρίψετε ή χάσετε μια πρόταση, η παραγγελία αυτή δεν σας ξαναπροτείνεται για 7 λεπτά.'
      )
    })
  })
})
