import { ApiProperty } from '@nestjs/swagger'
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import { RefuseIfNotSentAsNumber } from 'src/decorators/refuseIfNotSentAsNumber.decorator'
import { ORDER_TOTAL_CENTS_CEILING, TIP_CENTS_CEILING } from 'src/domains/delivery/partner-edit'
import { DeliveryAddressInput } from './delivery-address-input'
import { DeliveryCreationDetails } from 'src/shared-types/index'
import { DeliveryOrderItemInput } from './delivery-order-item.input'
import { DeliveryVerificationInput } from './delivery-verification.input'
import { BoxSize, EnumDeliverableAction, EnumUndeliverableAction } from '@prisma/types'
import { Type } from 'class-transformer'

export class DeliveryCreatePartnerInput implements DeliveryCreationDetails {
  @ApiProperty({
    required: true,
    type: String,
  })
  @IsString()
  pickupName: string

  @ApiProperty({
    required: true,
    type: String,
  })
  pickupAddress: DeliveryAddressInput

  @ApiProperty({
    required: true,
    type: String,
  })
  @IsString()
  pickupPhoneNumber: string

  @ApiProperty({
    required: true,
    type: String,
  })
  @IsString()
  dropoffName: string

  @ApiProperty({
    required: true,
    type: String,
  })
  dropoffAddress: DeliveryAddressInput

  @ApiProperty({
    required: true,
    type: String,
  })
  @IsString()
  dropoffPhoneNumber: string

  @ApiProperty({
    required: true,
    type: [DeliveryOrderItemInput],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliveryOrderItemInput)
  orderItems: DeliveryOrderItemInput[]

  @ApiProperty({
    required: true,
    type: String,
  })
  @IsString()
  pickupBusinessName: string

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
    type: String,
  })
  @IsString()
  pickupNotes: string

  @ApiProperty({
    required: false,
    type: DeliveryVerificationInput,
  })
  @ValidateNested()
  @Type(() => DeliveryVerificationInput)
  @IsOptional()
  pickupVerification?: DeliveryVerificationInput

  @ApiProperty({
    required: true,
    type: String,
  })
  @IsString()
  dropoffBusinessName: string

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
    type: String,
  })
  @IsString()
  dropoffNotes: string

  @ApiProperty({
    required: true,
    type: String,
  })
  @IsString()
  dropoffSellerNotes: string

  // Spec 0016: the floor and the name on the doorbell, each optional. Stored in the delivery's own
  // columns (never the shared Location row), so the limits match those columns.
  @ApiProperty({ required: false, type: String, nullable: true, maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  dropoffFloor?: string | null

  @ApiProperty({ required: false, type: String, nullable: true, maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  dropoffDoorbell?: string | null

  @ApiProperty({
    required: false,
    type: DeliveryVerificationInput,
  })
  @ValidateNested()
  @Type(() => DeliveryVerificationInput)
  @IsOptional()
  dropoffVerification?: DeliveryVerificationInput

  @ApiProperty({
    required: true,
    enum: EnumDeliverableAction,
  })
  @IsEnum(EnumDeliverableAction)
  @IsOptional()
  deliverableAction: EnumDeliverableAction

  @ApiProperty({
    required: false,
    enum: EnumUndeliverableAction,
  })
  @IsEnum(EnumUndeliverableAction)
  @IsOptional()
  undeliverableAction?: EnumUndeliverableAction

  @ApiProperty({
    required: true,
    type: String,
  })
  @IsString()
  orderReference: string

  @ApiProperty({
    required: true,
    type: Number,
    minimum: 0,
    maximum: ORDER_TOTAL_CENTS_CEILING,
    description: 'The order total in whole cents, sent as a JSON number (text, such as "1250", is refused).',
  })
  // Row 177, as row 171 did for the tip: the total must arrive as a JSON number. Without this the pipe reads "" and
  // false as 0 and true as 1 (backend AGENTS.md: every number a client sends needs it).
  @RefuseIfNotSentAsNumber()
  // Cents, and the column is a whole number: 12.5 would otherwise pass here and fail at the write with a 500.
  @IsInt()
  // Row 177: an order total below nothing means nothing; request-web never sends one.
  @Min(0)
  // Row 177: the column's limit, so a huge total answers 400, not a 500 at the write.
  @Max(ORDER_TOTAL_CENTS_CEILING)
  orderTotalValue: number

  @ApiProperty({
    required: true,
    type: String,
  })
  @IsString()
  quoteId: string

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
    type: Boolean,
  })
  @IsBoolean()
  @IsOptional()
  requiresDropoffSignature?: boolean

  @ApiProperty({
    required: false,
    type: Boolean,
  })
  @IsBoolean()
  @IsOptional()
  requiresId?: boolean

  @ApiProperty({
    required: true,
    type: Number,
    minimum: 0,
    maximum: TIP_CENTS_CEILING,
    description: 'The tip in whole cents, sent as a JSON number (text, such as "250", is refused).',
  })
  // Row 171, as row 169 did for the edit: a tip must arrive as a JSON number. Without this the pipe reads "" and
  // false as 0 and true as 1 (backend AGENTS.md: every number a client sends needs it).
  @RefuseIfNotSentAsNumber()
  // Cents, and the column is a whole number: 2.5 would otherwise pass here and fail at the write with a 500.
  @IsInt()
  // agy's review of rows 148 to 150: a tip is added to the rider's pay, so it can never be below 0.
  @Min(0)
  // Row 171: the column's limit, so a huge tip answers 400, not a 500 at the write.
  @Max(TIP_CENTS_CEILING)
  tip: number

  @ApiProperty({
    required: false,
    type: String,
  })
  @IsOptional()
  @IsString()
  idempotencyKey?: string

  @ApiProperty({
    required: false,
    type: String,
  })
  @IsOptional()
  @IsString()
  externalStoreId?: string

  @ApiProperty({
    required: false,
    type: DeliveryVerificationInput,
  })
  @ValidateNested()
  @Type(() => DeliveryVerificationInput)
  @IsOptional()
  returnVerification?: DeliveryVerificationInput

  @ApiProperty({
    required: false,
    type: String,
  })
  @IsOptional()
  @IsString()
  externalId?: string

  // Spec 0043 (AC-3): the bag's size, picked by the restaurant. Optional for API restaurants: with
  // none, the order counts as the co-op's default size and the record says it was assumed. Any other
  // value is refused with 400 by @IsEnum.
  @ApiProperty({ required: false, enum: BoxSize })
  @IsOptional()
  @IsEnum(BoxSize)
  boxSize?: BoxSize

  // Spec 0046 (AC-1): one leg of an order too big for one box, "leg 1 of 2". Both or neither; the
  // service answers 400 for one without the other or a number out of range. @RefuseIfNotSentAsNumber:
  // the ValidationPipe would otherwise turn "" or true into a number before @IsInt runs.
  @ApiProperty({
    required: false,
    type: Number,
    nullable: true,
    minimum: 1,
    maximum: 4,
    description:
      'Leg number of an order sent as several deliveries, with legCount. The legs share a non empty orderReference, ' +
      'which stays tied to that order for good: a later order with legs needs a new reference (a leg number already ' +
      'used with it answers 409, even when that leg was cancelled).',
  })
  @IsOptional()
  @RefuseIfNotSentAsNumber()
  @IsInt()
  legNumber?: number | null

  @ApiProperty({ required: false, type: Number, nullable: true, minimum: 2, maximum: 4 })
  @IsOptional()
  @RefuseIfNotSentAsNumber()
  @IsInt()
  legCount?: number | null
}
