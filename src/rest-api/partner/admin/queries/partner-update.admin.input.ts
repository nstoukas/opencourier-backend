import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsOptional, IsString, MinLength, ValidateNested } from 'class-validator'
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

  // @Type tells class-transformer which class constructor to instantiate for nested object validation.
  @ApiPropertyOptional({ type: PickupAddressAdminInput })
  @IsOptional()
  @ValidateNested()
  @Type(() => PickupAddressAdminInput)
  pickupAddress?: PickupAddressAdminInput
}
