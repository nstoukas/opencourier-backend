import { ApiProperty } from '@nestjs/swagger'
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { RefuseIfNotSentAsBoolean } from 'src/decorators/refuseIfNotSentAsBoolean.decorator'
import { RefuseIfNotSentAsNumber } from 'src/decorators/refuseIfNotSentAsNumber.decorator'
import { PhoneClashRule } from 'src/domains/saved-customer/saved-customer.domain.service'

// The body of POST /customers (spec 0005). Types and lengths are checked here (a 400); the rules
// that need the customer's meaning (a real phone, a name that is not blank, an address inside the
// area the co-op serves) are checked by SavedCustomerDomainService (a 422).
export class SavedCustomerCreatePartnerInput {
  @ApiProperty({ required: true })
  @IsString()
  @MaxLength(255)
  name: string

  @ApiProperty({ required: true, description: 'Any common format; a number with no country code is read as Greek' })
  @IsString()
  @MaxLength(40)
  phone: string

  @ApiProperty({ required: false, nullable: true, description: 'Delivery notes for the rider' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string | null

  @ApiProperty({ required: true, description: 'Street and number' })
  @IsString()
  @MaxLength(255)
  addressLine1: string

  @ApiProperty({ required: false, nullable: true, description: 'Floor, flat' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine2?: string | null

  @ApiProperty({ required: true })
  @IsString()
  @MaxLength(255)
  city: string

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  zipCode?: string | null

  @ApiProperty({ required: true, type: Number })
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  @Min(-90)
  @Max(90)
  latitude: number

  @ApiProperty({ required: true, type: Number })
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  @Min(-180)
  @Max(180)
  longitude: number

  @ApiProperty({ required: false, nullable: true, description: "The geocoder's full address text" })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  formattedAddress?: string | null

  @ApiProperty({
    required: false,
    enum: ['refuse', 'update'],
    description: 'When this restaurant already has the phone: refuse with 409 (default), or update that customer',
  })
  @IsOptional()
  @IsIn(['refuse', 'update'])
  onPhoneClash?: PhoneClashRule

  @ApiProperty({ required: false, type: Boolean, description: 'An order used this customer just now' })
  @IsOptional()
  @IsBoolean()
  @RefuseIfNotSentAsBoolean()
  markUsed?: boolean
}
