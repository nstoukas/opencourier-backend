import { ApiProperty } from '@nestjs/swagger'
import { IsBoolean, IsOptional } from 'class-validator'
import { RefuseIfNotSentAsBoolean } from 'src/decorators/refuseIfNotSentAsBoolean.decorator'
import { CourierJobStepCourierInput } from './courier-job-step.courier.input'

// Spec 0021 (AC-4): the body of the two arrived steps. `detected` is true when the rider's app noticed
// the arrival on its own (within the co-op's radius); left out, the rider tapped it (older apps too).
// It only marks the event's message, so members can tell the two apart on the timeline.
// `extends` = this class has every field of the job step body (tapAgeMs) plus this one.
export class ArrivedCourierInput extends CourierJobStepCourierInput {
  // @RefuseIfNotSentAsBoolean: the ValidationPipe would otherwise turn the text "true" into true.
  @ApiProperty({ type: Boolean, required: false })
  @IsOptional()
  @IsBoolean()
  @RefuseIfNotSentAsBoolean()
  detected?: boolean
}
