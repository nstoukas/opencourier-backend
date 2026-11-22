import { ApiProperty } from '@nestjs/swagger'
import { EnumLocationNoteReactionType } from '@prisma/types'
import { IsIn } from 'class-validator'

// Spec 0053 (AC-5): downvotes left the app, so an upvote is the only reaction a rider can send (a
// second upvote takes it back). Older DOWNVOTE rows stay in the table, unused.
export class LocationNoteReactCourierInput {
  @ApiProperty({
    required: true,
    enum: [EnumLocationNoteReactionType.UPVOTE],
  })
  @IsIn([EnumLocationNoteReactionType.UPVOTE])
  reaction: EnumLocationNoteReactionType
}
