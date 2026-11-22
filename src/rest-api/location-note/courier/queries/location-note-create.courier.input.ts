import { ApiProperty } from '@nestjs/swagger'
import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator'
import { RefuseIfNotSentAsBoolean } from 'src/decorators/refuseIfNotSentAsBoolean.decorator'
import { RefuseIfNotSentAsString } from 'src/decorators/refuseIfNotSentAsString.decorator'
import { ADDRESS_NOTE_STOPS, AddressNoteStop } from 'src/domains/location-note/location-note.domain.service'

// Spec 0053 (AC-2, cross check 3): a rider's note on one stop of a job they hold. The server works out
// the point from the job, so the body carries no place and no coordinates.
export class LocationNoteCreateCourierInput {
  // A DTO is a class whose decorators describe each field: @ApiProperty for the API docs, the
  // class-validator ones (@IsString, @Length...) for the checks the ValidationPipe runs on each request.
  @ApiProperty({ required: true, type: String, minLength: 1, maxLength: 255 })
  @IsString()
  @RefuseIfNotSentAsString()
  @Length(1, 255)
  // Row 82 review: at least one character that is not a space, so a blank note is refused.
  @Matches(/\S/, { message: 'note must not be blank' })
  note: string

  @ApiProperty({ required: true, type: String })
  @IsString()
  @RefuseIfNotSentAsString()
  deliveryId: string

  @ApiProperty({ required: true, enum: ADDRESS_NOTE_STOPS })
  @IsIn(ADDRESS_NOTE_STOPS)
  stop: AddressNoteStop

  // AC-4: the rider saw the personal data warning and chose Save anyway. "false" sent as text is refused.
  @ApiProperty({ required: false, type: Boolean })
  @IsOptional()
  @IsBoolean()
  @RefuseIfNotSentAsBoolean()
  confirmed?: boolean
}
