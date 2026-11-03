import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator'

// The longest search text the restaurants list accepts; longer is refused with a 400 (row 106).
export const MAX_PARTNER_SEARCH_LENGTH = 100

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

  // Finds a restaurant by name, pickup address or sign in email, whatever the case and accents;
  // every word must match (row 106, decision 106.1).
  @ApiPropertyOptional({ type: String })
  @IsString()
  @MaxLength(MAX_PARTNER_SEARCH_LENGTH)
  @IsOptional()
  search?: string
}
