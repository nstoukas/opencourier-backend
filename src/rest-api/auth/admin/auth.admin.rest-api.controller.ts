import * as common from '@nestjs/common'
import { LanguageDto, LanguageInput } from 'src/rest-api/common/dtos/language.dto'
import { Body, Get, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import * as swagger from '@nestjs/swagger'
import { EnumUserRole } from '@prisma/types'
import { Public } from 'src/decorators/public.decorator'
import { Roles } from 'src/decorators/roles.decorator'
import { ADMIN_API_V1_PREFIX, PUBLIC_DEFAULT_THROTTLE } from '../../../constants'
import { CurrentUser } from '../../../decorators/currentUser.decorator'
import { AuthDomainService } from '../../../domains/auth/auth.domain.service'
import { UserEntity } from '../../../domains/user/entities/user.entity'
import * as errors from '../../../errors'
import { UserInfoAdminDto } from './dtos/user-info.admin.dto'
import { UserAdminDto } from './dtos/user.admin.dto'
import { EmailLoginAdminInput } from './queries/email-login.admin.input'

@swagger.ApiBearerAuth()
@swagger.ApiTags('auth')
@common.Controller(`${ADMIN_API_V1_PREFIX}/auth`)
export class AuthAdminRestApiController {
  constructor(private readonly authDomainService: AuthDomainService) {}

  @Public()
  @Post('login')
  @swagger.ApiBody({ type: EmailLoginAdminInput })
  @swagger.ApiOkResponse({ type: UserInfoAdminDto })
  @swagger.ApiOperation({ summary: 'Login as admin' })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @Throttle(PUBLIC_DEFAULT_THROTTLE)
  async login(@Body() body: EmailLoginAdminInput): Promise<UserInfoAdminDto> {
    const result = await this.authDomainService.loginWithEmail(body)
    if (!result.user.role.includes(EnumUserRole.ADMIN)) {
      throw new errors.ForbiddenException('You are not allowed to login as admin')
    }
    return new UserInfoAdminDto(result)
  }

  @Get('me')
  @swagger.ApiOkResponse({ type: UserAdminDto })
  @swagger.ApiOperation({ summary: 'Return current user data' })
  @swagger.ApiForbiddenResponse({
    type: errors.ForbiddenException,
  })
  async getMe(@CurrentUser() user: UserEntity): Promise<UserAdminDto> {
    const me = await this.authDomainService.getMe(user.id)
    return new UserAdminDto(me)
  }

  // Spec 0054 (AC-2): saves the language chosen in the header's switch, so the next sign in (and mails)
  // use it. The web app keeps its own cookie too, for the first page before sign in.
  @common.Put('language')
  @swagger.ApiBody({ type: LanguageInput })
  @swagger.ApiOkResponse({ type: LanguageDto })
  @Roles(EnumUserRole.ADMIN)
  async setLanguage(@CurrentUser() user: UserEntity, @common.Body() body: LanguageInput): Promise<LanguageDto> {
    await this.authDomainService.setLanguage(user.id, body.language)
    return new LanguageDto(body.language)
  }
}
