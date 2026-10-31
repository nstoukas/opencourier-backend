import { ApiProperty } from '@nestjs/swagger'
import { IsInt, IsOptional, Max, Min } from 'class-validator'
import { MAX_TAP_AGE_MS } from 'src/domains/delivery-event/utils/occurred-at.util'

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
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_TAP_AGE_MS)
  tapAgeMs?: number
}
