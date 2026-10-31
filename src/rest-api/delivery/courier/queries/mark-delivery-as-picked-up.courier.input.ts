import { ApiProperty } from '@nestjs/swagger'
import { IsOptional, IsString } from 'class-validator'
import { CourierJobStepCourierInput } from './courier-job-step.courier.input'

// `extends` adds tapAgeMs (spec 0009) to this body.
export class MarkDeliveryAsPickedUpCourierInput extends CourierJobStepCourierInput {
  @ApiProperty({
    required: false,
    type: String,
  })
  @IsString()
  @IsOptional()
  note?: string
}
