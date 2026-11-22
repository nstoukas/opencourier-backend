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
  EnumTwoOrderPolicy,
  EnumAddOnMoment,
  InstanceConfigSettings,
  InstanceDetails,
} from 'src/shared-types/index'
import { ApiProperty } from '@nestjs/swagger'

export class InstanceConfigSettingsDto {
  @ApiProperty({ enum: EnumCourierMatcherType })
  courierMatcherType: EnumCourierMatcherType

  @ApiProperty({ enum: EnumQuoteCalculationType })
  quoteCalculationType: EnumQuoteCalculationType

  @ApiProperty({ enum: EnumGeoCalculationType })
  geoCalculationType: EnumGeoCalculationType

  @ApiProperty({ enum: EnumDeliveryDurationCalculationType })
  deliveryDurationCalculationType: EnumDeliveryDurationCalculationType

  @ApiProperty({ enum: EnumCourierCompensationCalculationType })
  courierCompensationCalculationType: EnumCourierCompensationCalculationType

  @ApiProperty({ enum: EnumCourierDietaryRestrictions, nullable: true })
  defaultDietaryRestrictions: EnumCourierDietaryRestrictions | null

  @ApiProperty({ enum: EnumDistanceUnit })
  distanceUnit: EnumDistanceUnit

  @ApiProperty({ enum: EnumCurrency })
  currency: EnumCurrency

  @ApiProperty({ type: Number, nullable: true })
  maxAssignmentDistance: number | null

  @ApiProperty({ type: Number, nullable: true })
  maxDriftDistance: number | null

  @ApiProperty({ type: Number, nullable: true })
  quoteExpirationMinutes: number | null

  @ApiProperty({ type: Number, nullable: true })
  feePercentageAmount: number | null

  // Spec 0041: the highest fee % a save accepts.
  @ApiProperty({ type: Number })
  feePercentageCeiling: number

  @ApiProperty({ type: Number, nullable: true })
  quoteRatePerDistanceUnit: number | null

  @ApiProperty({ type: Number, nullable: true })
  quoteBaseFee: number | null

  @ApiProperty({ type: Number, nullable: true })
  defaultCourierPayRate: number | null

  @ApiProperty({ type: Number, nullable: true })
  defaultMaxWorkingHours: number | null

  @ApiProperty({ type: Object, nullable: true })
  details: InstanceDetails | null

  @ApiProperty({ type: String, nullable: true })
  updatedAt: string | null

  @ApiProperty({ type: String, isArray: true, nullable: true })
  registeredRegistries: string[]

  @ApiProperty({ type: Object, nullable: true })
  reassignmentPayoutPolicies: Record<string, number>

  @ApiProperty({ type: String, nullable: true })
  reassignmentPayoutDefaultPolicy: string

  @ApiProperty({ type: Boolean })
  offerExpiryEnabled: boolean

  @ApiProperty({ type: Number })
  offerExpirySeconds: number

  @ApiProperty({ type: Number })
  noCourierRetrySeconds: number

  @ApiProperty({ type: Boolean })
  offerTimingEnabled: boolean

  @ApiProperty({ type: Number })
  offerLeadMinutes: number

  @ApiProperty({ type: Number })
  offerTimingCandidates: number

  // Stacked orders (spec 0048, AC-1).
  @ApiProperty({ type: Boolean })
  stackingEnabled: boolean

  @ApiProperty({ enum: EnumTwoOrderPolicy })
  twoOrderPolicy: EnumTwoOrderPolicy

  @ApiProperty({ type: Number })
  twoOrderDelayLimitMinutes: number

  // Mid job add ons (spec 0048, AC-1, row 81).
  @ApiProperty({ type: Boolean })
  addOnOffersEnabled: boolean

  @ApiProperty({ enum: EnumAddOnMoment })
  addOnMoment: EnumAddOnMoment

  @ApiProperty({ type: Boolean })
  waitPayEnabled: boolean

  @ApiProperty({ type: Number })
  waitPayFreeMinutes: number

  @ApiProperty({ type: Number })
  shiftBreakMinutes: number

  @ApiProperty({ type: Number })
  waitPayCentsPerMinute: number

  @ApiProperty({ type: Number })
  waitLimitMinutes: number

  // Spec 0047 (AC-2).
  @ApiProperty({ type: Number })
  splitAnswerMinutes: number

  @ApiProperty({ type: Number })
  returnTripPayPercent: number

  // Spec 0043: the box model settings.
  @ApiProperty({ type: Number })
  boxUnitsSmall: number

  @ApiProperty({ type: Number })
  boxUnitsMedium: number

  @ApiProperty({ type: Number })
  boxUnitsLarge: number

  @ApiProperty({ enum: BoxSize })
  boxDefaultSize: BoxSize

  @ApiProperty({ type: Number })
  fairnessWeightRoadTime: number

  @ApiProperty({ type: Number })
  fairnessWeightEarnings: number

  @ApiProperty({ type: Number })
  fairnessWeightWaiting: number

  @ApiProperty({ type: Number })
  fairnessWeightShift: number

  @ApiProperty({ type: Number })
  fairnessCandidateLimit: number

  @ApiProperty({ type: Number })
  fairnessMinOnlineMinutes: number

  @ApiProperty({ type: Number })
  savedCustomerRetentionMonths: number

  @ApiProperty({ type: Number })
  restaurantHistoryDays: number

  @ApiProperty({ type: Number })
  handBackSeconds: number

  @ApiProperty({ type: Number })
  sosLocationRetentionDays: number

  @ApiProperty({ type: Number })
  arrivalRadiusMetres: number

  // Shifts (spec 0026).
  @ApiProperty({ type: Boolean })
  shiftsEnabled: boolean

  @ApiProperty({ type: Number })
  shiftDropNoticeHours: number

  @ApiProperty({ type: String, nullable: true })
  dispatchPhoneNumber: string | null

  @ApiProperty({ type: String })
  cancellationPayoutPolicy: string

  // Spec 0054 (AC-7): each preset as { el, en }.
  @ApiProperty({ type: Object, isArray: true })
  chatQuickRepliesDispatch: ChatPreset[]

  @ApiProperty({ type: Object, isArray: true })
  chatQuickRepliesCourier: ChatPreset[]

  @ApiProperty({ type: Number })
  chatRetentionDays: number

  // Spec 0053 (AC-6).
  @ApiProperty({ type: Number })
  addressNoteRetentionDays: number

  @ApiProperty({ type: Number })
  reviewAnswerDays: number

  @ApiProperty({ type: Number })
  reviewCorrectionMaxCents: number

  constructor(data: InstanceConfigSettings) {
    this.courierMatcherType = data.courierMatcherType as EnumCourierMatcherType
    this.quoteCalculationType = data.quoteCalculationType as EnumQuoteCalculationType
    this.geoCalculationType = data.geoCalculationType as EnumGeoCalculationType
    this.deliveryDurationCalculationType = data.deliveryDurationCalculationType as EnumDeliveryDurationCalculationType
    this.courierCompensationCalculationType =
      data.courierCompensationCalculationType as EnumCourierCompensationCalculationType
    this.distanceUnit = data.distanceUnit as EnumDistanceUnit
    this.currency = data.currency as EnumCurrency
    this.defaultDietaryRestrictions = data.defaultDietaryRestrictions as EnumCourierDietaryRestrictions

    // ?? null, not `x ? x : null`: a saved 0 must read back as 0, not as null.
    this.maxAssignmentDistance = data.maxAssignmentDistance ?? null
    this.maxDriftDistance = data.maxDriftDistance ?? null
    this.quoteExpirationMinutes = data.quoteExpirationMinutes ?? null
    this.feePercentageAmount = data.feePercentageAmount ?? null
    this.feePercentageCeiling = data.feePercentageCeiling
    this.quoteRatePerDistanceUnit = data.quoteRatePerDistanceUnit ?? null
    this.quoteBaseFee = data.quoteBaseFee ?? null

    this.defaultCourierPayRate = data.defaultCourierPayRate ?? null
    this.defaultMaxWorkingHours = data.defaultMaxWorkingHours ?? null
    this.details = data.details && typeof data.details === 'object' ? (data.details as InstanceDetails) : null
    this.updatedAt = data.updatedAt ? (data.updatedAt as string) : null
    this.registeredRegistries = Array.isArray(data.registeredRegistries) ? (data.registeredRegistries as string[]) : []
    this.reassignmentPayoutPolicies = data.reassignmentPayoutPolicies
    this.reassignmentPayoutDefaultPolicy = data.reassignmentPayoutDefaultPolicy
    this.offerExpiryEnabled = data.offerExpiryEnabled
    this.offerExpirySeconds = data.offerExpirySeconds
    this.noCourierRetrySeconds = data.noCourierRetrySeconds
    this.offerTimingEnabled = data.offerTimingEnabled
    this.offerLeadMinutes = data.offerLeadMinutes
    this.offerTimingCandidates = data.offerTimingCandidates
    this.stackingEnabled = data.stackingEnabled
    this.twoOrderPolicy = data.twoOrderPolicy
    this.twoOrderDelayLimitMinutes = data.twoOrderDelayLimitMinutes
    this.addOnOffersEnabled = data.addOnOffersEnabled
    this.addOnMoment = data.addOnMoment
    this.waitPayEnabled = data.waitPayEnabled
    this.waitPayFreeMinutes = data.waitPayFreeMinutes
    this.shiftBreakMinutes = data.shiftBreakMinutes
    this.waitPayCentsPerMinute = data.waitPayCentsPerMinute
    this.waitLimitMinutes = data.waitLimitMinutes
    this.splitAnswerMinutes = data.splitAnswerMinutes
    this.returnTripPayPercent = data.returnTripPayPercent
    this.boxUnitsSmall = data.boxUnitsSmall
    this.boxUnitsMedium = data.boxUnitsMedium
    this.boxUnitsLarge = data.boxUnitsLarge
    this.boxDefaultSize = data.boxDefaultSize
    this.fairnessWeightRoadTime = data.fairnessWeightRoadTime
    this.fairnessWeightEarnings = data.fairnessWeightEarnings
    this.fairnessWeightWaiting = data.fairnessWeightWaiting
    this.fairnessWeightShift = data.fairnessWeightShift
    this.fairnessCandidateLimit = data.fairnessCandidateLimit
    this.fairnessMinOnlineMinutes = data.fairnessMinOnlineMinutes
    this.savedCustomerRetentionMonths = data.savedCustomerRetentionMonths
    this.restaurantHistoryDays = data.restaurantHistoryDays
    this.handBackSeconds = data.handBackSeconds
    this.sosLocationRetentionDays = data.sosLocationRetentionDays
    this.arrivalRadiusMetres = data.arrivalRadiusMetres
    this.shiftsEnabled = data.shiftsEnabled
    this.shiftDropNoticeHours = data.shiftDropNoticeHours
    this.dispatchPhoneNumber = data.dispatchPhoneNumber
    this.cancellationPayoutPolicy = data.cancellationPayoutPolicy
    this.chatQuickRepliesDispatch = data.chatQuickRepliesDispatch
    this.chatQuickRepliesCourier = data.chatQuickRepliesCourier
    this.chatRetentionDays = data.chatRetentionDays
    this.addressNoteRetentionDays = data.addressNoteRetentionDays
    this.reviewAnswerDays = data.reviewAnswerDays
    this.reviewCorrectionMaxCents = data.reviewCorrectionMaxCents
  }
}
