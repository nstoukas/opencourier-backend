import { ApiProperty } from '@nestjs/swagger'
import { IsIn, IsInt } from 'class-validator'
import { RefuseIfNotSentAsNumber } from 'src/decorators/refuseIfNotSentAsNumber.decorator'
import { BUSY_EXTRA_MINUTES } from 'src/domains/partner/partner-availability'

export class BusyOnPartnerInput {
  @ApiProperty({ type: Number, enum: BUSY_EXTRA_MINUTES })
  @RefuseIfNotSentAsNumber()
  @IsInt()
  @IsIn(BUSY_EXTRA_MINUTES)
  extraMinutes: number
}
