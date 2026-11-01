import { ApiProperty } from '@nestjs/swagger'
import { IsIn, IsOptional } from 'class-validator'
import { EnumCancelledBy } from '@prisma/types'

// Who asked for the cancellation (spec 0015). A restaurant's own cancellation after a rider accepted
// is charged to it; a customer's is not. Leaving it out means the restaurant (it pressed cancel).
// Only these two: COOP is for an admin.
export const PARTNER_CANCELLERS = [EnumCancelledBy.RESTAURANT, EnumCancelledBy.CUSTOMER] as const

export class DeliveryCancelPartnerInput {
  @ApiProperty({ required: false, enum: PARTNER_CANCELLERS, default: EnumCancelledBy.RESTAURANT })
  @IsOptional()
  // @IsIn = the value must be one of the listed ones; a typo or COOP answers 400.
  @IsIn(PARTNER_CANCELLERS)
  cancelledBy?: (typeof PARTNER_CANCELLERS)[number]
}
