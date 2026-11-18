import { ApiProperty } from '@nestjs/swagger'
import { ValidateNested } from 'class-validator'
import { UserSessionPartnerDto } from './user-session.partner.dto'
import { Type } from 'class-transformer'
import { UserPartnerDto } from './user.partner.dto'
import { UserSessionEntity } from '../../../../domains/auth/entities/user-session.entity'
import { UserEntity } from '../../../../domains/user/entities/user.entity'

export class UserInfoPartnerDto extends UserPartnerDto {
  @ApiProperty({
    required: false,
    type: UserSessionPartnerDto,
  })
  @ValidateNested()
  @Type(() => UserSessionPartnerDto)
  session?: UserSessionPartnerDto

  // No `apiKey` field (spec 0037, AC-2): signing in no longer hands out the restaurant's API key, so
  // the password does not unlock it. Only an admin makes a key, and sees it once.

  constructor(data: { session: UserSessionEntity; user: UserEntity }) {
    super(data.user)
    this.session = new UserSessionPartnerDto(data.session)
  }
}
