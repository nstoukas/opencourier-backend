import { ApiProperty } from '@nestjs/swagger'
import { EnumCancelledBy, EnumFoodOutcome } from '@prisma/types'

// A job the rider held that was cancelled (spec 0015). An allow list: nothing about the customer
// (AC-11). The restaurant's name, address and number tell the rider where the food goes back.
export class CancelledJobCourierDto {
  @ApiProperty({ type: String })
  id: string

  @ApiProperty({ type: String, nullable: true })
  orderReference: string | null

  @ApiProperty({ type: String })
  pickupName: string

  @ApiProperty({ type: String })
  pickupBusinessName: string

  @ApiProperty({ type: String })
  pickupAddress: string

  @ApiProperty({ type: String })
  pickupPhoneNumber: string

  @ApiProperty({ enum: EnumCancelledBy })
  cancelledBy: EnumCancelledBy

  @ApiProperty({ type: Date })
  cancelledAt: Date

  // The rider had the food: it goes back to the restaurant, and the outcome is asked for.
  @ApiProperty({ type: Boolean })
  pickedUp: boolean

  // Cents; null until the award is written (the app says the pay is being recorded).
  @ApiProperty({ type: Number, nullable: true })
  payAmount: number | null

  @ApiProperty({ type: String })
  currencyCode: string

  @ApiProperty({ enum: EnumFoodOutcome, nullable: true })
  foodOutcome: EnumFoodOutcome | null

  constructor(data: CancelledJobCourierDto) {
    this.id = data.id
    this.orderReference = data.orderReference
    this.pickupName = data.pickupName
    this.pickupBusinessName = data.pickupBusinessName
    this.pickupAddress = data.pickupAddress
    this.pickupPhoneNumber = data.pickupPhoneNumber
    this.cancelledBy = data.cancelledBy
    this.cancelledAt = data.cancelledAt
    this.pickedUp = data.pickedUp
    this.payAmount = data.payAmount
    this.currencyCode = data.currencyCode
    this.foodOutcome = data.foodOutcome
  }
}
