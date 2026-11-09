import { ApiProperty } from '@nestjs/swagger'
import { IsOptional, IsString, MaxLength } from 'class-validator'
import { RefuseIfNotSentAsString } from 'src/decorators/refuseIfNotSentAsString.decorator'

// Spec 0035, AC-4. The note can name a person, so nothing here is ever logged.
export class RemovalRequestCourierInput {
  @ApiProperty({ type: String })
  @RefuseIfNotSentAsString()
  @IsString()
  reasonId: string

  @ApiProperty({ type: String, required: false, maxLength: 500 })
  @IsOptional()
  @RefuseIfNotSentAsString()
  @IsString()
  @MaxLength(500)
  note?: string
}
