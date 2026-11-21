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
  DEFAULT_WAIT_LIMIT_MINUTES,
  DEFAULT_RETURN_TRIP_PAY_PERCENT,
  DEFAULT_BOX_UNITS_SMALL,
  DEFAULT_BOX_UNITS_MEDIUM,
  DEFAULT_BOX_UNITS_LARGE,
  DEFAULT_BOX_DEFAULT_SIZE,
  DEFAULT_FAIRNESS_WEIGHT_ROAD_TIME,
  DEFAULT_FAIRNESS_WEIGHT_EARNINGS,
  DEFAULT_FAIRNESS_WEIGHT_WAITING,
  DEFAULT_FAIRNESS_WEIGHT_SHIFT,
  DEFAULT_FAIRNESS_CANDIDATE_LIMIT,
  DEFAULT_FAIRNESS_MIN_ONLINE_MINUTES,
  DEFAULT_WAIT_PAY_CENTS_PER_MINUTE,
  DEFAULT_WAIT_PAY_ENABLED,
  DEFAULT_WAIT_PAY_FREE_MINUTES,
  DEFAULT_SHIFT_BREAK_MINUTES,
  DEFAULT_FEE_PERCENTAGE_CEILING,
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
  DEFAULT_CHAT_QUICK_REPLIES_DISPATCH,
  DEFAULT_CHAT_QUICK_REPLIES_COURIER,
  DEFAULT_CHAT_RETENTION_DAYS,
  DEFAULT_REVIEW_ANSWER_DAYS,
  DEFAULT_REVIEW_CORRECTION_MAX_CENTS,
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
    // Spec 0044 (AC-7): fairness is the default matcher (operator decision, 2026-11-20).
    courierMatcherType: EnumCourierMatcherType.FAIRNESS,
    quoteCalculationType: EnumQuoteCalculationType.BY_DISTANCE,
    geoCalculationType: EnumGeoCalculationType.HAVERSINE,
    deliveryDurationCalculationType: EnumDeliveryDurationCalculationType.SIMPLE,
    courierCompensationCalculationType: EnumCourierCompensationCalculationType.FROM_QUOTE_FROM,
    maxAssignmentDistance: 100,
    maxDriftDistance: 0,
    quoteExpirationMinutes: 10,
    feePercentageAmount: 10,
    feePercentageCeiling: DEFAULT_FEE_PERCENTAGE_CEILING,
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
    waitPayEnabled: DEFAULT_WAIT_PAY_ENABLED,
    waitPayFreeMinutes: DEFAULT_WAIT_PAY_FREE_MINUTES,
    shiftBreakMinutes: DEFAULT_SHIFT_BREAK_MINUTES,
    waitPayCentsPerMinute: DEFAULT_WAIT_PAY_CENTS_PER_MINUTE,
    waitLimitMinutes: DEFAULT_WAIT_LIMIT_MINUTES,
    returnTripPayPercent: DEFAULT_RETURN_TRIP_PAY_PERCENT,
    // Spec 0043: placeholders until the field study (row 7).
    boxUnitsSmall: DEFAULT_BOX_UNITS_SMALL,
    boxUnitsMedium: DEFAULT_BOX_UNITS_MEDIUM,
    boxUnitsLarge: DEFAULT_BOX_UNITS_LARGE,
    boxDefaultSize: DEFAULT_BOX_DEFAULT_SIZE,
    // Spec 0044: the operator's starting weights (2026-11-20).
    fairnessWeightRoadTime: DEFAULT_FAIRNESS_WEIGHT_ROAD_TIME,
    fairnessWeightEarnings: DEFAULT_FAIRNESS_WEIGHT_EARNINGS,
    fairnessWeightWaiting: DEFAULT_FAIRNESS_WEIGHT_WAITING,
    fairnessWeightShift: DEFAULT_FAIRNESS_WEIGHT_SHIFT,
    fairnessCandidateLimit: DEFAULT_FAIRNESS_CANDIDATE_LIMIT,
    fairnessMinOnlineMinutes: DEFAULT_FAIRNESS_MIN_ONLINE_MINUTES,
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
    // Chat (spec 0034): the presets and how long messages are kept.
    chatQuickRepliesDispatch: DEFAULT_CHAT_QUICK_REPLIES_DISPATCH,
    chatQuickRepliesCourier: DEFAULT_CHAT_QUICK_REPLIES_COURIER,
    chatRetentionDays: DEFAULT_CHAT_RETENTION_DAYS,
    // Review requests (spec 0038): the days to answer, and the largest pay correction in cents.
    reviewAnswerDays: DEFAULT_REVIEW_ANSWER_DAYS,
    reviewCorrectionMaxCents: DEFAULT_REVIEW_CORRECTION_MAX_CENTS,
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
