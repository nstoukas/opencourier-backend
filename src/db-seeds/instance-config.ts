import { EnumDistanceUnit, PrismaClient } from '@prisma/types'
import {
  EnumCourierCompensationCalculationType,
  EnumCourierDietaryRestrictions,
  EnumCourierMatcherType,
  EnumDeliveryDurationCalculationType,
  EnumGeoCalculationType,
  EnumQuoteCalculationType,
  EnumQuoteToDeliveryConversionServiceType,
  FALLBACK_REASSIGNMENT_PAYOUT_POLICIES,
  FALLBACK_REASSIGNMENT_PAYOUT_DEFAULT_POLICY,
} from 'src/shared-types/index'
import { SEEDED_INSTANCE_CURRENCY } from './instance-currency'
import { SEEDED_QUOTE_RATE_PER_DISTANCE_UNIT, SEEDED_QUOTE_BASE_FEE } from './instance-pay-defaults'

export async function seedInitialInstanceConfig(prisma: PrismaClient) {
  const details = {
    name: '',
    link: '',
    websocketLink: '',
    region: null,
    imageUrl: '',
    rulesUrl: '',
    rulesContent: '',
    descriptionUrl: '',
    descriptionContent: '',
    termsOfServiceUrl: '',
    termsOfServiceContent: '',
    privacyPolicyUrl: '',
    privacyPolicyContent: '',
  }

  const initialConfigsData = {
    courierMatcherType: EnumCourierMatcherType.COURIER_SENIORITY,
    quoteCalculationType: EnumQuoteCalculationType.BY_DISTANCE,
    geoCalculationType: EnumGeoCalculationType.HAVERSINE,
    deliveryDurationCalculationType: EnumDeliveryDurationCalculationType.SIMPLE,
    courierCompensationCalculationType: EnumCourierCompensationCalculationType.FROM_QUOTE_FROM,
    maxAssignmentDistance: 100,
    maxDriftDistance: 0,
    quoteExpirationMinutes: 10,
    feePercentageAmount: 10,
    quoteRatePerDistanceUnit: SEEDED_QUOTE_RATE_PER_DISTANCE_UNIT,
    quoteBaseFee: SEEDED_QUOTE_BASE_FEE,
    defaultCourierPayRate: 1,
    defaultMaxWorkingHours: 8,
    defaultDietaryRestrictions: [EnumCourierDietaryRestrictions.NONE],
    distanceUnit: EnumDistanceUnit.KILOMETERS,
    currency: SEEDED_INSTANCE_CURRENCY,
    quoteToDeliveryConversionType: EnumQuoteToDeliveryConversionServiceType.SIMPLE,
    details,
    updatedAt: new Date().toISOString(),
    registeredRegistries: [],
    reassignmentPayoutPolicies: FALLBACK_REASSIGNMENT_PAYOUT_POLICIES,
    reassignmentPayoutDefaultPolicy: FALLBACK_REASSIGNMENT_PAYOUT_DEFAULT_POLICY,
  }

  for (const [key, value] of Object.entries(initialConfigsData)) {
    const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value)

    const existingConfig = await prisma.config.findUnique({
      where: {
        key,
      },
    })
    if (existingConfig) {
      console.log(`Config with key ${key} already exists. Skipping...`)
      continue
    }

    await prisma.config.create({
      data: {
        key,
        value: stringValue,
        type: typeof value,
      },
    })

    console.log(`Created config: ${key}, value: ${stringValue}`)
  }
}
