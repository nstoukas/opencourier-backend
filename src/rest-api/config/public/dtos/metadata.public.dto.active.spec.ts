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
})
