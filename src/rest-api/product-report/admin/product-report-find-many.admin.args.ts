import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator'

export class ProductReportFindManyAdminArgs {
  @ApiPropertyOptional({ enum: ['open', 'resolved', 'all'] })
  @IsOptional()
  @IsIn(['open', 'resolved', 'all'])
  state?: 'open' | 'resolved' | 'all'

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  page?: number

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  perPage?: number
}

export class ProductReportResolveAdminInput {
  @ApiPropertyOptional({ type: String, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  resolution?: string
}
