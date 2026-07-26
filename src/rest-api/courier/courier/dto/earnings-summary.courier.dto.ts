import { ApiProperty } from '@nestjs/swagger'
import { EarningsDaySummary } from 'src/domains/delivery-event/types/earnings-summary.type'

// DTO representing earnings summary for a single day.
export class EarningsSummaryDayCourierDto {
  // Swagger documentation decorator for OpenAPI schema generation
  @ApiProperty({ type: String, description: 'Date in YYYY-MM-DD format' })
  date: string

  // Swagger documentation decorator for OpenAPI schema generation
  @ApiProperty({ type: Number, description: 'Number of completed deliveries on this day' })
  deliveryCount: number

  // Swagger documentation decorator for OpenAPI schema generation
  @ApiProperty({ type: Number, description: 'Piece-rate compensation in integer cents' })
  compensation: number

  // Swagger documentation decorator for OpenAPI schema generation
  @ApiProperty({ type: Number, description: 'Courier tips in integer cents' })
  tips: number

  // Swagger documentation decorator for OpenAPI schema generation
  @ApiProperty({ type: Number, description: 'Total earnings (compensation + tips) in integer cents' })
  total: number

  constructor(data: EarningsDaySummary) {
    this.date = data.date
    this.deliveryCount = data.deliveryCount
    this.compensation = data.compensation
    this.tips = data.tips
    this.total = data.total
  }
}

// DTO representing the overall earnings summary report for a courier.
export class EarningsSummaryCourierDto {
  // Swagger documentation decorator for OpenAPI schema generation
  @ApiProperty({ type: Date, description: 'Start date of the summary window' })
  from: Date

  // Swagger documentation decorator for OpenAPI schema generation
  @ApiProperty({ type: Date, description: 'End date of the summary window' })
  to: Date

  // Swagger documentation decorator for OpenAPI schema generation
  @ApiProperty({ type: String, description: 'IANA timezone name used for day boundaries' })
  timezone: string

  // Assumption: one currency per instance. Delivery.currencyCode is per-delivery, so a
  // multi-currency instance would sum unlike amounts here.
  @ApiProperty({ type: String, description: 'Instance currency code, e.g. EUR' })
  currency: string

  // Swagger documentation decorator for OpenAPI schema generation
  @ApiProperty({ type: Number, description: 'Total number of completed deliveries' })
  totalDeliveryCount: number

  // Swagger documentation decorator for OpenAPI schema generation
  @ApiProperty({ type: Number, description: 'Total piece-rate compensation in integer cents' })
  totalCompensation: number

  // Swagger documentation decorator for OpenAPI schema generation
  @ApiProperty({ type: Number, description: 'Total tips in integer cents' })
  totalTips: number

  // Swagger documentation decorator for OpenAPI schema generation
  @ApiProperty({ type: Number, description: 'Total earnings in integer cents' })
  totalEarnings: number

  // Swagger documentation decorator for OpenAPI schema generation
  @ApiProperty({ type: [EarningsSummaryDayCourierDto] })
  days: EarningsSummaryDayCourierDto[]

  constructor(days: EarningsDaySummary[], meta: { from: Date; to: Date; timezone: string; currency: string }) {
    this.from = meta.from
    this.to = meta.to
    this.timezone = meta.timezone
    this.currency = meta.currency

    this.days = days.map((d) => new EarningsSummaryDayCourierDto(d))

    const totals = days.reduce(
      (acc, day) => {
        acc.totalDeliveryCount += day.deliveryCount
        acc.totalCompensation += day.compensation
        acc.totalTips += day.tips
        acc.totalEarnings += day.total
        return acc
      },
      {
        totalDeliveryCount: 0,
        totalCompensation: 0,
        totalTips: 0,
        totalEarnings: 0,
      }
    )

    this.totalDeliveryCount = totals.totalDeliveryCount
    this.totalCompensation = totals.totalCompensation
    this.totalTips = totals.totalTips
    this.totalEarnings = totals.totalEarnings
  }
}
