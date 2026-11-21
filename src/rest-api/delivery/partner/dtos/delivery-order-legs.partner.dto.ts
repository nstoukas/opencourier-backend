import { ApiProperty } from '@nestjs/swagger'
import { DeliveryPartnerDto } from './delivery.partner.dto'

// Spec 0046 (AC-3, AC-6): the legs of one order as the restaurant sees them, and the leg numbers that were
// never sent (a leg whose create failed), so the order page can offer Retry.
export class DeliveryOrderLegsPartnerDto {
  @ApiProperty({ type: () => DeliveryPartnerDto, isArray: true })
  legs: DeliveryPartnerDto[]

  @ApiProperty({ type: Number, isArray: true })
  missingLegNumbers: number[]
}
