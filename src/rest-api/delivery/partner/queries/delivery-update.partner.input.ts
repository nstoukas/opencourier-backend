import { ApiProperty } from '@nestjs/swagger'
import { IsDate, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, ValidateIf, ValidateNested } from 'class-validator'
import { BoxSize } from '@prisma/types'
import { DeliveryVerificationInput } from './delivery-verification.input'
import { Type } from 'class-transformer'
import { DeliveryUpdateDetails } from 'src/shared-types/index'
import { RefuseIfNotSentAsNumber } from 'src/decorators/refuseIfNotSentAsNumber.decorator'

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
    required: false,
    type: Number,
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
  tipByCustomer?: number

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
