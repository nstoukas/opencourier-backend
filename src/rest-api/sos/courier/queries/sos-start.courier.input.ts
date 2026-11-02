import { ApiProperty } from '@nestjs/swagger'
import { IsString, Length, Matches, ValidateIf } from 'class-validator'
import { CourierJobStepCourierInput } from 'src/rest-api/delivery/courier/queries/courier-job-step.courier.input'

// The 3 s hold (spec 0022, AC-4). `extends` = this class has every field of the job step body
// (tapAgeMs: how long before sending the hold completed) plus these two.
export class SosStartCourierInput extends CourierJobStepCourierInput {
  // The phone's own id for this SOS, made at the hold and kept with the waiting start, so a start
  // retried after no signal never makes a second incident.
  @ApiProperty({ type: String, required: true, description: "The phone's id for this SOS (letters, digits, - and _)" })
  @IsString()
  @Length(8, 64)
  @Matches(/^[A-Za-z0-9_-]+$/)
  clientId: string

  // The job the rider held at the hold, if any (the first of their in progress list).
  @ApiProperty({ type: String, required: false })
  // Left out is fine; sent as null is not. @IsOptional() would let null through too.
  @ValidateIf((_input, value) => value !== undefined)
  @IsString()
  @Length(1, 64)
  deliveryId?: string
}
