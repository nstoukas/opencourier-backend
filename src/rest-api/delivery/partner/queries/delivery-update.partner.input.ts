import { ApiProperty } from '@nestjs/swagger'
import {
  IsDate,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator'
import { BoxSize } from '@prisma/types'
import { DeliveryVerificationInput } from './delivery-verification.input'
import { Type } from 'class-transformer'
import { DeliveryUpdateDetails } from 'src/shared-types/index'
import { RefuseIfNotSentAsNumber } from 'src/decorators/refuseIfNotSentAsNumber.decorator'
import { pointLeftOut, TIP_CENTS_CEILING } from 'src/domains/delivery/partner-edit'

export class DeliveryUpdatePartnerInput implements DeliveryUpdateDetails {
  @ApiProperty({
    required: false,
    type: String,
    description: 'Left out: stays as it is (row 178).',
  })
  // Row 178: left out (undefined) keeps the stored value, so the portal can send only what the restaurant changed.
  // `@ValidateIf` skips the checks below only for a left out field; a field that is sent, null included, is checked
  // as before (null was refused and still is). Unlike `@IsOptional()`, which would let null through to the write.
  @ValidateIf((input: DeliveryUpdatePartnerInput) => input.dropoffNotes !== undefined)
  @IsString()
  dropoffNotes?: string

  @ApiProperty({
    required: false,
    type: DeliveryVerificationInput,
    description: 'Left out: stays as it is (row 178).',
  })
  // Row 178: left out keeps the stored value; a sent value (null included) is checked as before. See dropoffNotes.
  @ValidateIf((input: DeliveryUpdatePartnerInput) => input.dropoffVerification !== undefined)
  @ValidateNested()
  @Type(() => DeliveryVerificationInput)
  dropoffVerification?: DeliveryVerificationInput

  @ApiProperty({
    required: false,
    type: String,
    description: 'Left out: stays as it is (row 178).',
  })
  // Row 178: left out keeps the stored value; a sent value (null included) is checked as before. See dropoffNotes.
  @ValidateIf((input: DeliveryUpdatePartnerInput) => input.orderReference !== undefined)
  @IsString()
  orderReference?: string

  @ApiProperty({
    required: false,
    type: String,
    description: 'Left out: stays as it is (row 178).',
  })
  // Row 178: left out keeps the stored value; a sent value (null included) is checked as before. See dropoffNotes.
  @ValidateIf((input: DeliveryUpdatePartnerInput) => input.pickupNotes !== undefined)
  @IsString()
  pickupNotes?: string

  @ApiProperty({
    required: false,
    type: DeliveryVerificationInput,
    description: 'Left out: stays as it is (row 178).',
  })
  // Row 178: left out keeps the stored value; a sent value (null included) is checked as before. See dropoffNotes.
  @ValidateIf((input: DeliveryUpdatePartnerInput) => input.pickupVerification !== undefined)
  @ValidateNested()
  @Type(() => DeliveryVerificationInput)
  pickupVerification?: DeliveryVerificationInput

  @ApiProperty({
    required: false,
    type: Number,
    minimum: 0,
    maximum: TIP_CENTS_CEILING,
    description:
      'Left out: the tip stays as it is (row 169). Otherwise the new tip in whole cents, sent as a JSON number (text, such as "250", is refused), applied only before a rider holds the order.',
  })
  // Row 169: a left out tip keeps the stored one (the portal has no tip box and used to send 0, zeroing a tip set
  // through the API). `@ValidateIf` checks the rest only when a tip is sent; unlike `@IsOptional()` it still refuses
  // null, since the tip column is never null.
  @ValidateIf((input: DeliveryUpdatePartnerInput) => input.tipByCustomer !== undefined)
  // agy's review of row 169: a tip must arrive as a JSON number. Without this the pipe reads "" and false as 0 and true
  // as 1, so an empty box would zero the rider's tip (backend AGENTS.md: every number a client sends needs it).
  @RefuseIfNotSentAsNumber()
  // Cents, and the column is a whole number: 2.5 would otherwise pass here and fail at the write with a 500.
  @IsInt()
  // agy's review of rows 148 to 150: a tip is added to the rider's pay, so it can never be below 0.
  @Min(0)
  // Row 171: the column's limit, so a huge tip answers 400, not a 500 at the write.
  @Max(TIP_CENTS_CEILING)
  tipByCustomer?: number

  @ApiProperty({
    required: false,
    type: Number,
    description: 'Left out together with the other coordinate: the point is not moved (row 178). Never one alone.',
  })
  // Row 178: the drop off point is the two coordinates together. Both left out: the point is not moved. One sent
  // without the other answers 400, since half a point is no point: this check runs on both as soon as either is sent,
  // so the missing one fails `@IsNumber()`. A null counts as sent, so one or both null fail `@IsNumber()` too.
  @ValidateIf((input: DeliveryUpdatePartnerInput) => !pointLeftOut(input))
  @IsNumber()
  dropoffLatitude?: number

  @ApiProperty({
    required: false,
    type: Number,
    description: 'Left out together with the other coordinate: the point is not moved (row 178). Never one alone.',
  })
  // Row 178: the same rule as dropoffLatitude. See there.
  @ValidateIf((input: DeliveryUpdatePartnerInput) => !pointLeftOut(input))
  @IsNumber()
  dropoffLongitude?: number

  @ApiProperty({
    required: false,
    type: Date,
    nullable: true,
    description: 'Left out: the time stays as it is. null: the order has no such time.',
  })
  // Row 168: left out (undefined) keeps the time as it is, `null` is "no time" (the column is nullable). Both were
  // refused with 400, so the portal invented a deadline and sent every time back.
  // `@IsOptional()` lets null through and still checks a value that is sent. `@Type(() => Date)` turns the sent text
  // into a Date: with `Date | null` TypeScript records the type as a plain object, so the implicit conversion stops.
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  pickupReadyAt?: Date | null

  @ApiProperty({
    required: false,
    type: Date,
    nullable: true,
    description: 'Left out: the time stays as it is. null: the order has no such time.',
  })
  // Row 168: left out (undefined) keeps the time as it is, `null` is "no time" (the column is nullable). Both were
  // refused with 400, so the portal invented a deadline and sent every time back.
  // `@IsOptional()` lets null through and still checks a value that is sent. `@Type(() => Date)` turns the sent text
  // into a Date: with `Date | null` TypeScript records the type as a plain object, so the implicit conversion stops.
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  pickupDeadlineAt?: Date | null

  @ApiProperty({
    required: false,
    type: Date,
    nullable: true,
    description: 'Left out: the time stays as it is. null: the order has no such time.',
  })
  // Row 168: left out (undefined) keeps the time as it is, `null` is "no time" (the column is nullable). Both were
  // refused with 400, so the portal invented a deadline and sent every time back.
  // `@IsOptional()` lets null through and still checks a value that is sent. `@Type(() => Date)` turns the sent text
  // into a Date: with `Date | null` TypeScript records the type as a plain object, so the implicit conversion stops.
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dropoffReadyAt?: Date | null

  @ApiProperty({
    required: false,
    type: Date,
    nullable: true,
    description: 'Left out: the time stays as it is. null: the order has no such time.',
  })
  // Row 168: left out (undefined) keeps the time as it is, `null` is "no time" (the column is nullable). Both were
  // refused with 400, so the portal invented a deadline and sent every time back.
  // `@IsOptional()` lets null through and still checks a value that is sent. `@Type(() => Date)` turns the sent text
  // into a Date: with `Date | null` TypeScript records the type as a plain object, so the implicit conversion stops.
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dropoffDeadlineAt?: Date | null

  // Spec 0043 (AC-3): a new size, only while no rider has been offered or holds the order (409 after).
  @ApiProperty({ required: false, enum: BoxSize })
  @IsOptional()
  @IsEnum(BoxSize)
  boxSize?: BoxSize
}
