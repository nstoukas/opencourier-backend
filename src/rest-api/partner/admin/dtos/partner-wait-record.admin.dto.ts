import { ApiProperty } from '@nestjs/swagger'

// Spec 0030, AC-6: figures about the restaurant, naming no rider.
export class PartnerWaitRecordAdminDto {
  @ApiProperty({ type: Number })
  days: number

  @ApiProperty({ type: Number })
  orderCount: number

  @ApiProperty({ type: Number })
  waitSamples: number

  @ApiProperty({ type: Number, nullable: true })
  averageWaitMinutes: number | null

  // From 0 to 1; null with no orders.
  @ApiProperty({ type: Number, nullable: true })
  lateShare: number | null

  @ApiProperty({ type: Number })
  prepSamples: number

  @ApiProperty({ type: Number, nullable: true })
  medianPrepMinutes: number | null

  @ApiProperty({ type: Number })
  usualPrepMinutes: number

  constructor(data: PartnerWaitRecordAdminDto) {
    this.days = data.days
    this.orderCount = data.orderCount
    this.waitSamples = data.waitSamples
    this.averageWaitMinutes = data.averageWaitMinutes
    this.lateShare = data.lateShare
    this.prepSamples = data.prepSamples
    this.medianPrepMinutes = data.medianPrepMinutes
    this.usualPrepMinutes = data.usualPrepMinutes
  }
}
