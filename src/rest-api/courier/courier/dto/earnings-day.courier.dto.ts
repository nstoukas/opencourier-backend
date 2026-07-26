import { ApiProperty } from '@nestjs/swagger'
import { EarningsDelivery } from 'src/domains/delivery-event/types/earnings-summary.type'

// DTO representing one completed delivery in the courier day earnings list.
export class EarningsDeliveryCourierDto {
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

  constructor(data: EarningsDelivery) {
    this.deliveryId = data.deliveryId
    this.droppedOffAt = data.droppedOffAt
    this.dropoffAddress = data.dropoffAddress
    this.pickupBusinessName = data.pickupBusinessName
    this.compensation = data.compensation
    this.tips = data.tips
    this.total = data.total
  }
}

// DTO representing the earnings day drill-down report for a courier.
export class EarningsDayCourierDto {
  // Swagger decorator for OpenAPI documentation
  @ApiProperty({ type: String, description: 'Date in YYYY-MM-DD format' })
  date: string

  @ApiProperty({ type: String, description: 'IANA timezone name' })
  timezone: string

  @ApiProperty({ type: String, description: 'Instance currency code, e.g. EUR' })
  currency: string

  @ApiProperty({ type: Number, description: 'Number of completed deliveries on this day' })
  deliveryCount: number

  @ApiProperty({ type: Number, description: 'Total piece-rate compensation for this day in integer cents' })
  compensation: number

  @ApiProperty({ type: Number, description: 'Total tips for this day in integer cents' })
  tips: number

  @ApiProperty({ type: Number, description: 'Total earnings for this day in integer cents' })
  total: number

  @ApiProperty({ type: [EarningsDeliveryCourierDto] })
  deliveries: EarningsDeliveryCourierDto[]

  constructor(
    deliveries: EarningsDelivery[],
    meta: { date: string; timezone: string; currency: string }
  ) {
    this.date = meta.date
    this.timezone = meta.timezone
    this.currency = meta.currency

    this.deliveries = deliveries.map((d) => new EarningsDeliveryCourierDto(d))

    const totals = deliveries.reduce(
      (acc, delivery) => {
        acc.deliveryCount += 1
        acc.compensation += delivery.compensation
        acc.tips += delivery.tips
        acc.total += delivery.total
        return acc
      },
      {
        deliveryCount: 0,
        compensation: 0,
        tips: 0,
        total: 0,
      }
    )

    this.deliveryCount = totals.deliveryCount
    this.compensation = totals.compensation
    this.tips = totals.tips
    this.total = totals.total
  }
}
