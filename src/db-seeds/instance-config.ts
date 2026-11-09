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
import {
  DEFAULT_NO_COURIER_RETRY_SECONDS,
  DEFAULT_OFFER_EXPIRY_ENABLED,
  DEFAULT_OFFER_LEAD_MINUTES,
  DEFAULT_OFFER_TIMING_CANDIDATES,
  DEFAULT_OFFER_TIMING_ENABLED,
  DEFAULT_OFFER_EXPIRY_SECONDS,
  DEFAULT_SAVED_CUSTOMER_RETENTION_MONTHS,
  DEFAULT_RESTAURANT_HISTORY_DAYS,
  DEFAULT_HAND_BACK_SECONDS,
  DEFAULT_SOS_LOCATION_RETENTION_DAYS,
  DEFAULT_ARRIVAL_RADIUS_METRES,
  DEFAULT_SHIFTS_ENABLED,
  DEFAULT_SHIFT_DROP_NOTICE_HOURS,
} from 'src/constants'
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
    // Offer expiry ships off (spec 0002); a representative switches it on when the co-op decides.
    offerExpiryEnabled: DEFAULT_OFFER_EXPIRY_ENABLED,
    offerExpirySeconds: DEFAULT_OFFER_EXPIRY_SECONDS,
    noCourierRetrySeconds: DEFAULT_NO_COURIER_RETRY_SECONDS,
    offerTimingEnabled: DEFAULT_OFFER_TIMING_ENABLED,
    offerLeadMinutes: DEFAULT_OFFER_LEAD_MINUTES,
    offerTimingCandidates: DEFAULT_OFFER_TIMING_CANDIDATES,
    savedCustomerRetentionMonths: DEFAULT_SAVED_CUSTOMER_RETENTION_MONTHS,
    restaurantHistoryDays: DEFAULT_RESTAURANT_HISTORY_DAYS,
    handBackSeconds: DEFAULT_HAND_BACK_SECONDS,
    sosLocationRetentionDays: DEFAULT_SOS_LOCATION_RETENTION_DAYS,
    arrivalRadiusMetres: DEFAULT_ARRIVAL_RADIUS_METRES,
    // Shifts ship off (spec 0026); the assembly decides whether to run them.
    shiftsEnabled: DEFAULT_SHIFTS_ENABLED,
    shiftDropNoticeHours: DEFAULT_SHIFT_DROP_NOTICE_HOURS,
    // No dispatch line until a representative types one on Instance configuration (row 72).
    dispatchPhoneNumber: '',
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
