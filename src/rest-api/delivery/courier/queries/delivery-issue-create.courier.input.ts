import { ApiProperty } from '@nestjs/swagger'
import { EnumDeliveryIssueReason } from '@prisma/types'
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator'

// What the app sends when a rider reports an issue with a delivery (decision 66.11).
export class DeliveryIssueCreateCourierInput {
  @ApiProperty({ enum: EnumDeliveryIssueReason, required: true })
  @IsEnum(EnumDeliveryIssueReason)
  reason: EnumDeliveryIssueReason

  // Optional detail, needed most with OTHER. 500 characters at most, as in the table.
  @ApiProperty({ type: String, required: false, nullable: true, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null
}
