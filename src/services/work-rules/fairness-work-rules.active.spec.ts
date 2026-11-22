import { EnumAddOnMoment, EnumTwoOrderPolicy } from 'src/shared-types/stacking'
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
import { WorkRulesService, fairnessSentences } from './work-rules.service'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { RemovalRequestRepository } from 'src/persistence/repositories/removal-request.repository'
import { SettingChangeRepository } from 'src/persistence/repositories/setting-change.repository'

describe('WorkRulesService with FAIRNESS Matcher (Spec 0044: AC-5, decision 12.4)', () => {
  let service: WorkRulesService
  let mockConfigDomainService: jest.Mocked<ConfigDomainService>
  let mockRemovalRequestRepository: jest.Mocked<RemovalRequestRepository>
  let mockSettingChangeRepository: jest.Mocked<SettingChangeRepository>

  const fairnessSettings: InstanceConfigSettings = {
    courierMatcherType: EnumCourierMatcherType.FAIRNESS,
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
    updatedAt: '2026-11-21T10:00:00.000Z',
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
    sosLocationRetentionDays: 30,
    arrivalRadiusMetres: 50,
    shiftsEnabled: true,
    shiftDropNoticeHours: 12,
    dispatchPhoneNumber: '+302421012345',
    cancellationPayoutPolicy: 'FULL_COMPENSATION',
    waitPayEnabled: true,
    waitPayFreeMinutes: 5,
    waitPayCentsPerMinute: 10,
    waitLimitMinutes: 10,
    // Spec 0047: the split answer time is a setting too.
    splitAnswerMinutes: 10,
    shiftBreakMinutes: 30,
    returnTripPayPercent: 100,
    chatQuickRepliesDispatch: ['Preset 1'],
    chatQuickRepliesCourier: ['Preset 2'],
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
        getInstanceConfigSettings: jest.fn().mockResolvedValue(fairnessSettings),
      },
    } as unknown as jest.Mocked<ConfigDomainService>

    mockRemovalRequestRepository = {
      findActiveReasons: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<RemovalRequestRepository>

    mockSettingChangeRepository = {
      findPage: jest.fn().mockResolvedValue({ data: [], pagination: {} }),
      findOldest: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<SettingChangeRepository>

    service = new WorkRulesService(mockConfigDomainService, mockRemovalRequestRepository, mockSettingChangeRepository)
  })

  test('howItWorks with FAIRNESS includes fairnessSentences with live weights and "Tips never affect who gets offers"', async () => {
    const result = await service.howItWorks()

    // 1. Candidate limit and distance
    expect(result.offers[0]).toBe(
      'Each order is offered among the 10 nearest free riders who are Online or on Last Call, within 20 km of the restaurant.'
    )

    // 2. The three weights
    expect(result.offers[1]).toContain('weight 50')
    expect(result.offers[1]).toContain('weight 30')
    expect(result.offers[1]).toContain('weight 20')
    expect(result.offers[1]).toContain('road time to the restaurant')
    expect(result.offers[1]).toContain('what the co-op has paid you per hour online today')
    expect(result.offers[1]).toContain('how long you have waited since your last job')

    // 3. Min online minutes, tips never count, midnight reset
    expect(result.offers[2]).toContain('Until you have been online 30 minutes today')
    expect(result.offers[2]).toContain('Tips never affect who gets offers, and the day starts again at midnight.')

    // 4. Spec 0049: this fixture has shifts on, so the shift sentence comes before the offer records one.
    expect(result.offers[3]).toContain('While shifts are on, being on a booked shift counts too (weight 0).')

    // 5. Offer records
    expect(result.offers[4]).toBe(
      'Each offer records the figures that chose its rider. See why a job came to you on its page in Earnings.'
    )
  })

  // Spec 0049 (cross check 5 and 6): the shift sentence is there only while shifts are on.
  describe('the shift sentence (spec 0049)', () => {
    const LINK_BACK =
      'Each offer records the figures that chose its rider. See why a job came to you on its page in Earnings.'

    function withSettings(overrides: Partial<InstanceConfigSettings>) {
      ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
        ...fairnessSettings,
        ...overrides,
      })
    }

    test('shifts off: no sentence mentions a shift, and the matching part is the four sentences of spec 0044', async () => {
      withSettings({ shiftsEnabled: false, fairnessWeightShift: 40 })

      const result = await service.howItWorks()

      expect(result.offers[3]).toBe(LINK_BACK)
      expect(result.offers.slice(0, 4).join(' ')).not.toMatch(/shift/i)
      expect(result.offers.join(' ')).not.toContain('being on a booked shift counts too')
      expect(
        fairnessSentences({ ...fairnessSettings, shiftsEnabled: false, fairnessWeightShift: 40 }, '20 km')
      ).toHaveLength(4)
    })

    test('shifts on: the sentence carries the saved weight, says it is a fixed yes or no, and that going Offline changes nothing', async () => {
      withSettings({ shiftsEnabled: true, fairnessWeightShift: 40 })

      const result = await service.howItWorks()

      const sentence = result.offers[3]!
      expect(sentence).toContain('being on a booked shift counts too (weight 40)')
      // Cross check 6: a fixed 0 or 1, so the same amount every time, unlike the other three.
      expect(sentence).toContain('It is a fixed yes or no, so it moves your place by the same amount every time')
      expect(sentence).toContain('while the other three depend on how different the riders are')
      expect(sentence).toContain('it changes nothing about your offers or pay')
      expect(result.offers[4]).toBe(LINK_BACK)
    })

    test('fairnessSentences with no shift settings at all (an older caller) words no shift', () => {
      const { shiftsEnabled, fairnessWeightShift, ...older } = fairnessSettings
      void shiftsEnabled
      void fairnessWeightShift
      const sentences = fairnessSentences(older, '20 km')
      expect(sentences).toHaveLength(4)
      expect(sentences.join(' ')).not.toMatch(/shift/i)
    })

    test('under another matcher, shifts on words no shift weight', async () => {
      withSettings({
        shiftsEnabled: true,
        fairnessWeightShift: 40,
        courierMatcherType: EnumCourierMatcherType.NEAREST_COURIER,
      })

      const result = await service.howItWorks()

      expect(result.offers.join(' ')).not.toContain('being on a booked shift counts too')
    })
  })

  // Spec 0045 (AC-4, decision 14.3): the matching part links back to the job's page in Earnings.
  test('howItWorks under FAIRNESS ends its matching part with the link back sentence (spec 0045 AC-4)', async () => {
    const result = await service.howItWorks()

    // The matching part is the fairness sentences, which open the offers list; its last one links back.
    const matchingPart = result.offers.slice(0, fairnessSentences(fairnessSettings, '20 km').length)
    // Five since spec 0049: this fixture has shifts on, which adds the shift sentence.
    expect(matchingPart).toHaveLength(5)
    const lastMatchingSentence = matchingPart[matchingPart.length - 1]!
    expect(lastMatchingSentence.endsWith('See why a job came to you on its page in Earnings.')).toBe(true)
    // The old sentence sent riders to a representative for this; the app now shows it to them.
    expect(result.offers.join(' ')).not.toContain('a representative can show you them for any of your offers')
  })

  // Review ruling 2026-11-21 (decision 14.5, AC-4): every matcher records why, so the link back follows
  // every matcher's text, not the fairness matcher's alone.
  describe('the link back sentence under every matcher (decision 14.5, AC-4)', () => {
    const LINK_BACK = 'See why a job came to you on its page in Earnings.'
    const NEXT_PART = 'A rider already on a job gets no second offer.'

    test.each([
      [EnumCourierMatcherType.NEAREST_COURIER, 'offered to the nearest free rider'],
      [EnumCourierMatcherType.COURIER_SENIORITY, 'whose account is the oldest'],
      [EnumCourierMatcherType.FAIRNESS, 'Each offer records the figures that chose its rider.'],
    ])('howItWorks under %s shows it once, after the matcher text', async (matcherType, matcherWords) => {
      ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
        ...fairnessSettings,
        courierMatcherType: matcherType,
      })

      const result = await service.howItWorks()

      // Once in the whole offers part...
      const withLink = result.offers.filter((sentence) => sentence.includes(LINK_BACK))
      expect(withLink).toHaveLength(1)
      // ...as the end of the matching part: after the matcher's own words, before the general offer rules.
      const linkAt = result.offers.findIndex((sentence) => sentence.endsWith(LINK_BACK))
      const matcherAt = result.offers.findIndex((sentence) => sentence.includes(matcherWords))
      const nextAt = result.offers.indexOf(NEXT_PART)
      expect(matcherAt).toBeGreaterThanOrEqual(0)
      expect(linkAt).toBeGreaterThanOrEqual(matcherAt)
      expect(nextAt).toBe(linkAt + 1)
    })

    test('under NEAREST_COURIER and COURIER_SENIORITY the matcher sentence itself is unchanged', async () => {
      for (const matcherType of [EnumCourierMatcherType.NEAREST_COURIER, EnumCourierMatcherType.COURIER_SENIORITY]) {
        ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
          ...fairnessSettings,
          courierMatcherType: matcherType,
        })
        const result = await service.howItWorks()
        expect(result.offers[0]).toMatch(/^Each order is offered to .* within 20 km of the restaurant\.$/)
        expect(result.offers[1]).toBe(LINK_BACK)
      }
    })
  })

  test('fairnessSentences ends with the link back sentence (spec 0045 AC-4)', () => {
    const sentences = fairnessSentences(fairnessSettings, '20 km')
    expect(sentences[sentences.length - 1]).toMatch(/See why a job came to you on its page in Earnings\.$/)
  })

  test('fairnessSentences updates dynamically when weights and limits change', () => {
    const customSettings = {
      fairnessWeightRoadTime: 60,
      fairnessWeightEarnings: 25,
      fairnessWeightWaiting: 15,
      fairnessCandidateLimit: 8,
      fairnessMinOnlineMinutes: 45,
    }

    const sentences = fairnessSentences(customSettings, '15 km')

    expect(sentences[0]).toContain('8 nearest free riders')
    expect(sentences[0]).toContain('within 15 km')
    expect(sentences[1]).toContain('weight 60')
    expect(sentences[1]).toContain('weight 25')
    expect(sentences[1]).toContain('weight 15')
    expect(sentences[2]).toContain('online 45 minutes today')
    expect(sentences[2]).toContain('Tips never affect who gets offers')
  })

  test('reworded APP_RECORDS explains that riders are compared only for each offer and no score is kept (decision 12.4)', async () => {
    const result = await service.howItWorks()

    // Check APP_RECORDS sentences
    const appRecordsJoined = result.appRecords.join(' ')
    expect(appRecordsJoined).toContain('by what the offer rules above say, never by behaviour')
    expect(appRecordsJoined).toContain('no running score about you')
    expect(appRecordsJoined).not.toContain('nothing is counted or ranked per rider')
  })

  test('howItWorks under NEAREST_COURIER does not claim riders are compared by pay per hour', async () => {
    ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValueOnce({
      ...fairnessSettings,
      courierMatcherType: EnumCourierMatcherType.NEAREST_COURIER,
    })

    const result = await service.howItWorks()
    const allSentences = [
      ...result.offers,
      ...result.personDecides,
      ...result.appRecords,
      ...result.timeWorked,
      ...result.earningsFigures,
    ].join(' ')

    expect(allSentences).not.toContain('Only the offer matcher compares today’s pay per hour')
    expect(allSentences).not.toContain('by road time, today’s pay per hour and waiting')
    expect(result.offers.join(' ')).not.toContain('pay per hour')
  })

  test('howItWorks under FAIRNESS does not claim the rider can see their own reasons in the app', async () => {
    const result = await service.howItWorks()
    const allSentences = [
      ...result.offers,
      ...result.personDecides,
      ...result.appRecords,
      ...result.timeWorked,
      ...result.earningsFigures,
    ].join(' ')

    expect(allSentences).not.toContain('you can see them for your own offers')
  })
})
