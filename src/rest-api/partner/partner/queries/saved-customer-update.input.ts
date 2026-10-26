import { ApiProperty } from '@nestjs/swagger'
import { IsBoolean, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { RefuseIfNotSentAsBoolean } from 'src/decorators/refuseIfNotSentAsBoolean.decorator'
import { RefuseIfNotSentAsNumber } from 'src/decorators/refuseIfNotSentAsNumber.decorator'

// The body of PATCH /customers/:id (spec 0005), and of the admin's edit. Every field is optional:
// a field left out stays as it is. The create's rules apply to the fields that are sent.
export class SavedCustomerUpdateInput {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string | null

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine1?: string

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine2?: string | null

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  city?: string

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  zipCode?: string | null

  @ApiProperty({ required: false, type: Number })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number

  @ApiProperty({ required: false, type: Number })
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  formattedAddress?: string | null

  @ApiProperty({
    required: false,
    type: Boolean,
    description: 'An order used this customer just now (restaurants only; an admin edit never counts as use)',
  })
  @IsOptional()
  @IsBoolean()
  @RefuseIfNotSentAsBoolean()
  markUsed?: boolean
}
