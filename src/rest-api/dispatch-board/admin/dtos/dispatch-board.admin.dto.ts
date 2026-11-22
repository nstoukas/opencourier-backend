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
  // Spec 0054 (AC-2): `detail` by code (a key of `server.board`) with its values; null when it has none.
  @ApiProperty({ type: String, nullable: true }) detailCode: string | null
  @ApiProperty({ type: Object, nullable: true }) detailParams: Record<string, string | number | null> | null
  @ApiProperty({ type: Boolean }) held: boolean
  // Only on a REMOVAL_REQUEST row (spec 0035), null otherwise.
  @ApiProperty({ type: String, nullable: true }) removalRequestId: string | null
  @ApiProperty({ type: Boolean, nullable: true }) pickedUp: boolean | null
  // Only on an OFFER_UNANSWERED row of a stack (spec 0048, AC-12): the other order offered with it, null otherwise.
  @ApiProperty({ type: String, nullable: true }) pairedDeliveryId: string | null
  @ApiProperty({ type: String, nullable: true }) pairedOrderReference: string | null
  // Row 81 (AC-12): true on the row of an add on offer (the paired fields then name the rider's job), else false.
  @ApiProperty({ type: Boolean }) addOn: boolean

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
    this.detailCode = row.detailCode
    this.detailParams = row.detailParams
    this.held = row.held
    this.removalRequestId = row.removalRequestId ?? null
    this.pickedUp = row.pickedUp ?? null
    this.pairedDeliveryId = row.pairedDeliveryId ?? null
    this.pairedOrderReference = row.pairedOrderReference ?? null
    this.addOn = row.addOn === true
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
