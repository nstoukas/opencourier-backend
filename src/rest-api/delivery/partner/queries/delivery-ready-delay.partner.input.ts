import { ApiProperty } from '@nestjs/swagger'
import { IsIn, IsISO8601, ValidateIf } from 'class-validator'
import { RefuseIfNotSentAsNumber } from 'src/decorators/refuseIfNotSentAsNumber.decorator'
import { READY_DELAY_MINUTES } from 'src/domains/delivery/ready-signals'

// Spec 0023 (AC-3): "+5 / +10 / +15 min" from the restaurant's page.
export class DeliveryReadyDelayPartnerInput {
  // Only 5, 10 or 15, sent as a JSON number (the ValidationPipe would turn "" into 0).
  @ApiProperty({ enum: READY_DELAY_MINUTES, type: Number })
  @RefuseIfNotSentAsNumber()
  @IsIn([...READY_DELAY_MINUTES], { message: 'minutes must be 5, 10 or 15' })
  minutes: number

  // The ready time the restaurant was looking at when it tapped. If it has moved since (another tap,
  // another tab), the delay is refused rather than added twice. Null for an order with no ready time.
  // `@ValidateIf` skips the check only for null, so leaving the field out is still refused.
  @ApiProperty({ type: String, nullable: true, description: 'ISO time' })
  @ValidateIf((_input, value) => value !== null)
  @IsISO8601({ strict: true }, { message: 'expectedReadyAt must be the ready time shown, as an ISO time' })
  expectedReadyAt: string | null
}
