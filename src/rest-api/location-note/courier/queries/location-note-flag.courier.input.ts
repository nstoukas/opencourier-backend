import { ApiProperty } from '@nestjs/swagger'
import { IsOptional, IsString, MaxLength } from 'class-validator'
import { RefuseIfNotSentAsString } from 'src/decorators/refuseIfNotSentAsString.decorator'

// Spec 0053 (AC-7): a rider flags a note for an admin to look at, with an optional reason.
export class LocationNoteFlagCourierInput {
  @ApiProperty({ required: false, type: String, nullable: true, maxLength: 200 })
  @IsOptional()
  @IsString()
  @RefuseIfNotSentAsString({ allowNull: true })
  @MaxLength(200)
  reason?: string | null
}
