import {
  EnumCourierCompensationCalculationType,
  EnumCourierDietaryRestrictions,
  EnumCourierMatcherType,
  EnumCurrency,
  EnumDeliveryDurationCalculationType,
  EnumDistanceUnit,
  EnumGeoCalculationType,
  EnumQuoteCalculationType,
  InstanceDetails,
} from 'src/shared-types/index'

export class InstanceConfigSettingsInput {
  courierMatcherType?: EnumCourierMatcherType
  quoteCalculationType?: EnumQuoteCalculationType
  geoCalculationType?: EnumGeoCalculationType
  deliveryDurationCalculationType?: EnumDeliveryDurationCalculationType
  courierCompensationCalculationType?: EnumCourierCompensationCalculationType
  maxAssignmentDistance?: number
  quoteExpirationMinutes?: number
  feePercentageAmount?: number
  quoteRatePerDistanceUnit?: number
  quoteBaseFee?: number
  maxDriftDistance?: number
  defaultCourierPayRate?: number
  defaultMaxWorkingHours?: number
  defaultDietaryRestrictions?: EnumCourierDietaryRestrictions[]
  distanceUnit?: EnumDistanceUnit
  currency?: EnumCurrency
  details?: InstanceDetails
  registeredRegistries?: string[]
  reassignmentPayoutPolicies?: Record<string, number>
  reassignmentPayoutDefaultPolicy?: string
  offerExpiryEnabled?: boolean
  offerExpirySeconds?: number
  noCourierRetrySeconds?: number
  offerTimingEnabled?: boolean
  offerLeadMinutes?: number
  offerTimingCandidates?: number
  waitPayEnabled?: boolean
  waitPayFreeMinutes?: number
  waitPayCentsPerMinute?: number
  waitLimitMinutes?: number
  savedCustomerRetentionMonths?: number
  restaurantHistoryDays?: number
  handBackSeconds?: number
  sosLocationRetentionDays?: number
  arrivalRadiusMetres?: number
  shiftsEnabled?: boolean
  shiftDropNoticeHours?: number
  dispatchPhoneNumber?: string
  cancellationPayoutPolicy?: string
}
