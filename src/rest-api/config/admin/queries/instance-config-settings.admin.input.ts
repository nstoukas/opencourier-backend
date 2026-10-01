import { ApiProperty } from '@nestjs/swagger'
import { IsArray, IsEnum, IsNumber, IsOptional, IsObject, IsString } from 'class-validator'
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
