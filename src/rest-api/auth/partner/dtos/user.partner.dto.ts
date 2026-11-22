import { Language } from 'src/localization/translate'
import { ApiProperty } from '@nestjs/swagger'
import { IsInt, IsEmail, IsEnum } from 'class-validator'
import { EnumUserRole } from '@prisma/types'
import { UserEntity } from '../../../../domains/user/entities/user.entity'

export class UserPartnerDto implements Partial<UserEntity> {
  @ApiProperty({
    required: true,
    type: String,
  })
  @IsInt()
  id: string

  @ApiProperty({
    required: true,
    enum: EnumUserRole,
  })
  @IsEnum(EnumUserRole)
  role: EnumUserRole[]

  @ApiProperty({
    required: true,
    nullable: true,
    type: String,
  })
  @IsEmail()
  email: string | null

  // Spec 0023: the restaurant's usual prep time, which the order form starts from; null when the
  // user has no restaurant.
  @ApiProperty({ required: true, nullable: true, type: Number })
  usualPrepMinutes: number | null

  // Spec 0054: the language this person chose ('el' or 'en'), so an app starts in it after sign in.
  @ApiProperty({ required: true, enum: ['el', 'en'] })
  language: Language

  constructor(data: UserEntity, usualPrepMinutes: number | null = null) {
    this.email = data.email
    this.role = data.role
    this.language = data.language
    this.id = data.id
    this.usualPrepMinutes = usualPrepMinutes
  }
}
