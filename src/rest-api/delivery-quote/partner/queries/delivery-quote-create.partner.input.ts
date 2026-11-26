import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsDate, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator'
import { RefuseIfNotSentAsNumber } from 'src/decorators/refuseIfNotSentAsNumber.decorator'
import { ORDER_TOTAL_CENTS_CEILING } from 'src/domains/delivery/partner-edit'
import { DeliveryQuoteAddressInput } from './delivery-quote-address.partner.input'

export class DeliverQuoteCreatePartnerInput {
  @ApiProperty({
    required: true,
    type: DeliveryQuoteAddressInput,
  })
  @Type(() => DeliveryQuoteAddressInput)
  pickupAddress: DeliveryQuoteAddressInput

  @ApiProperty({
    required: true,
    type: DeliveryQuoteAddressInput,
  })
  @Type(() => DeliveryQuoteAddressInput)
  dropoffAddress: DeliveryQuoteAddressInput

  @ApiProperty({
    required: true,
    type: Number,
  })
  @IsNumber()
  pickupLatitude: number

  @ApiProperty({
    required: true,
    type: Number,
  })
  @IsNumber()
  pickupLongitude: number

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
    required: false,
    type: Date,
  })
  @IsDate()
  @IsOptional()
  pickupReadyAt?: Date

  @ApiProperty({
    required: false,
    type: Date,
  })
  @IsDate()
  @IsOptional()
  pickupDeadlineAt?: Date

  @ApiProperty({
    required: false,
    type: Date,
  })
  @IsDate()
  @IsOptional()
  dropoffReadyAt?: Date

  @ApiProperty({
    required: false,
    type: Date,
  })
  @IsDate()
  @IsOptional()
  dropoffDeadlineAt?: Date

  @ApiProperty({
    required: false,
    type: String,
  })
  @IsString()
  @IsOptional()
  pickupPhoneNumber?: string

  @ApiProperty({
    required: false,
    type: String,
  })
  @IsString()
  @IsOptional()
  dropoffPhoneNumber?: string

  @ApiProperty({
    required: false,
    type: Number,
    minimum: 0,
    maximum: ORDER_TOTAL_CENTS_CEILING,
    description: 'The order total in whole cents, sent as a JSON number (text, such as "1250", is refused).',
  })
  // Row 177: the total must arrive as a JSON number, or the pipe reads "" and false as 0 and true as 1. Leaving it
  // out (or null) is still allowed: the decorator passes those through and @IsOptional skips the checks below.
  @RefuseIfNotSentAsNumber()
  // Cents, and the column is a whole number: 12.5 would otherwise pass here and fail at the write with a 500.
  @IsInt()
  // Row 177: an order total below nothing means nothing; request-web never sends one.
  @Min(0)
  // Row 177: the column's limit, so a huge total answers 400, not a 500 at the write.
  @Max(ORDER_TOTAL_CENTS_CEILING)
  @IsOptional()
  orderTotalValue?: number
}
