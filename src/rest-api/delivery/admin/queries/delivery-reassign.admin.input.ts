import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsOptional, IsString } from 'class-validator'
import { IsBoolean } from 'class-validator'
import { RefuseIfNotSentAsBoolean } from 'src/decorators/refuseIfNotSentAsBoolean.decorator'

export class DeliveryReassignAdminInput {
  @ApiProperty({
    required: true,
    type: String,
    description: 'The ID of the courier to reassign the delivery to',
  })
  @IsString()
  @IsNotEmpty()
  courierId: string

  @ApiProperty({
    required: false,
    type: String,
    description: 'Payout policy key from config (e.g. FULL_COMPENSATION). Defaults to configured default policy.',
  })
  @IsOptional()
  @IsString()
  payoutPolicy?: string

  @ApiProperty({
    required: false,
    type: String,
    description: 'Optional human-readable note/message for the reassignment audit log',
  })
  @IsOptional()
  @IsString()
  message?: string

  // Spec 0043 (AC-6): the admin confirms giving the order to a rider whose box it would fill past 100
  // units. Without it such an assignment answers 409 with the numbers. "false" sent as text is refused.
  @ApiProperty({ required: false, type: Boolean })
  @IsOptional()
  @IsBoolean()
  @RefuseIfNotSentAsBoolean()
  confirmOverCapacity?: boolean
}
