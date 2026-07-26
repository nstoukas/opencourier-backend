import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { EnumCountryCode } from '@prisma/types'
import { IsEnum, IsNumber, IsOptional, IsString, MinLength } from 'class-validator'

export class PickupAddressAdminInput {
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  street: string

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  houseNumber?: string

  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  city: string

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  state?: string

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  zipCode?: string

  @ApiProperty({ enum: EnumCountryCode })
  @IsEnum(EnumCountryCode)
  countryCode: EnumCountryCode

  @ApiProperty({ type: Number })
  @IsNumber()
  latitude: number

  @ApiProperty({ type: Number })
  @IsNumber()
  longitude: number

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  formattedAddress?: string
}
