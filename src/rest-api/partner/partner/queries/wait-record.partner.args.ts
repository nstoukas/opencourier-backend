import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsOptional } from 'class-validator'
import { WAIT_RECORD_DAYS } from 'src/domains/partner/wait-record'

export class WaitRecordPartnerArgs {
  @ApiPropertyOptional({ type: Number, enum: WAIT_RECORD_DAYS })
  @IsOptional()
  @Type(() => Number)
  @IsIn(WAIT_RECORD_DAYS)
  days?: number
}
