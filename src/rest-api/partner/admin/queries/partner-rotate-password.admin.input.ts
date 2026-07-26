import { ApiProperty } from '@nestjs/swagger'
import { IsString, MinLength } from 'class-validator'

export class PartnerRotatePasswordAdminInput {
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(8)
  password: string
}
