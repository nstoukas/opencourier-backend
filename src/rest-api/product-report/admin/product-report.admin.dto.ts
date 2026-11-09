import { ApiProperty } from '@nestjs/swagger'
import { EnumProductReportKind, EnumProductReportSource } from '@prisma/types'

// Spec 0032: one report, as an admin reads it.
export class ProductReportAdminDto {
  @ApiProperty({ type: String })
  id: string

  @ApiProperty({ type: String })
  deliveryId: string

  @ApiProperty({ enum: EnumProductReportKind })
  kind: EnumProductReportKind

  @ApiProperty({ enum: EnumProductReportSource })
  source: EnumProductReportSource

  @ApiProperty({ type: String, nullable: true })
  reporterEmail: string | null

  @ApiProperty({ type: String, nullable: true })
  itemName: string | null

  @ApiProperty({ type: String, nullable: true })
  note: string | null

  @ApiProperty({ type: Date, nullable: true })
  resolvedAt: Date | null

  @ApiProperty({ type: String, nullable: true })
  resolution: string | null

  @ApiProperty({ type: Date })
  createdAt: Date

  constructor(report: {
    id: string
    deliveryId: string
    kind: EnumProductReportKind
    source: EnumProductReportSource
    reporterEmail?: string | null
    itemName: string | null
    note: string | null
    resolvedAt: Date | null
    resolution: string | null
    createdAt: Date
  }) {
    this.id = report.id
    this.deliveryId = report.deliveryId
    this.kind = report.kind
    this.source = report.source
    this.reporterEmail = report.reporterEmail ?? null
    this.itemName = report.itemName
    this.note = report.note
    this.resolvedAt = report.resolvedAt
    this.resolution = report.resolution
    this.createdAt = report.createdAt
  }
}
