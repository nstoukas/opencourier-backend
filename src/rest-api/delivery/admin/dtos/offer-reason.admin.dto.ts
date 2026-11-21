import { ApiProperty } from '@nestjs/swagger'
import { OfferReason } from '@prisma/types'

// Spec 0044 (AC-8): why one offer of this delivery went to its rider, for the admin delivery page.
// `candidates` holds other riders' figures, so this DTO exists in the admin namespace only.
export class OfferReasonAdminDto {
  @ApiProperty({ type: String }) id: string
  @ApiProperty({ type: String }) deliveryEventId: string
  @ApiProperty({ type: String }) courierId: string
  // FAIRNESS, NEAREST_COURIER, COURIER_SENIORITY, STATIC or ADMIN.
  @ApiProperty({ type: String }) strategy: string
  @ApiProperty({ type: Object, nullable: true }) weights: Record<string, number> | null
  @ApiProperty({ type: Object }) values: Record<string, unknown>
  @ApiProperty({ type: Number, nullable: true }) score: number | null
  @ApiProperty({ type: Number }) candidateCount: number
  @ApiProperty({ type: Number }) ridersInRange: number
  @ApiProperty({ type: [Object], nullable: true }) candidates: Record<string, unknown>[] | null
  @ApiProperty({ type: String }) kind: string
  @ApiProperty({ type: Date }) createdAt: Date

  constructor(row: OfferReason) {
    this.id = row.id
    this.deliveryEventId = row.deliveryEventId
    this.courierId = row.courierId
    this.strategy = row.strategy
    this.weights = (row.weights as Record<string, number> | null) ?? null
    this.values = row.values as Record<string, unknown>
    this.score = row.score
    this.candidateCount = row.candidateCount
    this.ridersInRange = row.ridersInRange
    this.candidates = (row.candidates as Record<string, unknown>[] | null) ?? null
    this.kind = row.kind
    this.createdAt = row.createdAt
  }
}
