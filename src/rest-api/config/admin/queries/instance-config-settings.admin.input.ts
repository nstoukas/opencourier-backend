import { ApiProperty } from '@nestjs/swagger'
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
