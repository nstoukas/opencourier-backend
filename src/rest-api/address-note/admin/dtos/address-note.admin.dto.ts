import { ApiProperty } from '@nestjs/swagger'
import { EnumLocationNoteActor } from '@prisma/types'
import { AddressNoteAdminView } from 'src/domains/location-note/location-note.domain.service'

export class AddressNoteFlagAdminDto {
  @ApiProperty({ type: String })
  id: string

  @ApiProperty({ type: String, nullable: true })
  reason: string | null

  @ApiProperty({ type: Date })
  createdAt: Date
}

// Spec 0053 (AC-7): a note on the admin Address notes page. The author is shown here only, so an
// admin can deal with abuse; no rider facing route carries it.
export class AddressNoteAdminDto {
  @ApiProperty({ type: String })
  id: string

  @ApiProperty({ type: String })
  note: string

  @ApiProperty({ type: Number })
  latitude: number

  @ApiProperty({ type: Number })
  longitude: number

  // The linked Location's address, or null for a note with only a point.
  @ApiProperty({ type: String, nullable: true })
  address: string | null

  @ApiProperty({ enum: EnumLocationNoteActor })
  actor: EnumLocationNoteActor

  // The rider who wrote it, when a rider did.
  @ApiProperty({ type: String, nullable: true })
  authorCourierId: string | null

  @ApiProperty({ type: String, nullable: true })
  authorName: string | null

  @ApiProperty({ type: Number })
  upvotes: number

  @ApiProperty({ type: AddressNoteFlagAdminDto, isArray: true })
  flags: AddressNoteFlagAdminDto[]

  @ApiProperty({ type: Date })
  createdAt: Date

  @ApiProperty({ type: Date })
  updatedAt: Date

  @ApiProperty({ type: Date })
  lastConfirmedAt: Date

  constructor(data: AddressNoteAdminView) {
    this.id = data.id
    this.note = data.note ?? ''
    this.latitude = data.latitude
    this.longitude = data.longitude
    this.address = data.address
    this.actor = data.actor
    this.authorCourierId = data.couriers?.id ?? null
    this.authorName = data.couriers ? `${data.couriers.firstName} ${data.couriers.lastName}`.trim() : null
    this.upvotes = data.upvotes
    this.flags = data.flags.map((flag) => ({ id: flag.id, reason: flag.reason, createdAt: flag.createdAt }))
    this.createdAt = data.createdAt
    this.updatedAt = data.updatedAt
    this.lastConfirmedAt = data.lastConfirmedAt
  }
}

export class AddressNoteSearchAdminDto {
  @ApiProperty({ type: AddressNoteAdminDto, isArray: true })
  data: AddressNoteAdminDto[]

  @ApiProperty({ type: Number })
  total: number

  @ApiProperty({ type: Number })
  page: number

  @ApiProperty({ type: Number })
  perPage: number
}
