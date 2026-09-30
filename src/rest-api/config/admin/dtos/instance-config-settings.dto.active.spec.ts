import { InstanceConfigSettingsDto } from './instance-config-settings.dto'
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

describe('InstanceConfigSettingsDto', () => {
  // Baseline valid config data fixture
  const baseConfigData: InstanceConfigSettings = {
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
  }

  it('preserves 0 for saved numeric settings instead of mapping 0 to null', () => {
    // Input data with zero values for numeric settings
    const dataWithZeros: InstanceConfigSettings = {
      ...baseConfigData,
      maxAssignmentDistance: 0,
      maxDriftDistance: 0,
      quoteExpirationMinutes: 0,
      feePercentageAmount: 0,
      quoteRatePerDistanceUnit: 0,
      quoteBaseFee: 0,
      defaultCourierPayRate: 0,
      defaultMaxWorkingHours: 0,
    }

    const dto = new InstanceConfigSettingsDto(dataWithZeros)

    // Using ?? null ensures zero is preserved as 0
    expect(dto.maxAssignmentDistance).toBe(0)
    expect(dto.maxDriftDistance).toBe(0)
    expect(dto.quoteExpirationMinutes).toBe(0)
    expect(dto.feePercentageAmount).toBe(0)
    expect(dto.quoteRatePerDistanceUnit).toBe(0)
    expect(dto.quoteBaseFee).toBe(0)
    expect(dto.defaultCourierPayRate).toBe(0)
    expect(dto.defaultMaxWorkingHours).toBe(0)
  })

  it('maps undefined or null numeric settings to null', () => {
    // Input data with null/undefined values for numeric settings
    const dataWithNulls: InstanceConfigSettings = {
      ...baseConfigData,
      maxAssignmentDistance: null,
      maxDriftDistance: null,
      quoteExpirationMinutes: null,
      feePercentageAmount: null,
      quoteRatePerDistanceUnit: null,
      quoteBaseFee: null,
      defaultCourierPayRate: null,
      defaultMaxWorkingHours: null,
    }

    const dto = new InstanceConfigSettingsDto(dataWithNulls)

    expect(dto.maxAssignmentDistance).toBeNull()
    expect(dto.maxDriftDistance).toBeNull()
    expect(dto.quoteExpirationMinutes).toBeNull()
    expect(dto.feePercentageAmount).toBeNull()
    expect(dto.quoteRatePerDistanceUnit).toBeNull()
    expect(dto.quoteBaseFee).toBeNull()
    expect(dto.defaultCourierPayRate).toBeNull()
    expect(dto.defaultMaxWorkingHours).toBeNull()
  })

  // AC-5: Verifies that InstanceConfigSettingsDto has no defaultMinimumCourierPay property
  it('has no defaultMinimumCourierPay property on dto (AC-5)', () => {
    const dto = new InstanceConfigSettingsDto(baseConfigData)
    expect((dto as any).defaultMinimumCourierPay).toBeUndefined()
  })
})
