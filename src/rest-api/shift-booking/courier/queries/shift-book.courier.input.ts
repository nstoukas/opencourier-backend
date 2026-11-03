import { ApiProperty } from '@nestjs/swagger'
import { IsString, Matches } from 'class-validator'
import { RefuseIfNotSentAsString } from 'src/decorators/refuseIfNotSentAsString.decorator'

// Spec 0027: an occurrence is a slot and an Athens date.
export class ShiftBookCourierInput {
  @ApiProperty({ type: String })
  @RefuseIfNotSentAsString()
  @IsString()
  shiftSlotId: string

  @ApiProperty({ type: String, example: '2026-11-06' })
  @RefuseIfNotSentAsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date: string
}
