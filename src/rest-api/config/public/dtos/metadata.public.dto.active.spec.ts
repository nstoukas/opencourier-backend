import { MetadataPublicDto } from './metadata.public.dto'
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

describe('MetadataPublicDto (AC-5 & AC-6)', () => {
  const baseData: InstanceConfigSettings = {
    courierMatcherType: EnumCourierMatcherType.STATIC,
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
    quoteRatePerDistanceUnit: 150,
    quoteBaseFee: 200,
    defaultCourierPayRate: 300,
    defaultMaxWorkingHours: 8,
    details: {} as InstanceDetails,
    updatedAt: '2026-09-30T12:00:00.000Z',
    registeredRegistries: [],
    reassignmentPayoutPolicies: { FULL: 100 },
    reassignmentPayoutDefaultPolicy: 'FULL',
    offerExpiryEnabled: false,
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
    shiftsEnabled: false,
    shiftDropNoticeHours: 12,
    dispatchPhoneNumber: null,
    cancellationPayoutPolicy: 'FULL_COMPENSATION',
    waitPayEnabled: false,
    waitPayFreeMinutes: 5,
    waitPayCentsPerMinute: 10,
    waitLimitMinutes: 10,
  }

  // AC-6: The public instance metadata shows quoteBaseFee and quoteRatePerDistanceUnit, including 0 as 0
  it('carries quoteBaseFee and quoteRatePerDistanceUnit, including 0 as 0 (AC-6)', () => {
    const dto = new MetadataPublicDto(baseData)
    expect(dto.config.quoteBaseFee).toBe(200)
    expect(dto.config.quoteRatePerDistanceUnit).toBe(150)

    const dtoZero = new MetadataPublicDto({
      ...baseData,
      quoteBaseFee: 0,
      quoteRatePerDistanceUnit: 0,
    })
    expect(dtoZero.config.quoteBaseFee).toBe(0)
    expect(dtoZero.config.quoteRatePerDistanceUnit).toBe(0)
  })

  // AC-5: defaultMinimumCourierPay no longer exists on public metadata
  it('has no defaultMinimumCourierPay on config DTO (AC-5)', () => {
    const dto = new MetadataPublicDto(baseData)
    expect((dto.config as any).defaultMinimumCourierPay).toBeUndefined()
  })

  // Spec 0002, AC-10: public metadata exposes offer expiry settings
  it('exposes offerExpiryEnabled, offerExpirySeconds, and noCourierRetrySeconds on public metadata (AC-10)', () => {
    const dto = new MetadataPublicDto(baseData)
    expect(dto.config.offerExpiryEnabled).toBe(false)
    expect(dto.config.offerExpirySeconds).toBe(60)
    expect(dto.config.noCourierRetrySeconds).toBe(30)
  })

  // Spec 0005, AC-7: public metadata exposes savedCustomerRetentionMonths
  it('exposes savedCustomerRetentionMonths on public metadata (AC-7)', () => {
    const dto = new MetadataPublicDto(baseData)
    expect(dto.config.savedCustomerRetentionMonths).toBe(12)
  })

  // Row 72, decision 72.2: The dispatch line is for riders, not public metadata
  it('does NOT include dispatchPhoneNumber on public metadata even when settings hold one (row 72, decision 72.2)', () => {
    const dtoWithPhone = new MetadataPublicDto({
      ...baseData,
      dispatchPhoneNumber: '+302421012345',
    })
    expect((dtoWithPhone as any).dispatchPhoneNumber).toBeUndefined()
    expect((dtoWithPhone.config as any).dispatchPhoneNumber).toBeUndefined()
  })

  // Spec 0017, decision 28.7: restaurantHistoryDays is not added to public metadata
  it('does NOT include restaurantHistoryDays on public metadata (decision 28.7)', () => {
    const dto = new MetadataPublicDto(baseData)
    expect((dto as any).restaurantHistoryDays).toBeUndefined()
    expect((dto.config as any).restaurantHistoryDays).toBeUndefined()
  })

  // Spec 0021, AC-11: arrivalRadiusMetres is for riders, not public metadata
  it('does NOT include arrivalRadiusMetres on public metadata (spec 0021 AC-11)', () => {
    const dto = new MetadataPublicDto(baseData)
    expect((dto as any).arrivalRadiusMetres).toBeUndefined()
    expect((dto.config as any).arrivalRadiusMetres).toBeUndefined()
  })

  // Spec 0022, AC-11: sosLocationRetentionDays is an admin setting, not on public metadata
  it('does NOT include sosLocationRetentionDays on public metadata (spec 0022 AC-11)', () => {
    const dto = new MetadataPublicDto(baseData)
    expect((dto as any).sosLocationRetentionDays).toBeUndefined()
    expect((dto.config as any).sosLocationRetentionDays).toBeUndefined()
  })

  // Spec 0026 (precisions): neither shift setting is public; row 78 adds the rider's read through
  // courier GET config/contact.
  it('does NOT include shiftsEnabled or shiftDropNoticeHours on public metadata (spec 0026)', () => {
    const dto = new MetadataPublicDto({ ...baseData, shiftsEnabled: true, shiftDropNoticeHours: 48 })
    for (const key of ['shiftsEnabled', 'shiftDropNoticeHours']) {
      expect((dto as any)[key]).toBeUndefined()
      expect((dto.config as any)[key]).toBeUndefined()
    }
    expect(JSON.stringify(dto)).not.toMatch(/shift/i)
  })
})
