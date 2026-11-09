import { ApiProperty } from '@nestjs/swagger'
import { EnumProductReportKind } from '@prisma/types'
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator'
import { RefuseIfNotSentAsString } from 'src/decorators/refuseIfNotSentAsString.decorator'

// Spec 0032: a wrong or missing product. The item may be free text; it is not checked against the order.
export class ProductReportCreateAdminInput {
  @ApiProperty({ enum: EnumProductReportKind })
  @IsEnum(EnumProductReportKind)
  kind: EnumProductReportKind

  @ApiProperty({ type: String, required: false, maxLength: 120 })
  @IsOptional()
  @RefuseIfNotSentAsString()
  @IsString()
  @MaxLength(120)
  itemName?: string

  @ApiProperty({ type: String, required: false, maxLength: 500 })
  @IsOptional()
  @RefuseIfNotSentAsString()
  @IsString()
  @MaxLength(500)
  note?: string
}
