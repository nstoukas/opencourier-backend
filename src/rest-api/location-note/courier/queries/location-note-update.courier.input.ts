import { ApiProperty } from '@nestjs/swagger'
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator'
import { RefuseIfNotSentAsBoolean } from 'src/decorators/refuseIfNotSentAsBoolean.decorator'
import { RefuseIfNotSentAsString } from 'src/decorators/refuseIfNotSentAsString.decorator'

export class LocationNoteUpdateCourierInput {
  @ApiProperty({ required: true, type: String, minLength: 1, maxLength: 255 })
  @IsString()
  @RefuseIfNotSentAsString()
  @Length(1, 255)
  note: string

  // Spec 0053 (cross check 7): an edit is checked again, and needs the same confirmation.
  @ApiProperty({ required: false, type: Boolean })
  @IsOptional()
  @IsBoolean()
  @RefuseIfNotSentAsBoolean()
  confirmed?: boolean
}
