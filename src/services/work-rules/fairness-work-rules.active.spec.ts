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
    shiftBreakMinutes: 30,
    returnTripPayPercent: 100,
    chatQuickRepliesDispatch: ['Preset 1'],
    chatQuickRepliesCourier: ['Preset 2'],
    chatRetentionDays: 90,
    reviewAnswerDays: 14,
    reviewCorrectionMaxCents: 5000,
    boxUnitsSmall: 30,
    boxUnitsMedium: 50,
    boxUnitsLarge: 100,
    boxDefaultSize: 'MEDIUM',
    fairnessWeightRoadTime: 50,
    fairnessWeightEarnings: 30,
    fairnessWeightWaiting: 20,
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

    // 4. Offer records
    expect(result.offers[3]).toBe(
      'Each offer records the figures that chose its rider; a representative can show you them for any of your offers.'
    )
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
