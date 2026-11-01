import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsEmail, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator'

// `@Transform` runs before validation (main.ts sets `transform: true`), so the rules below check the
// cleaned value and the controller receives it cleaned.
const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value)

// What an admin sends to create a rider and their login (spec 0013, AC-1 and AC-3).
export class CourierCreateAdminInput {
  @ApiProperty({ type: String })
  @Transform(trimmed)
  @IsString()
  @Length(1, 255)
  firstName: string

  @ApiProperty({ type: String })
  @Transform(trimmed)
  @IsString()
  @Length(1, 255)
  lastName: string

  // Spaces are removed ("+30 690 000 0000" is fine), then a plus and 8 to 15 digits (E.164).
  @ApiProperty({ type: String, example: '+306900000000' })
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\s+/g, '') : value))
  @IsString()
  @Matches(/^\+\d{8,15}$/, { message: 'phoneNumber must be a plus and 8 to 15 digits' })
  phoneNumber: string

  // Trimmed and lower cased in the service, before the duplicate check.
  @ApiProperty({ type: String })
  @Transform(trimmed)
  @IsEmail()
  @MaxLength(255)
  email: string

  // 8 as restaurant passwords; bcrypt ignores what comes after 72 bytes.
  @ApiProperty({ type: String, minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string
}
