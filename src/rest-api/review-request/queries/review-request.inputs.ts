import { ApiProperty } from '@nestjs/swagger'
import { EnumReviewOutcome, EnumReviewRequestStatus, EnumReviewTopic } from '@prisma/types'
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { RefuseIfNotSentAsNumber } from 'src/decorators/refuseIfNotSentAsNumber.decorator'
import { RefuseIfNotSentAsString } from 'src/decorators/refuseIfNotSentAsString.decorator'

// Spec 0038, AC-1. The note is the rider's words about their work: never logged, never put in an
// event or a push (AC-4). Its length after trimming is checked again in ReviewRequestService.
export class ReviewRequestCreateCourierInput {
  @ApiProperty({ enum: EnumReviewTopic })
  @IsEnum(EnumReviewTopic)
  topic: EnumReviewTopic

  @ApiProperty({ type: String, maxLength: 1000 })
  @RefuseIfNotSentAsString()
  @IsString()
  @MaxLength(1000)
  note: string

  // Left out for a general request (from the explanation page).
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @RefuseIfNotSentAsString()
  @IsString()
  deliveryId?: string
}

// Spec 0038, AC-6 and AC-7.
export class ReviewRequestAnswerAdminInput {
  @ApiProperty({ enum: EnumReviewOutcome })
  @IsEnum(EnumReviewOutcome)
  outcome: EnumReviewOutcome

  @ApiProperty({ type: String, maxLength: 2000 })
  @RefuseIfNotSentAsString()
  @IsString()
  @MaxLength(2000)
  answer: string

  // Whole cents, above 0 and at most reviewCorrectionMaxCents; checked in ReviewRequestService.
  @ApiProperty({ type: Number, required: false, nullable: true })
  @IsOptional()
  @RefuseIfNotSentAsNumber()
  @IsInt()
  correctionCents?: number | null
}

// The page of a list. perPage is capped so one call cannot read the whole table.
export class ReviewPageArgs {
  @ApiProperty({ required: false, type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number

  @ApiProperty({ required: false, type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  perPage?: number
}

// AC-5: which tab of the admin's Reviews page; OPEN when left out.
export class ReviewRequestListAdminArgs extends ReviewPageArgs {
  @ApiProperty({ required: false, enum: EnumReviewRequestStatus })
  @IsOptional()
  @IsEnum(EnumReviewRequestStatus)
  status?: EnumReviewRequestStatus
}
