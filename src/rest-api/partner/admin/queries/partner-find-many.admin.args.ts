import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional } from 'class-validator'

export class PartnerFindManyAdminArgs {
  @ApiPropertyOptional({ type: Number })
  @IsInt()
  @IsOptional()
  @Type(() => Number)
  page?: number

  @ApiPropertyOptional({ type: Number })
  @IsInt()
  @IsOptional()
  @Type(() => Number)
  perPage?: number
}
