import { ApiProperty } from '@nestjs/swagger'
import { BoxSize } from '@prisma/types'
import { IsArray, IsBoolean, IsEnum, IsNumber, IsOptional, IsObject, IsString } from 'class-validator'
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
  InstanceDetails,
} from 'src/shared-types/index'
import { RefuseIfNotSentAsNumber } from 'src/decorators/refuseIfNotSentAsNumber.decorator'
import { RefuseIfNotSentAsBoolean } from 'src/decorators/refuseIfNotSentAsBoolean.decorator'
import { RefuseIfNotSentAsString } from 'src/decorators/refuseIfNotSentAsString.decorator'
import { InstanceConfigSettingsInput } from './instance-config-settings.input'

export class InstanceConfigSettingsAdminInput implements InstanceConfigSettingsInput {
  @ApiProperty({ required: false, enum: EnumCourierMatcherType })
  @IsOptional()
  @IsEnum(EnumCourierMatcherType)
  courierMatcherType?: EnumCourierMatcherType

  @ApiProperty({ required: false, enum: EnumQuoteCalculationType })
  @IsOptional()
  @IsEnum(EnumQuoteCalculationType)
  quoteCalculationType?: EnumQuoteCalculationType

  @ApiProperty({ required: false, enum: EnumGeoCalculationType })
  @IsOptional()
  @IsEnum(EnumGeoCalculationType)
  geoCalculationType?: EnumGeoCalculationType

  @ApiProperty({ required: false, enum: EnumDeliveryDurationCalculationType })
  @IsOptional()
  @IsEnum(EnumDeliveryDurationCalculationType)
  deliveryDurationCalculationType?: EnumDeliveryDurationCalculationType

  @ApiProperty({ required: false, enum: EnumCourierCompensationCalculationType })
  @IsOptional()
  @IsEnum(EnumCourierCompensationCalculationType)
  courierCompensationCalculationType?: EnumCourierCompensationCalculationType

  @ApiProperty({ required: false, enum: EnumDistanceUnit })
  @IsOptional()
  @IsEnum(EnumDistanceUnit)
  distanceUnit?: EnumDistanceUnit

  @ApiProperty({ required: false, enum: EnumCurrency })
  @IsOptional()
  @IsEnum(EnumCurrency)
  currency?: EnumCurrency

  // Every number setting below needs @RefuseIfNotSentAsNumber(): without it an empty value saves as 0.
  @ApiProperty({ required: false, type: Number })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  maxAssignmentDistance?: number

  @ApiProperty({ required: false, type: Number })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  maxDriftDistance?: number

  @ApiProperty({ required: false, type: Number })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  quoteExpirationMinutes?: number

  @ApiProperty({ required: false, type: Number })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  feePercentageAmount?: number

  // Spec 0041: whole numbers, 0 to 100. The fee % may not be saved above it.
  @ApiProperty({ required: false, type: Number })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  feePercentageCeiling?: number

  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  quoteRatePerDistanceUnit?: number

  // Whole cents, 0 or more. The whole cents check lives in NUMERIC_SETTING_RULES, not here.
  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  quoteBaseFee?: number

  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  defaultCourierPayRate?: number

  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  defaultMaxWorkingHours?: number

  // Offer expiry (spec 0002). Whole seconds; the 20 to 300 and 10 to 300 ranges live in
  // NUMERIC_SETTING_RULES, not here.
  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  offerExpirySeconds?: number

  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  noCourierRetrySeconds?: number

  // Spec 0033: restaurant delay pay. The ranges live in NUMERIC_SETTING_RULES.
  @ApiProperty({ type: Boolean, required: false })
  @IsOptional()
  @IsBoolean()
  @RefuseIfNotSentAsBoolean()
  waitPayEnabled?: boolean

  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  waitPayFreeMinutes?: number

  // Spec 0040 (AC-17): whole minutes, 0 to 240.
  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  shiftBreakMinutes?: number

  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  waitPayCentsPerMinute?: number

  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  waitLimitMinutes?: number

  // Spec 0047 (AC-2): 1 to 60, checked by NUMERIC_SETTING_RULES.
  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  splitAnswerMinutes?: number

  // Spec 0035: 0 to 100 (NUMERIC_SETTING_RULES). The share of the distance fee a return trip pays.
  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  returnTripPayPercent?: number

  // Spec 0043: the box units each size takes, whole numbers 1 to 100 (NUMERIC_SETTING_RULES), with
  // Small <= Medium <= Large checked on save; and the size an order with no size counts as.
  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  boxUnitsSmall?: number

  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  boxUnitsMedium?: number

  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  boxUnitsLarge?: number

  @ApiProperty({ required: false, enum: BoxSize })
  @IsOptional()
  @IsEnum(BoxSize)
  boxDefaultSize?: BoxSize

  // Spec 0044: the fairness weights (0 to 100, not all three 0), riders scored (1 to 50), minimum
  // minutes online today (0 to 240). Ranges in NUMERIC_SETTING_RULES.
  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  fairnessWeightRoadTime?: number

  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  fairnessWeightEarnings?: number

  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  fairnessWeightWaiting?: number

  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  fairnessWeightShift?: number

  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  fairnessCandidateLimit?: number

  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  fairnessMinOnlineMinutes?: number

  // Spec 0031: offers timed to food readiness. The ranges live in NUMERIC_SETTING_RULES.
  @ApiProperty({ type: Boolean, required: false })
  @IsOptional()
  @IsBoolean()
  @RefuseIfNotSentAsBoolean()
  offerTimingEnabled?: boolean

  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  offerLeadMinutes?: number

  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  offerTimingCandidates?: number

  // Stacked orders (spec 0048, AC-1): the switch, when two orders may go together, and the most the first
  // customer's food may be delayed by it (0 to 30 whole minutes, in NUMERIC_SETTING_RULES).
  @ApiProperty({ type: Boolean, required: false })
  @IsOptional()
  @IsBoolean()
  @RefuseIfNotSentAsBoolean()
  stackingEnabled?: boolean

  @ApiProperty({ required: false, enum: EnumTwoOrderPolicy })
  @IsOptional()
  @IsEnum(EnumTwoOrderPolicy)
  twoOrderPolicy?: EnumTwoOrderPolicy

  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  twoOrderDelayLimitMinutes?: number

  // Mid job add ons (spec 0048, AC-1, row 81): the switch, and when an add on may come. The policy and the
  // delay limit above apply to add ons too.
  @ApiProperty({ type: Boolean, required: false })
  @IsOptional()
  @IsBoolean()
  @RefuseIfNotSentAsBoolean()
  addOnOffersEnabled?: boolean

  @ApiProperty({ required: false, enum: EnumAddOnMoment })
  @IsOptional()
  @IsEnum(EnumAddOnMoment)
  addOnMoment?: EnumAddOnMoment

  // Saved customers (spec 0005). Whole months; the 1 to 36 range lives in NUMERIC_SETTING_RULES.
  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  savedCustomerRetentionMonths?: number

  // Order history (spec 0017). Whole days; the 1 to 365 range lives in NUMERIC_SETTING_RULES.
  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  restaurantHistoryDays?: number

  // SOS (spec 0022). Whole days the SOS position points are kept; the 1 to 365 range lives in
  // NUMERIC_SETTING_RULES.
  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  sosLocationRetentionDays?: number

  // The free hand back (spec 0020). Whole seconds; the 0 to 300 range lives in NUMERIC_SETTING_RULES.
  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  handBackSeconds?: number

  // Arrival detection (spec 0021). Whole metres; "0, or 20 to 300" lives in NUMERIC_SETTING_RULES.
  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  arrivalRadiusMetres?: number

  // Shifts (spec 0026): the co-op switch. @RefuseIfNotSentAsBoolean: the text "false" would save as true.
  @ApiProperty({ type: Boolean, required: false })
  @IsOptional()
  @IsBoolean()
  @RefuseIfNotSentAsBoolean()
  shiftsEnabled?: boolean

  // Shifts (spec 0026): whole hours, 0 to 168, in NUMERIC_SETTING_RULES.
  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  shiftDropNoticeHours?: number

  // The co-op's dispatch line (row 72). Text, not a number: a leading + or 0 must survive.
  // An empty text clears it; the phone number check lives in the domain service.
  // @RefuseIfNotSentAsString(): without it a JSON number is turned into text and loses its +.
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  @RefuseIfNotSentAsString()
  dispatchPhoneNumber?: string

  // Spec 0015: which payout policy pays a rider whose job is cancelled. A key of
  // reassignmentPayoutPolicies; the domain service checks it against the menu.
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  @RefuseIfNotSentAsString()
  cancellationPayoutPolicy?: string

  // Chat (spec 0034, AC-13): the one tap presets, one list for dispatch and one for riders. The
  // limits (at most 8, each 1 to 100 characters) are checked by name in the domain service.
  @ApiProperty({ type: String, required: false, isArray: true })
  @IsOptional()
  @IsArray()
  chatQuickRepliesDispatch?: string[]

  @ApiProperty({ type: String, required: false, isArray: true })
  @IsOptional()
  @IsArray()
  chatQuickRepliesCourier?: string[]

  // Chat (spec 0034, AC-18). Whole days; the 7 to 365 range lives in NUMERIC_SETTING_RULES.
  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  chatRetentionDays?: number

  // Address notes (spec 0053, AC-6). Whole days; the 30 to 730 range lives in NUMERIC_SETTING_RULES.
  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  addressNoteRetentionDays?: number

  // Review requests (spec 0038, AC-3): whole days, 1 to 14 (NUMERIC_SETTING_RULES).
  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  reviewAnswerDays?: number

  // Review requests (spec 0038, AC-7): the largest pay correction, in whole cents.
  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  reviewCorrectionMaxCents?: number

  // The first on/off setting. It needs @RefuseIfNotSentAsBoolean(): without it the text "false" saves as true.
  @ApiProperty({ type: Boolean, required: false })
  @IsOptional()
  @IsBoolean()
  @RefuseIfNotSentAsBoolean()
  offerExpiryEnabled?: boolean

  @ApiProperty({ enum: EnumCourierDietaryRestrictions, required: false, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(EnumCourierDietaryRestrictions, {
    each: true,
  })
  defaultDietaryRestrictions?: EnumCourierDietaryRestrictions[]

  @ApiProperty({ type: Object, required: false })
  @IsOptional()
  @IsObject()
  details?: InstanceDetails

  @ApiProperty({ type: String, required: false, isArray: true })
  @IsOptional()
  @IsArray()
  registeredRegistries?: string[]

  @ApiProperty({ type: Object, required: false })
  @IsOptional()
  @IsObject()
  reassignmentPayoutPolicies?: Record<string, number>

  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  reassignmentPayoutDefaultPolicy?: string
}
