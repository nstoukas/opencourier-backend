import { ApiProperty } from '@nestjs/swagger'
import { IsInt, Max, Min, ValidateIf } from 'class-validator'
import { MAX_TAP_AGE_MS } from 'src/domains/delivery-event/utils/occurred-at.util'
import { RefuseIfNotSentAsNumber } from 'src/decorators/refuseIfNotSentAsNumber.decorator'

// The body every courier job step accepts (spec 0009): how many milliseconds before sending the
// rider tapped the step. The app sends it for a step that waited on the phone for signal; left out,
// the step happened when it arrived. The other step inputs extend this class to add their own fields.
export class CourierJobStepCourierInput {
  @ApiProperty({
    required: false,
    type: Number,
    description: 'How long before this request the rider tapped the step, in milliseconds (0 to 7 days)',
  })
  // class-validator decorators: each one is a rule the global ValidationPipe checks before the
  // controller runs; a broken rule answers 400.
  // The ValidationPipe turns "", true and false into numbers before any rule runs; this refuses
  // anything not sent as a real JSON number (row 20 review, agy's tests).
  @RefuseIfNotSentAsNumber()
  // Left out is fine; sent as null is not (AC-7). @IsOptional() would let null through too.
  @ValidateIf((_input, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(MAX_TAP_AGE_MS)
  tapAgeMs?: number
}
