import { EnumDistanceUnit } from '@prisma/types'
import { EnumCourierDietaryRestrictions } from './courier'
import { EnumCourierCompensationCalculationType } from './courier-compensation-calculation'
import { EnumCourierMatcherType } from './courier-matching'
import { EnumDeliveryDurationCalculationType } from './delivery-duration'
import { EnumGeoCalculationType } from './geo-calculation'
import { EnumQuoteCalculationType } from './quote-calculation'
import { EnumCurrency } from './currency'
import { FeatureCollection, Polygon, MultiPolygon } from 'geojson'

export type InstanceConfigSettings = {
  courierMatcherType: EnumCourierMatcherType
  quoteCalculationType: EnumQuoteCalculationType
  geoCalculationType: EnumGeoCalculationType
  deliveryDurationCalculationType: EnumDeliveryDurationCalculationType
  courierCompensationCalculationType: EnumCourierCompensationCalculationType
  maxAssignmentDistance: number | null
  maxDriftDistance: number | null
  quoteExpirationMinutes: number | null
  feePercentageAmount: number | null
  // Price of one Config.distanceUnit of travel, in minor currency units (e.g. 150 = EUR 1.50
  // per kilometre when distanceUnit is KILOMETERS). A fairness parameter: it lives here, in
  // the Config table, so members can vote it — never in code.
  quoteRatePerDistanceUnit: number | null
  // Fixed part of every delivery's price, in whole cents (200 = EUR 2.00), paid to the rider in
  // full on top of the distance part. Set by the co-op like the rate above (spec 0001).
  quoteBaseFee: number | null
  defaultCourierPayRate: number | null
  defaultMaxWorkingHours: number | null
  defaultDietaryRestrictions: EnumCourierDietaryRestrictions | null
  distanceUnit: EnumDistanceUnit | null
  currency: EnumCurrency | null
  details: InstanceDetails
  updatedAt: string | null
  registeredRegistries: string[]
  reassignmentPayoutPolicies: Record<string, number>
  reassignmentPayoutDefaultPolicy: string
  // Offer expiry (spec 0002), set by co-op representatives. When on, the server ends an
  // automatic offer nobody answered after offerExpirySeconds and offers the delivery to the next
  // rider. noCourierRetrySeconds is how often a delivery nobody could take is matched again.
  offerExpiryEnabled: boolean
  offerExpirySeconds: number
  noCourierRetrySeconds: number
  // Offers timed to food readiness (spec 0031), set by co-op representatives. Off by default.
  offerTimingEnabled: boolean
  offerLeadMinutes: number
  offerTimingCandidates: number
  // Restaurant delay pay (spec 0033), set by co-op representatives.
  waitPayEnabled: boolean
  waitPayFreeMinutes: number
  waitPayCentsPerMinute: number
  waitLimitMinutes: number
  // Saved customers (spec 0005): one nobody has ordered for in this many months is deleted.
  savedCustomerRetentionMonths: number
  // Order history (spec 0017): a restaurant sees its ended orders from this many days back.
  restaurantHistoryDays: number
  sosLocationRetentionDays: number
  // The free hand back (spec 0020): seconds after accepting; 0 switches it off.
  handBackSeconds: number
  // Arrival detection (spec 0021): metres from a stop that count as arrived; 0 switches it off.
  arrivalRadiusMetres: number
  // Shifts (spec 0026): the co-op switch, and the hours before a shift's start it may still be dropped.
  shiftsEnabled: boolean
  shiftDropNoticeHours: number
  // The co-op's dispatch line riders call from the job screen (row 72); null when none is set.
  dispatchPhoneNumber: string | null
  // Spec 0015: the payout policy (a key of reassignmentPayoutPolicies) that pays a rider whose
  // job is cancelled after they accepted it. The stored key, or the fallback when none is stored.
  cancellationPayoutPolicy: string
}

export type InstanceDetails = {
  name: string
  link: string
  websocketLink: string
  region: FeatureCollection | Polygon | MultiPolygon | null
  imageUrl: string
  rulesUrl: string
  rulesContent: string
  descriptionUrl: string
  descriptionContent: string
  termsOfServiceUrl: string
  termsOfServiceContent: string
  privacyPolicyUrl: string
  privacyPolicyContent: string
}

export type InstanceCourierDefaults = {
  defaultCourierPayRate: number | null
  defaultMaxWorkingHours: number | null
  defaultDietaryRestrictions: EnumCourierDietaryRestrictions | null
}

export type InstanceConfigSettingOptions = {
  courierMatcherType: EnumCourierMatcherType[]
  quoteCalculationType: EnumQuoteCalculationType[]
  geoCalculationType: EnumGeoCalculationType[]
  deliveryDurationCalculationType: EnumDeliveryDurationCalculationType[]
  courierCompensationCalculationType: EnumCourierCompensationCalculationType[]
  defaultDietaryRestrictions: EnumCourierDietaryRestrictions[]
  distanceUnit: EnumDistanceUnit[]
  currency: EnumCurrency[]
}

export enum ConfigKey {
  COURIER_APP_MIN_VERSION = 'courierAppMinVersion',
  PARTNER_APP_MIN_VERSION = 'partnerAppMinVersion',
  COURIER_MATCHER_TYPE = 'courierMatcherType',
  QUOTE_CALCULATION_TYPE = 'quoteCalculationType',
  QUOTE_RATE_PER_DISTANCE_UNIT = 'quoteRatePerDistanceUnit',
  QUOTE_BASE_FEE = 'quoteBaseFee',
  QUOTE_TO_DELIVERY_CONVERSION_TYPE = 'quoteToDeliveryConversionType',
  DELIVERY_DURATION_CALCULATION_TYPE = 'deliveryDurationCalculationType',
  GEO_CALCULATION_TYPE = 'geoCalculationType',
  COURIER_COMPENSATION_CALCULATION_TYPE = 'courierCompensationCalculationType',
  FEE_PERCENTAGE_AMOUNT = 'feePercentageAmount',
  MAX_ASSIGNMENT_DISTANCE = 'maxAssignmentDistance',
  QUOTE_EXPIRATION_MINUTES = 'quoteExpirationMinutes',
  DEFAULT_COURIER_PAY_RATE = 'defaultCourierPayRate',
  DEFAULT_MAX_WORKING_HOURS = 'defaultMaxWorkingHours',
  DEFAULT_DIETARY_RESTRICTIONS = 'defaultDietaryRestrictions',
  DISTANCE_UNIT = 'distanceUnit',
  CURRENCY = 'currency',
  MAX_DRIFT_DISTANCE = 'maxDriftDistance',
  DETAILS = 'details',
  UPDATED_AT = 'updatedAt',
  REGISTERED_REGISTRIES = 'registeredRegistries',
  REASSIGNMENT_PAYOUT_POLICIES = 'reassignmentPayoutPolicies',
  REASSIGNMENT_PAYOUT_DEFAULT_POLICY = 'reassignmentPayoutDefaultPolicy',
  OFFER_EXPIRY_ENABLED = 'offerExpiryEnabled',
  OFFER_EXPIRY_SECONDS = 'offerExpirySeconds',
  NO_COURIER_RETRY_SECONDS = 'noCourierRetrySeconds',
  OFFER_TIMING_ENABLED = 'offerTimingEnabled',
  OFFER_LEAD_MINUTES = 'offerLeadMinutes',
  OFFER_TIMING_CANDIDATES = 'offerTimingCandidates',
  WAIT_PAY_ENABLED = 'waitPayEnabled',
  WAIT_PAY_FREE_MINUTES = 'waitPayFreeMinutes',
  WAIT_PAY_CENTS_PER_MINUTE = 'waitPayCentsPerMinute',
  WAIT_LIMIT_MINUTES = 'waitLimitMinutes',
  SAVED_CUSTOMER_RETENTION_MONTHS = 'savedCustomerRetentionMonths',
  RESTAURANT_HISTORY_DAYS = 'restaurantHistoryDays',
  HAND_BACK_SECONDS = 'handBackSeconds',
  SOS_LOCATION_RETENTION_DAYS = 'sosLocationRetentionDays',
  ARRIVAL_RADIUS_METRES = 'arrivalRadiusMetres',
  SHIFTS_ENABLED = 'shiftsEnabled',
  SHIFT_DROP_NOTICE_HOURS = 'shiftDropNoticeHours',
  DISPATCH_PHONE_NUMBER = 'dispatchPhoneNumber',
  CANCELLATION_PAYOUT_POLICY = 'cancellationPayoutPolicy',
}

// Fallbacks used ONLY when the Config row is missing (same role as DEFAULT_CURRENCY).
// The operative, member-votable values live in the Config table.
// Policy values are percentage of totalCompensation (piece-rate):
// FULL_COMPENSATION = 100% (worker-centered default), HALF_COMPENSATION = 50%, NO_COMPENSATION = 0%.
// Tips are excluded as they stay with whoever completes the delivery.
export const FALLBACK_REASSIGNMENT_PAYOUT_POLICIES: Record<string, number> = {
  FULL_COMPENSATION: 100,
  HALF_COMPENSATION: 50,
  NO_COMPENSATION: 0,
}
export const FALLBACK_REASSIGNMENT_PAYOUT_DEFAULT_POLICY = 'FULL_COMPENSATION'
// Spec 0015: a cancelled job pays in full until the co-op votes otherwise (value 4).
export const FALLBACK_CANCELLATION_PAYOUT_POLICY = 'FULL_COMPENSATION'

export type ConfigMap = {
  [key in ConfigKey]?: string | number | boolean | null | InstanceDetails | string[]
}
