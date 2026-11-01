import { ApiProperty } from '@nestjs/swagger'
import { IsString, MaxLength, MinLength } from 'class-validator'

// A new password an admin sets for a rider (spec 0013, AC-4). Same rule as at creation.
export class CourierRotatePasswordAdminInput {
  @ApiProperty({ type: String, minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string
}
