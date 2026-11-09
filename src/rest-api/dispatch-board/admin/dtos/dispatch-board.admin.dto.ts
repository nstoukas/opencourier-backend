import { ApiProperty } from '@nestjs/swagger'
import { DispatchBoard } from 'src/services/dispatch-board/dispatch-board.service'
import { AttentionRow, DispatchBoardCards, DispatchMap } from 'src/services/dispatch-board/dispatch-board'

// One row of Needs attention. Fields are copied one by one, so the internal `sortAt` never leaves
// the server: an offer with its deadline running must send no time at all (spec 0034, AC-5).
export class DispatchAttentionRowAdminDto {
  @ApiProperty({ type: String }) id: string
  // A plain string on purpose: rows 24 and 111 add kinds, and an older page draws them as a plain row.
  @ApiProperty({ type: String }) kind: string
  @ApiProperty({ type: Date, nullable: true }) since: Date | null
  @ApiProperty({ type: String, nullable: true }) deliveryId: string | null
  @ApiProperty({ type: String, nullable: true }) sosId: string | null
  @ApiProperty({ type: String, nullable: true }) issueId: string | null
  @ApiProperty({ type: String, nullable: true }) threadId: string | null
  @ApiProperty({ type: String, nullable: true }) status: string | null
  @ApiProperty({ type: String, nullable: true }) courierId: string | null
  @ApiProperty({ type: String, nullable: true }) orderReference: string | null
  @ApiProperty({ type: String, nullable: true }) restaurantName: string | null
  @ApiProperty({ type: String, nullable: true }) riderName: string | null
  @ApiProperty({ type: String, nullable: true }) customerLabel: string | null
  @ApiProperty({ type: String }) detail: string
  @ApiProperty({ type: Boolean }) held: boolean

  constructor(row: AttentionRow) {
    this.id = row.id
    this.kind = row.kind
    this.since = row.since
    this.deliveryId = row.deliveryId
    this.sosId = row.sosId
    this.issueId = row.issueId
    this.threadId = row.threadId
    this.status = row.status
    this.courierId = row.courierId
    this.orderReference = row.orderReference
    this.restaurantName = row.restaurantName
    this.riderName = row.riderName
    this.customerLabel = row.customerLabel
    this.detail = row.detail
    this.held = row.held
  }
}

// Totals for the whole co-op only: no figure here is per rider (spec 0034, AC-10).
export class DispatchBoardAdminDto {
  @ApiProperty({ type: Date }) generatedAt: Date
  @ApiProperty() cards: DispatchBoardCards
  @ApiProperty({ type: [DispatchAttentionRowAdminDto] }) attention: DispatchAttentionRowAdminDto[]
  @ApiProperty({ type: Number }) attentionMore: number
  // Latest positions of working riders only: no history and no position age (AC-13).
  @ApiProperty() map: DispatchMap
  @ApiProperty() dispatchStop: { active: boolean; until: Date | null }

  constructor(board: DispatchBoard) {
    this.generatedAt = board.generatedAt
    this.cards = board.cards
    this.attention = board.attention.map((row) => new DispatchAttentionRowAdminDto(row))
    this.attentionMore = board.attentionMore
    this.map = board.map
    this.dispatchStop = board.dispatchStop
  }
}
