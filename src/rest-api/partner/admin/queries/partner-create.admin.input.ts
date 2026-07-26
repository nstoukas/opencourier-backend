import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsEmail, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator'
import { PickupAddressAdminInput } from './pickup-address.admin.input'

export class PartnerCreateAdminInput {
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  name: string

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  phoneNumber?: string

  @ApiProperty({ type: String })
  @IsEmail()
  email: string

  @ApiProperty({ type: String })
  @IsString()
  @MinLength(8)
  password: string

  // @Type tells class-transformer which class constructor to instantiate for nested object validation.
  @ApiPropertyOptional({ type: PickupAddressAdminInput })
  @IsOptional()
  @ValidateNested()
  @Type(() => PickupAddressAdminInput)
  pickupAddress?: PickupAddressAdminInput
}
