import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Max, Min, MinLength, ValidateNested } from 'class-validator'
import { RefuseIfNotSentAsNumber } from 'src/decorators/refuseIfNotSentAsNumber.decorator'
import { USUAL_PREP_MINUTES_MAX, USUAL_PREP_MINUTES_MIN, USUAL_PREP_MINUTES_SENTENCE } from 'src/domains/delivery/ready-signals'
import { PickupAddressAdminInput } from './pickup-address.admin.input'

export class PartnerUpdateAdminInput {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  phoneNumber?: string | null

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  logo?: string | null

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  webhookUrl?: string | null

  // Spec 0023 (AC-9): how long this restaurant usually takes, in whole minutes, 0 to 90. Must arrive as a
  // JSON number: the ValidationPipe would turn "" into 0.
  @ApiPropertyOptional({ type: Number, minimum: USUAL_PREP_MINUTES_MIN, maximum: USUAL_PREP_MINUTES_MAX })
  @IsOptional()
  @RefuseIfNotSentAsNumber()
  @IsInt({ message: USUAL_PREP_MINUTES_SENTENCE })
  @Min(USUAL_PREP_MINUTES_MIN, { message: USUAL_PREP_MINUTES_SENTENCE })
  @Max(USUAL_PREP_MINUTES_MAX, { message: USUAL_PREP_MINUTES_SENTENCE })
  usualPrepMinutes?: number

  // @Type tells class-transformer which class constructor to instantiate for nested object validation.
  @ApiPropertyOptional({ type: PickupAddressAdminInput })
  @IsOptional()
  @ValidateNested()
  @Type(() => PickupAddressAdminInput)
  pickupAddress?: PickupAddressAdminInput
}
