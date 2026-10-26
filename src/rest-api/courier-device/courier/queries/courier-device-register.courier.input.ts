import { ApiProperty } from '@nestjs/swagger'
import { EnumDevicePlatform } from '@prisma/types'
import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator'

// The body of POST /api/courier/v1/devices (spec 0003). Anything missing or of the wrong type is
// refused with a 400 by the global ValidationPipe before the controller runs.
export class CourierDeviceRegisterCourierInput {
  @ApiProperty({ required: true, description: 'The push token Firebase gave this app install' })
  @IsString()
  @IsNotEmpty()
  // An FCM token is about 160 characters; the cap only keeps junk out of the table.
  @MaxLength(4096)
  token: string

  @ApiProperty({ required: true, enum: EnumDevicePlatform })
  @IsEnum(EnumDevicePlatform)
  platform: EnumDevicePlatform
}
