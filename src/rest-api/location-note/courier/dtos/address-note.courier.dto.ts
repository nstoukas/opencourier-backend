import { ApiProperty } from '@nestjs/swagger'
import { AddressNoteForCourier } from 'src/domains/location-note/location-note.domain.service'

// Spec 0053 (AC-3, cross check 5): a note as a job card shows it. No author, no actor, no rider id
// and no count of anyone's upvotes in total (value 5): `mine` only lets the author edit or delete.
export class AddressNoteCourierDto {
  @ApiProperty({ type: String })
  id: string

  @ApiProperty({ type: String })
  note: string

  // Upvotes from riders other than the author.
  @ApiProperty({ type: Number })
  upvotes: number

  @ApiProperty({ type: Boolean })
  upvotedByMe: boolean

  @ApiProperty({ type: Boolean })
  flaggedByMe: boolean

  @ApiProperty({ type: Boolean })
  mine: boolean

  constructor(data: AddressNoteForCourier) {
    this.id = data.id
    this.note = data.note
    this.upvotes = data.upvotes
    this.upvotedByMe = data.upvotedByMe
    this.flaggedByMe = data.flaggedByMe
    this.mine = data.mine
  }
}
