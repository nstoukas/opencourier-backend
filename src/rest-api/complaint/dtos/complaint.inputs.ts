import { ApiProperty } from '@nestjs/swagger'
import { EnumComplaintAbout, EnumComplaintCategory, EnumComplaintStatus } from '@prisma/types'
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { RefuseIfNotSentAsString } from 'src/decorators/refuseIfNotSentAsString.decorator'

// Spec 0052. Each class is a DTO ("data transfer object"): the shape a request body must have. The
// decorators are class-validator rules the global ValidationPipe runs before the route; a body that breaks
// one is refused with 400. The texts' lengths after trimming, and which category fits whom, are checked
// again in ComplaintService. The words are the filer's: never logged, never put in a push or an event.

// AC-2: a rider files about the restaurant or the customer of one of their jobs.
export class ComplaintCreateCourierInput {
  @ApiProperty({ type: String })
  @RefuseIfNotSentAsString()
  @IsString()
  deliveryId: string

  @ApiProperty({ enum: [EnumComplaintAbout.RESTAURANT, EnumComplaintAbout.CUSTOMER] })
  @IsEnum(EnumComplaintAbout)
  about: EnumComplaintAbout

  @ApiProperty({ enum: EnumComplaintCategory })
  @IsEnum(EnumComplaintCategory)
  category: EnumComplaintCategory

  @ApiProperty({ type: String, maxLength: 1000 })
  @RefuseIfNotSentAsString()
  @IsString()
  @MaxLength(1000)
  text: string
}

// AC-3: a restaurant files about the rider of one of its delivered or cancelled orders.
export class ComplaintCreatePartnerInput {
  @ApiProperty({ type: String })
  @RefuseIfNotSentAsString()
  @IsString()
  deliveryId: string

  @ApiProperty({ enum: EnumComplaintCategory, description: 'One of LATE, RUDE, FOOD_DAMAGED, OTHER' })
  @IsEnum(EnumComplaintCategory)
  category: EnumComplaintCategory

  @ApiProperty({ type: String, maxLength: 1000 })
  @RefuseIfNotSentAsString()
  @IsString()
  @MaxLength(1000)
  text: string
}

// AC-3: an admin files about a rider on behalf of anyone; the text names who called in.
export class ComplaintCreateAdminInput extends ComplaintCreatePartnerInput {
  // Needed only when more than one rider accepted the order (cross check 3); see delivery-riders.
  @ApiProperty({ type: String, required: false, nullable: true })
  @IsOptional()
  @RefuseIfNotSentAsString()
  @IsString()
  aboutCourierId?: string | null
}

// AC-5: the rider's reply (also an admin's entry for a deactivated rider, cross check 2).
export class ComplaintReplyInput {
  @ApiProperty({ type: String, maxLength: 1000 })
  @RefuseIfNotSentAsString()
  @IsString()
  @MaxLength(1000)
  text: string
}

export class ComplaintDecideAdminInput {
  @ApiProperty({ type: String, maxLength: 1000, description: 'Shown to the rider and the filer (AC-7)' })
  @RefuseIfNotSentAsString()
  @IsString()
  @MaxLength(1000)
  outcome: string
}

export class ComplaintWithdrawAdminInput {
  @ApiProperty({ type: String, maxLength: 1000, description: 'Shown to the rider and the filer' })
  @RefuseIfNotSentAsString()
  @IsString()
  @MaxLength(1000)
  reason: string
}

// The page of a list. perPage is capped so one call cannot read the whole table.
export class ComplaintPageArgs {
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

// AC-7: the restaurant's list, optionally for one order (request-web's order page, cross check 10).
export class ComplaintListPartnerArgs extends ComplaintPageArgs {
  @ApiProperty({ required: false, type: String })
  @IsOptional()
  @IsString()
  deliveryId?: string
}

// AC-6, cross check 13: the admin list's only filters. No rider filter, search or sort.
export class ComplaintListAdminArgs extends ComplaintPageArgs {
  @ApiProperty({ required: false, enum: EnumComplaintStatus })
  @IsOptional()
  @IsEnum(EnumComplaintStatus)
  status?: EnumComplaintStatus

  @ApiProperty({ required: false, enum: EnumComplaintAbout })
  @IsOptional()
  @IsEnum(EnumComplaintAbout)
  about?: EnumComplaintAbout
}
