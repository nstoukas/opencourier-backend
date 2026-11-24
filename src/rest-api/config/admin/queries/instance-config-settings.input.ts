import { BoxSize } from '@prisma/types'
import { ChatPreset } from 'src/shared-types/config'
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
  EnumTwoOrderPolicy,
  EnumAddOnMoment,
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
  feePercentageCeiling?: number
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
  stackingEnabled?: boolean
  twoOrderPolicy?: EnumTwoOrderPolicy
  twoOrderDelayLimitMinutes?: number
  addOnOffersEnabled?: boolean
  addOnMoment?: EnumAddOnMoment
  waitPayEnabled?: boolean
  waitPayFreeMinutes?: number
  shiftBreakMinutes?: number
  waitPayCentsPerMinute?: number
  waitLimitMinutes?: number
  splitAnswerMinutes?: number
  returnTripPayPercent?: number
  boxUnitsSmall?: number
  boxUnitsMedium?: number
  boxUnitsLarge?: number
  boxDefaultSize?: BoxSize
  fairnessWeightRoadTime?: number
  fairnessWeightEarnings?: number
  fairnessWeightWaiting?: number
  fairnessWeightShift?: number
  fairnessCandidateLimit?: number
  fairnessMinOnlineMinutes?: number
  savedCustomerRetentionMonths?: number
  restaurantHistoryDays?: number
  handBackSeconds?: number
  offerSkipMinutes?: number
  sosLocationRetentionDays?: number
  arrivalRadiusMetres?: number
  shiftsEnabled?: boolean
  shiftDropNoticeHours?: number
  dispatchPhoneNumber?: string
  cancellationPayoutPolicy?: string
  chatQuickRepliesDispatch?: (ChatPreset | string)[]
  chatQuickRepliesCourier?: (ChatPreset | string)[]
  chatRetentionDays?: number
  addressNoteRetentionDays?: number
  reviewAnswerDays?: number
  reviewCorrectionMaxCents?: number
}
