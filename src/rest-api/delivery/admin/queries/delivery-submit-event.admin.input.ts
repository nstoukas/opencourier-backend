import { ApiProperty } from '@nestjs/swagger'
import { EnumDeliveryEventType, EnumCancelledBy } from '@prisma/types'
import { IsEnum, IsString, IsOptional, IsDate } from 'class-validator'
import { Type } from 'class-transformer'

export class DeliverySubmitEventAdminInput {
  @ApiProperty({
    required: true,
    type: String,
  })
  @IsString()
  deliveryId: string

  @ApiProperty({
    required: true,
    enum: EnumDeliveryEventType,
  })
  @IsEnum(EnumDeliveryEventType)
  eventType: EnumDeliveryEventType

  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    description:
      'When eventType is ACCEPTED, the courier to offer the delivery to (required). Sets status to ASSIGNING_COURIER with matchedCourierId; courier must accept via the courier API.',
  })
  @IsString()
  @IsOptional()
  courierId?: string

  @ApiProperty({
    required: false,
    enum: EnumCancelledBy,
    description: 'Only with eventType CANCELED (spec 0015): who asked for the cancellation. Defaults to COOP.',
  })
  @IsOptional()
  @IsEnum(EnumCancelledBy)
  cancelledBy?: EnumCancelledBy

  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
  })
  @IsDate()
  @IsOptional()
  @Type(() => Date)
  prepareTimeEstimate?: Date | null
}
