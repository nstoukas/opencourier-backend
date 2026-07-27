import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsOptional, IsString } from 'class-validator'

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
}
