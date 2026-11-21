import { ApiProperty } from '@nestjs/swagger'
import { EnumCourierDeliverySetting, EnumCourierStatus, EnumStripeAccountStatus } from '@prisma/types'
import { IsEmail, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator'
import { ICourierUpdate } from '../../../../domains/courier/interfaces/ICourierUpdate'

export class CourierUpdateAdminInput implements ICourierUpdate {
  @ApiProperty({
    required: true,
    type: String,
  })
  @IsString()
  firstName: string

  @ApiProperty({
    required: true,
    type: String,
  })
  @IsString()
  lastName: string

  @ApiProperty({
    required: false,
    type: String,
  })
  @IsString()
  @IsOptional()
  node_uri: string

  @ApiProperty({
    required: false,
    type: String,
  })
  @IsString()
  @IsOptional()
  phoneNumber: string | null

  @ApiProperty({
    required: false,
    enum: EnumCourierStatus,
  })
  @IsEnum(EnumCourierStatus)
  @IsOptional()
  status: EnumCourierStatus

  @ApiProperty({
    required: false,
    enum: EnumCourierDeliverySetting,
  })
  @IsEnum(EnumCourierDeliverySetting)
  @IsOptional()
  deliverySetting: EnumCourierDeliverySetting

  @ApiProperty({
    required: false,
    type: String,
  })
  @IsString()
  @IsOptional()
  stripeAccountId: string | null

  @ApiProperty({
    required: false,
    enum: EnumStripeAccountStatus,
  })
  @IsEnum(EnumStripeAccountStatus)
  @IsOptional()
  stripeAccountStatus: EnumStripeAccountStatus

  // Spec 0051 (AC-4): the login email (unique ignoring case; a change ends the rider's sessions) and the
  // emergency contact. node_uri and the Stripe fields above stay in this class for older clients, but the
  // edit no longer saves them (cross check 11).
  @ApiProperty({ required: false, type: String })
  @IsEmail()
  @IsOptional()
  email?: string

  @ApiProperty({ required: false, type: String, nullable: true, maxLength: 120 })
  @IsString()
  @MaxLength(120)
  @IsOptional()
  emergencyContactName?: string | null

  @ApiProperty({ required: false, type: String, nullable: true, maxLength: 32 })
  @IsString()
  @MaxLength(32)
  @IsOptional()
  emergencyContactPhone?: string | null
}
