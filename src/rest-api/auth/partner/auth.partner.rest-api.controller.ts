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
import { Throttle } from '@nestjs/throttler'
import { PUBLIC_DEFAULT_THROTTLE } from '../../../constants'
import { ForgotPasswordPartnerInput, ResetPasswordPartnerInput } from './queries/password-reset.partner.input'
import { PasswordResetPartnerRestApiService } from './password-reset.partner.rest-api.service'
import { PasswordResetPartnerDto } from './dtos/password-reset.partner.dto'

@swagger.ApiBearerAuth()
@swagger.ApiTags('auth')
@common.Controller(`${PARTNER_API_V1_PREFIX}/auth`)
export class AuthPartnerRestApiController {
  constructor(
    private readonly authDomainService: AuthDomainService,
    private readonly partnerRepository: PartnerRepository,
    private readonly passwordResetPartnerRestApiService: PasswordResetPartnerRestApiService
  ) {}

  // Row 153 (spec 0039's rider flow, for restaurants): asks for a reset code by email. Always 202 with an empty
  // body, so the answer never says whether the email has an account; 400 for a malformed email and 503 when mail
  // is off both come before any lookup.
  @Public()
  @Post('forgot-password')
  @common.HttpCode(202)
  @swagger.ApiBody({ type: ForgotPasswordPartnerInput })
  @swagger.ApiAcceptedResponse({ description: 'Always, whether or not the email belongs to a restaurant' })
  @swagger.ApiServiceUnavailableResponse({ description: 'Mail is not set up on this instance' })
  @Throttle(PUBLIC_DEFAULT_THROTTLE)
  forgotPassword(@Body() body: ForgotPasswordPartnerInput): void {
    this.passwordResetPartnerRestApiService.forgotPassword(body.email)
  }

  // Row 153: sets a new password with the emailed code. Every older session of the restaurant stops working and
  // its API key, if any, is switched off; it then signs in with the new password.
  @Public()
  @Post('reset-password')
  @common.HttpCode(200)
  @swagger.ApiBody({ type: ResetPasswordPartnerInput })
  @swagger.ApiOkResponse({ type: PasswordResetPartnerDto })
  @swagger.ApiBadRequestResponse({ type: errors.BadRequestException })
  @Throttle(PUBLIC_DEFAULT_THROTTLE)
  async resetPassword(@Body() body: ResetPasswordPartnerInput): Promise<PasswordResetPartnerDto> {
    const { apiKeyRemoved } = await this.passwordResetPartnerRestApiService.resetPassword(
      body.email,
      body.code,
      body.password
    )
    return new PasswordResetPartnerDto(apiKeyRemoved)
  }

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
