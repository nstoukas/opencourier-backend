import { ApiProperty } from '@nestjs/swagger'
import { EarningsDelivery } from 'src/domains/delivery-event/types/earnings-summary.type'

// DTO representing detail of a single completed delivery for a courier.
export class EarningsDeliveryDetailCourierDto {
  // Swagger decorator for OpenAPI documentation
  @ApiProperty({ type: String, description: 'Delivery unique ID' })
  deliveryId: string

  @ApiProperty({ type: Date, description: 'Dropoff timestamp' })
  droppedOffAt: Date

  @ApiProperty({ type: String, nullable: true, description: 'Formatted dropoff address or null' })
  dropoffAddress: string | null

  @ApiProperty({ type: String, description: 'Pickup business name' })
  pickupBusinessName: string

  @ApiProperty({ type: Number, description: 'Piece-rate compensation in integer cents' })
  compensation: number

  @ApiProperty({ type: Number, description: 'Courier tips in integer cents' })
  tips: number

  @ApiProperty({ type: Number, description: 'Total earnings (compensation + tips) in integer cents' })
  total: number

  @ApiProperty({ type: String, description: 'Instance currency code, e.g. EUR' })
  currency: string

  constructor(delivery: EarningsDelivery, meta: { currency: string }) {
    this.deliveryId = delivery.deliveryId
    this.droppedOffAt = delivery.droppedOffAt
    this.dropoffAddress = delivery.dropoffAddress
    this.pickupBusinessName = delivery.pickupBusinessName
    this.compensation = delivery.compensation
    this.tips = delivery.tips
    this.total = delivery.total
    this.currency = meta.currency
  }
}
