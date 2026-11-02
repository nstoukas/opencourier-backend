import { ApiProperty } from '@nestjs/swagger'
import { EnumSosOutcome } from '@prisma/types'
import { IsEnum, IsString, MaxLength, ValidateIf } from 'class-validator'

// An admin's close (spec 0022, AC-10): what happened, and an optional note.
export class SosCloseAdminInput {
  @ApiProperty({ enum: EnumSosOutcome, required: true })
  @IsEnum(EnumSosOutcome)
  outcome: EnumSosOutcome

  @ApiProperty({ type: String, required: false, maxLength: 500 })
  // Left out or null is no note; anything else must be text of 500 characters at most.
  @ValidateIf((_input, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(500)
  note?: string | null
}
