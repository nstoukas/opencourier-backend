import { PartnerRepository } from 'src/persistence/repositories/partner.repository'
import { LanguageDto, LanguageInput } from 'src/rest-api/common/dtos/language.dto'
import * as common from '@nestjs/common'
import { Body, Get, Post } from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { EnumUserRole } from '@prisma/types'
import { PARTNER_API_V1_PREFIX } from '../../../constants'
import { CurrentUser } from '../../../decorators/currentUser.decorator'
import { AuthDomainService } from '../../../domains/auth/auth.domain.service'
import { UserEntity } from '../../../domains/user/entities/user.entity'
import * as errors from '../../../errors'
import { UserPartnerDto } from './dtos/user.partner.dto'
import { UserInfoPartnerDto } from './dtos/user-info.partner.dto'
import { ApiKeyAuth } from 'src/decorators/api-key-auth.decorator'
import { Roles } from 'src/decorators/roles.decorator'
import { UsernameLoginPartnerInput } from './queries/username-login.partner.input'
import { Public } from 'src/decorators/public.decorator'

@swagger.ApiBearerAuth()
@swagger.ApiTags('auth')
@common.Controller(`${PARTNER_API_V1_PREFIX}/auth`)
export class AuthPartnerRestApiController {
  constructor(
    private readonly authDomainService: AuthDomainService,
    private readonly partnerRepository: PartnerRepository
  ) {}

  @Post('login')
  @Public()
  @swagger.ApiOkResponse({ type: UserInfoPartnerDto })
  @swagger.ApiOperation({ summary: 'Sign in with partner username and password' })
  @swagger.ApiForbiddenResponse({
    type: errors.ForbiddenException,
  })
  async login(@Body() body: UsernameLoginPartnerInput): Promise<UserInfoPartnerDto> {
    const result = await this.authDomainService.loginPartnerWithUsername(body)

    if (!result.user.role.includes(EnumUserRole.PARTNER)) {
      throw new errors.ForbiddenException('You are not allowed to login as partner')
    }

    return new UserInfoPartnerDto(result)
  }

  @Get('me')
  @swagger.ApiOkResponse({ type: UserPartnerDto })
  @swagger.ApiOperation({ summary: 'Return current user data' })
  @swagger.ApiForbiddenResponse({
    type: errors.ForbiddenException,
  })
  @ApiKeyAuth()
  @Roles(EnumUserRole.PARTNER)
  async getMe(@CurrentUser() user: UserEntity): Promise<UserPartnerDto> {
    const me = await this.authDomainService.getMe(user.id)
    // The restaurant is found by its user (Partner.userId is unique), for its usual prep time.
    const partner = await this.partnerRepository.findByUserId(user.id)
    return new UserPartnerDto(me, partner?.usualPrepMinutes ?? null)
  }

  // Spec 0054 (AC-2): saves the language chosen in the header's switch, so the next sign in (and mails)
  // use it. The web app keeps its own cookie too, for the first page before sign in.
  @common.Put('language')
  @swagger.ApiBody({ type: LanguageInput })
  @swagger.ApiOkResponse({ type: LanguageDto })
  @Roles(EnumUserRole.PARTNER)
  async setLanguage(@CurrentUser() user: UserEntity, @common.Body() body: LanguageInput): Promise<LanguageDto> {
    await this.authDomainService.setLanguage(user.id, body.language)
    return new LanguageDto(body.language)
  }
}
