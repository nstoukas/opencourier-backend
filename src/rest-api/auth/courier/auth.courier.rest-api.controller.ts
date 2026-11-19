import * as common from '@nestjs/common'
import { Body, Get, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import * as swagger from '@nestjs/swagger'
import { EnumUserRole } from '@prisma/types'
import { Public } from 'src/decorators/public.decorator'
import { COURIER_API_V1_PREFIX, PUBLIC_DEFAULT_THROTTLE } from '../../../constants'
import { CurrentUser } from '../../../decorators/currentUser.decorator'
import { AuthDomainService } from '../../../domains/auth/auth.domain.service'
import { UserEntity } from '../../../domains/user/entities/user.entity'
import * as errors from '../../../errors'
import { UserInfoCourierDto } from './dtos/user-info.courier.dto'
import { EmailLoginCourierInput } from './queries/email-login.courier.input'
import { PrivateWithRefreshToken } from 'src/decorators/private-with-refresh-token.decorator'
import { Roles } from 'src/decorators/roles.decorator'
import { Request } from 'express'
import { UserWithCourierCourierDto } from './dtos/user-with-courier.courier.dto'
import { AblyTokenDto } from 'src/rest-api/common/dtos/ably-token.dto'
import { ForgotPasswordCourierInput } from './queries/forgot-password.courier.input'
import { ResetPasswordCourierInput } from './queries/reset-password.courier.input'
import { PasswordResetCourierRestApiService } from './password-reset.courier.rest-api.service'

@swagger.ApiBearerAuth()
@swagger.ApiTags('auth')
@common.Controller(`${COURIER_API_V1_PREFIX}/auth`)
export class AuthCourierRestApiController {
  constructor(
    private readonly authDomainService: AuthDomainService,
    private readonly passwordResetCourierRestApiService: PasswordResetCourierRestApiService
  ) {}

  @Public()
  @Post('login')
  @swagger.ApiBody({ type: EmailLoginCourierInput })
  @swagger.ApiOkResponse({ type: UserInfoCourierDto })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @Throttle(PUBLIC_DEFAULT_THROTTLE)
  async login(@Body() body: EmailLoginCourierInput): Promise<UserInfoCourierDto> {
    const result = await this.authDomainService.loginWithEmail(body)
    if (!result.user.role.includes(EnumUserRole.COURIER)) {
      throw new errors.ForbiddenException('You are not allowed to login as courier')
    }
    return new UserInfoCourierDto(result)
  }

  @Post('refresh-tokens')
  @PrivateWithRefreshToken()
  @swagger.ApiBody({ type: EmailLoginCourierInput })
  @swagger.ApiOkResponse({ type: UserInfoCourierDto })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @Roles(EnumUserRole.COURIER)
  async refreshTokens(@CurrentUser() user: UserEntity, @common.Req() req: Request): Promise<UserInfoCourierDto> {
    const result = await this.authDomainService.refreshTokens(user.id, req.headers['x-refresh-token']?.toString() || '')
    // The same answer as login: the new session and the user's id, email and roles, never the
    // whole user row (it carried the password hash and the API key; decision 66.12).
    return new UserInfoCourierDto(result)
  }

  // No public sign up: the co-op issues every rider's login from admin (spec 0013, AC-7).

  // Row 17 (spec 0039, AC-7): asks for a reset code by email. Always 202 with an empty body, so the
  // answer never says whether the email has an account; 400 for a malformed email and 503 when mail
  // is off both come before any lookup. `@HttpCode` replaces Nest's default 201 for a POST.
  @Public()
  @Post('forgot-password')
  @common.HttpCode(202)
  @swagger.ApiBody({ type: ForgotPasswordCourierInput })
  @swagger.ApiAcceptedResponse({ description: 'Always, whether or not the email belongs to a rider' })
  @swagger.ApiServiceUnavailableResponse({ description: 'Mail is not set up on this instance' })
  @Throttle(PUBLIC_DEFAULT_THROTTLE)
  forgotPassword(@Body() body: ForgotPasswordCourierInput): void {
    this.passwordResetCourierRestApiService.forgotPassword(body.email)
  }

  // Row 17 (spec 0039, AC-10 and AC-11): sets a new password with the emailed code and logs the rider
  // in, signing out every other phone. Answers like login.
  @Public()
  @Post('reset-password')
  @common.HttpCode(200)
  @swagger.ApiBody({ type: ResetPasswordCourierInput })
  @swagger.ApiOkResponse({ type: UserInfoCourierDto })
  @swagger.ApiBadRequestResponse({ type: errors.BadRequestException })
  @Throttle(PUBLIC_DEFAULT_THROTTLE)
  async resetPassword(@Body() body: ResetPasswordCourierInput): Promise<UserInfoCourierDto> {
    return this.passwordResetCourierRestApiService.resetPassword(body.email, body.code, body.password)
  }

  @Get('me')
  @swagger.ApiOkResponse({ type: UserWithCourierCourierDto })
  @swagger.ApiForbiddenResponse({
    type: errors.ForbiddenException,
  })
  async getMe(@CurrentUser() user: UserEntity): Promise<UserWithCourierCourierDto> {
    const data = await this.authDomainService.getMeWithCourier(user.id)
    return new UserWithCourierCourierDto(data.user, data.courier)
  }

  @common.Get('ably-token')
  @swagger.ApiOkResponse({ type: AblyTokenDto })
  @swagger.ApiForbiddenResponse({
    type: errors.ForbiddenException,
  })
  async getAblyToken(@CurrentUser() user: UserEntity): Promise<AblyTokenDto> {
    const tokenRequest = await this.authDomainService.getAblyToken(user)
    return new AblyTokenDto(tokenRequest)
  }
}
