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
import { WorkRulesService } from './work-rules.service'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { RemovalRequestRepository } from 'src/persistence/repositories/removal-request.repository'
import { SettingChangeRepository } from 'src/persistence/repositories/setting-change.repository'
import {
  RIDER_FACING_SETTINGS,
  RIDER_FACING_SETTING_KEYS,
  formatCents,
  policyName,
} from 'src/shared-types/rider-facing-settings'

describe('WorkRulesService (spec 0038, AC-11, AC-13)', () => {
  let service: WorkRulesService
  let mockConfigDomainService: jest.Mocked<ConfigDomainService>
  let mockRemovalRequestRepository: jest.Mocked<RemovalRequestRepository>
  let mockSettingChangeRepository: jest.Mocked<SettingChangeRepository>

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
    updatedAt: '2026-11-19T10:00:00.000Z',
    registeredRegistries: [],
    reassignmentPayoutPolicies: { FULL_COMPENSATION: 100, HALF_COMPENSATION: 50 },
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
  }

  beforeEach(() => {
    mockConfigDomainService = {
      instanceConfig: {
        getInstanceConfigSettings: jest.fn().mockResolvedValue(baseSettings),
      },
    } as unknown as jest.Mocked<ConfigDomainService>

    mockRemovalRequestRepository = {
      findActiveReasons: jest.fn().mockResolvedValue([
        { label: 'Moped breakdown', paidToRider: true },
        { label: 'Customer absent', paidToRider: false },
      ]),
    } as unknown as jest.Mocked<RemovalRequestRepository>

    mockSettingChangeRepository = {
      findPage: jest.fn().mockResolvedValue({ data: [], pagination: {} }),
      findOldest: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<SettingChangeRepository>

    service = new WorkRulesService(
      mockConfigDomainService,
      mockRemovalRequestRepository,
      mockSettingChangeRepository
    )
  })

  describe('howItWorks (AC-11)', () => {
    it('builds explanation page with today numbers from live settings', async () => {
      const result = await service.howItWorks()

      // Offers section
      expect(result.offers[0]).toContain('nearest free rider')
      expect(result.offers[0]).toContain('20 km')
      expect(result.offers).toContain('A rider already on a job gets no second offer.')
      expect(result.offers).toContain('You have 60 seconds to answer an offer; then it goes to the next rider.')
      expect(result.offers).toContain('If you decline or miss an offer, that order is not offered to you again for 20 minutes.')

      // Pay section
      expect(result.pay[0]).toContain('base of €2.00 plus €1.50 per km')
      expect(result.pay.some((line) => line.includes('first 5 minutes are not paid, then each minute pays €0.10'))).toBe(true)
      expect(result.pay.some((line) => line.includes('leave a restaurant that is 10 minutes late'))).toBe(true)
      expect(result.pay.some((line) => line.includes('Being taken off an order pays you for these reasons: Moped breakdown'))).toBe(true)
      expect(result.pay.some((line) => line.includes('These reasons do not pay: Customer absent'))).toBe(true)
      expect(result.pay.some((line) => line.includes('add up to €50.00. A review never lowers your pay'))).toBe(true)

      // Fixed sections
      expect(result.personDecides).toBeDefined()
      expect(result.appRecords).toBeDefined()
      expect(result.reviewAnswerDays).toBe(14)
    })

    it('updates matcher sentence when courierMatcherType is COURIER_SENIORITY', async () => {
      ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
        ...baseSettings,
        courierMatcherType: EnumCourierMatcherType.COURIER_SENIORITY,
      })

      const result = await service.howItWorks()
      expect(result.offers[0]).toContain('whose account is the oldest')
    })

    it('updates matcher sentence when courierMatcherType is STATIC', async () => {
      ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
        ...baseSettings,
        courierMatcherType: EnumCourierMatcherType.STATIC,
      })

      const result = await service.howItWorks()
      expect(result.offers[0]).toBe('Dispatch chooses the rider for each order by hand.')
    })

    it('includes timed offer sentence when offerTimingEnabled is true', async () => {
      ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
        ...baseSettings,
        offerTimingEnabled: true,
        offerLeadMinutes: 4,
      })

      const result = await service.howItWorks()
      expect(result.offers.some((line) => line.includes('about 4 minutes before'))).toBe(true)
    })

    it('reflects dynamic offerExpirySeconds (45s), pay values, and courierMatcherType in sentences (AC-11)', async () => {
      // 1. offerExpirySeconds: 45 with expiry on, quoteBaseFee: 350 (€3.50), NEAREST_COURIER
      ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
        ...baseSettings,
        offerExpiryEnabled: true,
        offerExpirySeconds: 45,
        quoteBaseFee: 350,
        courierMatcherType: EnumCourierMatcherType.NEAREST_COURIER,
      })

      let result = await service.howItWorks()
      expect(result.offers.some((line) => line.includes('45 seconds'))).toBe(true)
      expect(result.pay.some((line) => line.includes('base of €3.50'))).toBe(true)
      expect(result.offers[0]).toContain('nearest free rider')

      // 2. Switch courierMatcherType to COURIER_SENIORITY
      ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
        ...baseSettings,
        offerExpiryEnabled: true,
        offerExpirySeconds: 45,
        courierMatcherType: EnumCourierMatcherType.COURIER_SENIORITY,
      })
      result = await service.howItWorks()
      expect(result.offers.some((line) => line.includes('45 seconds'))).toBe(true)
      expect(result.offers[0]).toContain('whose account is the oldest')

      // 3. Switch courierMatcherType to STATIC
      ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
        ...baseSettings,
        offerExpiryEnabled: true,
        offerExpirySeconds: 45,
        courierMatcherType: EnumCourierMatcherType.STATIC,
      })
      result = await service.howItWorks()
      expect(result.offers.some((line) => line.includes('45 seconds'))).toBe(true)
      expect(result.offers[0]).toBe('Dispatch chooses the rider for each order by hand.')
    })
  })

  describe('riderChanges (AC-13)', () => {
    it('queries only rider-facing keys and formats changes without naming persons', async () => {
      mockSettingChangeRepository.findPage.mockResolvedValue({
        data: [
          {
            id: 'change-1',
            key: 'waitPayFreeMinutes',
            oldValue: 5,
            newValue: 10,
            createdAt: new Date('2026-11-19T08:00:00Z'),
            changedBy: { id: 'admin-1', email: 'admin@coop.gr', username: 'admin' },
          } as any,
          {
            id: 'change-2',
            key: 'removalReason',
            oldValue: null,
            newValue: { label: 'Severe weather', paidToRider: true },
            createdAt: new Date('2026-11-19T09:00:00Z'),
            changedBy: { id: 'admin-1', email: 'admin@coop.gr', username: 'admin' },
          } as any,
        ],
        pagination: { totalPages: 1 } as any,
      })

      const result = await service.riderChanges({ page: 1, perPage: 20 })

      expect(mockSettingChangeRepository.findPage).toHaveBeenCalledWith({
        keys: RIDER_FACING_SETTING_KEYS,
        page: 1,
        perPage: 20,
      })

      expect(result.data).toHaveLength(2)
      // Line 1
      expect(result.data[0]?.label).toBe('Unpaid minutes of waiting')
      expect(result.data[0]?.oldText).toBe('5 minutes')
      expect(result.data[0]?.newText).toBe('10 minutes')
      // No person name on rider DTO
      expect((result.data[0] as any).changedBy).toBeUndefined()

      // Line 2
      expect(result.data[1]?.label).toBe('Reason to be taken off an order')
      expect(result.data[1]?.newText).toBe('Severe weather, pays the rider')
    })

    it('a SettingChange of reassignmentPayoutPolicies where only one percentage moved appears in rider changes list (AC-13)', async () => {
      mockSettingChangeRepository.findPage.mockResolvedValue({
        data: [
          {
            id: 'change-policy-1',
            key: 'reassignmentPayoutPolicies',
            oldValue: { FULL_COMPENSATION: 100, HALF_COMPENSATION: 50 },
            newValue: { FULL_COMPENSATION: 100, HALF_COMPENSATION: 25 },
            createdAt: new Date('2026-11-19T09:30:00Z'),
            changedBy: { id: 'admin-1', email: 'admin@coop.gr', username: 'admin' },
          } as any,
        ],
        pagination: { totalPages: 1 } as any,
      })

      const result = await service.riderChanges({ page: 1, perPage: 20 })

      expect(result.data).toHaveLength(1)
      expect(result.data[0]?.label).toBe('Pay rules for a job taken off you')
      expect(result.data[0]?.oldText).toBe('full compensation 100%, half compensation 50%')
      expect(result.data[0]?.newText).toBe('full compensation 100%, half compensation 25%')
    })
  })

  describe('adminChanges (AC-13)', () => {
    it('queries all changes including admin-only settings with the admin identity', async () => {
      const recordedSince = new Date('2026-11-18T00:00:00Z')
      mockSettingChangeRepository.findOldest.mockResolvedValue({ createdAt: recordedSince } as any)
      mockSettingChangeRepository.findPage.mockResolvedValue({
        data: [
          {
            id: 'change-admin-1',
            key: 'chatRetentionDays',
            subject: null,
            oldValue: 90,
            newValue: 60,
            createdAt: new Date('2026-11-19T08:30:00Z'),
            changedBy: { id: 'admin-1', email: 'nikos@coop.gr', username: 'nikos' },
          } as any,
        ],
        pagination: { totalPages: 1 } as any,
      })

      const result = await service.adminChanges({ page: 1, perPage: 20 })

      expect(mockSettingChangeRepository.findPage).toHaveBeenCalledWith({
        page: 1,
        perPage: 20,
      })
      expect(result.recordedSince).toBe(recordedSince)
      expect(result.data[0]?.key).toBe('chatRetentionDays')
      expect(result.data[0]?.changedBy).toBe('nikos@coop.gr')
    })
  })

  describe('RIDER_FACING_SETTINGS completeness (AC-13)', () => {
    it('every rider facing key has a non-empty label and a working formatter', () => {
      const context = { distanceUnit: 'KILOMETERS', currency: 'EUR' }

      for (const key of RIDER_FACING_SETTING_KEYS) {
        const setting = RIDER_FACING_SETTINGS[key]
        expect(setting).toBeDefined()
        expect(typeof setting?.label).toBe('string')
        expect(setting?.label.length).toBeGreaterThan(0)
        expect(typeof setting?.format).toBe('function')

        // Must format without throwing for null, undefined, empty, number, boolean, or object
        expect(() => setting?.format(null, context)).not.toThrow()
        expect(() => setting?.format(undefined, context)).not.toThrow()
      }
    })

    it('formats offerTimingCandidates number as "<n> riders" (AC-13)', () => {
      const context = { distanceUnit: 'KILOMETERS', currency: 'EUR' }
      const format = RIDER_FACING_SETTINGS.offerTimingCandidates!.format
      expect(format(5, context)).toBe('5 riders')
      expect(format(1, context)).toBe('1 riders')
      expect(format(0, context)).toBe('0 riders')
      expect(format(null, context)).toBe('not set')
    })

    it('formats reassignmentPayoutPolicies as each policy with its percentage (AC-13)', () => {
      const context = { distanceUnit: 'KILOMETERS', currency: 'EUR' }
      const format = RIDER_FACING_SETTINGS.reassignmentPayoutPolicies!.format
      expect(format({ FULL_COMPENSATION: 100, HALF_COMPENSATION: 50 }, context)).toBe(
        'full compensation 100%, half compensation 50%'
      )
      expect(format({ FULL_COMPENSATION: 100, HALF_COMPENSATION: 25 }, context)).toBe(
        'full compensation 100%, half compensation 25%'
      )
      expect(format({}, context)).toBe('none')
      expect(format(null, context)).toBe('not set')
    })
  })
})
