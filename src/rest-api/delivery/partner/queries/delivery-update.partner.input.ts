import { ApiProperty } from '@nestjs/swagger'
import { IsDate, IsEnum, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator'
import { BoxSize } from '@prisma/types'
import { DeliveryVerificationInput } from './delivery-verification.input'
import { Type } from 'class-transformer'
import { DeliveryUpdateDetails } from 'src/shared-types/index'

export class DeliveryUpdatePartnerInput implements DeliveryUpdateDetails {
  @ApiProperty({
    required: true,
    type: String,
  })
  @IsString()
  dropoffNotes: string

  @ApiProperty({
    required: true,
    type: DeliveryVerificationInput,
  })
  @ValidateNested()
  @Type(() => DeliveryVerificationInput)
  dropoffVerification: DeliveryVerificationInput

  @ApiProperty({
    required: true,
    type: String,
  })
  @IsString()
  orderReference: string

  @ApiProperty({
    required: true,
    type: String,
  })
  @IsString()
  pickupNotes: string

  @ApiProperty({
    required: true,
    type: DeliveryVerificationInput,
  })
  @ValidateNested()
  @Type(() => DeliveryVerificationInput)
  pickupVerification: DeliveryVerificationInput

  @ApiProperty({
    required: true,
    type: Number,
  })
  @IsNumber()
  // agy's review of rows 148 to 150: a tip is added to the rider's pay, so it can never be below 0.
  @Min(0)
  tipByCustomer: number

  @ApiProperty({
    required: true,
    type: Number,
  })
  @IsNumber()
  dropoffLatitude: number

  @ApiProperty({
    required: true,
    type: Number,
  })
  @IsNumber()
  dropoffLongitude: number

  @ApiProperty({
    required: true,
    type: Date,
  })
  @IsDate()
  pickupReadyAt: Date

  @ApiProperty({
    required: true,
    type: Date,
  })
  @IsDate()
  pickupDeadlineAt: Date

  @ApiProperty({
    required: true,
    type: Date,
  })
  @IsDate()
  dropoffReadyAt: Date

  @ApiProperty({
    required: true,
    type: Date,
  })
  @IsDate()
  dropoffDeadlineAt: Date

  // Spec 0043 (AC-3): a new size, only while no rider has been offered or holds the order (409 after).
  @ApiProperty({ required: false, enum: BoxSize })
  @IsOptional()
  @IsEnum(BoxSize)
  boxSize?: BoxSize
}
