import { ApiProperty } from '@nestjs/swagger'
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsOptional, IsString, MaxLength } from 'class-validator'
import { RefuseIfNotSentAsString } from 'src/decorators/refuseIfNotSentAsString.decorator'
import { PARTNER_BILL_MAX_CHARGES } from 'src/services/partner-billing/partner-billing.service'

// Spec 0036. A DTO ("data transfer object") is a class describing a request's shape; the global
// ValidationPipe checks every request against these decorators before the controller runs.

// `?partnerId=` narrows the month overview to one restaurant (the line on its own page, AC-11).
export class PartnerChargeMonthAdminArgs {
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  partnerId?: string
}

export class PartnerBillCreateAdminInput {
  @ApiProperty({ type: String })
  @RefuseIfNotSentAsString()
  @IsString()
  partnerId: string

  // YYYY-MM; the service refuses any other text with 400.
  @ApiProperty({ type: String, example: '2026-11' })
  @RefuseIfNotSentAsString()
  @IsString()
  month: string

  @ApiProperty({ type: [String], minItems: 1, maxItems: PARTNER_BILL_MAX_CHARGES })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PARTNER_BILL_MAX_CHARGES)
  @ArrayUnique()
  @IsString({ each: true })
  chargeIds: string[]

  // The invoice number, if any. Trimmed by the service, which allows 60 characters after that;
  // this upper bound only stops an absurd body.
  @ApiProperty({ type: String, required: false, maxLength: 60 })
  @IsOptional()
  @RefuseIfNotSentAsString()
  @IsString()
  @MaxLength(255)
  reference?: string
}

export class PartnerBillUndoAdminInput {
  // Why the bill is undone: 1 to 300 characters once trimmed (checked by the service).
  @ApiProperty({ type: String, maxLength: 300 })
  @RefuseIfNotSentAsString()
  @IsString()
  @MaxLength(1000)
  reason: string
}
