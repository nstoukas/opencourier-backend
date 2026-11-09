import { ApiProperty } from '@nestjs/swagger'
import { IsIn, IsInt } from 'class-validator'
import { RefuseIfNotSentAsNumber } from 'src/decorators/refuseIfNotSentAsNumber.decorator'
import { PAUSE_MINUTES } from 'src/domains/partner/partner-availability'

export class PausePartnerInput {
  @ApiProperty({ type: Number, enum: PAUSE_MINUTES })
  @RefuseIfNotSentAsNumber()
  @IsInt()
  @IsIn(PAUSE_MINUTES)
  minutes: number
}
