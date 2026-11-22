import { Injectable, Logger } from '@nestjs/common'
import { Language } from 'src/localization/translate'
import { EnumUserRole } from '@prisma/types'
import { assign } from 'lodash'
import { AblyService } from 'src/integrations/ably/ably.service'
import * as errors from '../../errors'
import { isRecordNotFoundError } from '../../prisma.util'
import { CourierDomainService } from '../courier/courier.domain.service'
import { PartnerDomainService } from '../partner/partner.domain.service'
import { UserEntity } from '../user/entities/user.entity'
import { IUserUpdate } from '../user/interfaces/IUserUpdate'
import { UserDomainService } from '../user/user.domain.service'
import { IEmailLogin } from './interfaces/IEmailLogin'
import { PasswordService } from './password.service'
import { TokenService } from './token.service'
import { API_KEY_DOES_NOT_WORK_MESSAGE, hashApiKey } from './api-key'
import {
  CREDENTIALS_CHANGED_MESSAGE,
  accountDeactivatedMessage,
  isIssuedBeforeCredentialsChange,
} from './credentials-change'
import { ConfigDomainService } from '../config/config.domain.service'

@Injectable()
export class AuthDomainService {
  private readonly logger = new Logger(AuthDomainService.name)

  constructor(
    private userDomainService: UserDomainService,
    private courierDomainService: CourierDomainService,
    private partnerDomainService: PartnerDomainService,
    private passwordService: PasswordService,
    private tokenService: TokenService,
    private ablyService: AblyService,
    // Spec 0051. Optional (`?`) only so tests that build this service by hand keep compiling; Nest always
    // injects it. Without it, the deactivated message says "contact the co-op".
    private configDomainService?: ConfigDomainService
  ) {}

  // Spec 0051 (AC-2, cross check 2): every door refuses a deactivated rider with ACCOUNT_DEACTIVATED, before
  // the credentials changed check, so the app always learns the real reason. Users with no rider pass.
  async refuseIfDeactivated(user: { id: string; role: EnumUserRole[] }): Promise<void> {
    if (!user.role.includes(EnumUserRole.COURIER)) return
    if (!(await this.courierDomainService.isUserDeactivated(user.id))) return
    let phone: string | null = null
    try {
      phone = (await this.configDomainService?.instanceConfig.getDispatchPhoneNumber()) ?? null
    } catch {
      // The message still goes out, with the plain words.
    }
    throw new errors.AccountDeactivatedException(accountDeactivatedMessage(phone))
  }

  async verifyUniqueEmailInput(email: string) {
    const result = await this.userDomainService.findUserWithEmail(email)

    if (result) {
      throw new errors.UserExistsException('A user with this email already exists')
    }

    return { body: 'valid' }
  }

  async loginWithEmail(input: IEmailLogin) {
    const { email, password } = input

    // The email as typed first (today's behavior), then trimmed and lower cased, the form the
    // admin stores (spec 0013, AC-8). A stored email with capitals still logs in.
    let user = await this.validateUser(password, email)
    const normalised = email.trim().toLowerCase()
    // Only when no account has the email exactly as typed: after a wrong password on that account,
    // trying another account that differs only in capitals would log in to the wrong one (row 16
    // review).
    if (!user && normalised !== email && !(await this.userDomainService.findUserWithEmail(email))) {
      user = await this.validateUser(password, normalised)
    }

    if (!user) {
      throw new errors.ForbiddenException('These credentials are incorrect')
    }
    // Spec 0051: only after the password was proven, so a stranger learns nothing about the account.
    await this.refuseIfDeactivated(user)

    // The token carries the stored email, never the typed one: every later request, refresh and
    // socket handshake looks the user up by it, exactly (spec 0013, cross check).
    const session = await this.tokenService.createEmailAuthSession({
      sub: user.id,
      email: user.email || '',
      role: user.role,
    })

    return assign({
      session,
      user,
    })
  }

  // A session for a user whose identity was proven some other way than a password: a rider's reset
  // by emailed code (row 17, spec 0039, AC-10). The same token contents as loginWithEmail.
  async createSessionForUser(user: UserEntity) {
    await this.refuseIfDeactivated(user)
    const session = await this.tokenService.createEmailAuthSession({
      sub: user.id,
      email: user.email || '',
      role: user.role,
    })
    return { session, user }
  }

  async loginPartnerWithUsername(input: { email: string; password: string }) {
    const { email, password } = input
    const user = await this.validateUser(password, email)

    if (!user) {
      throw new errors.ForbiddenException('These credentials are incorrect')
    }

    if (!user.role.includes(EnumUserRole.PARTNER)) {
      throw new errors.ForbiddenException('You are not allowed to login as partner')
    }

    // Spec 0037, AC-2 and AC-8: signing in never makes or returns an API key. Only an admin makes one,
    // seen once, so the password no longer unlocks the key.
    const session = await this.tokenService.createEmailAuthSession({
      sub: user.id,
      email: user.email || '',
      role: user.role,
    })

    return assign({
      session,
      user,
    })
  }

  async refreshTokens(userId: string, refreshToken: string) {
    const payload = this.tokenService.decodeRefreshToken(refreshToken)

    if (payload.sub !== userId) {
      throw new errors.ForbiddenException('Invalid refresh token')
    }

    const user = await this.userDomainService.findById(userId)
    await this.refuseIfDeactivated(user)

    const session = await this.tokenService.createEmailAuthSession({
      sub: user.id,
      email: user.email || '',
      role: user.role,
    })

    return assign({
      session,
      user,
    })
  }

  // Spec 0054 (AC-2): the language a restaurant or an admin chose in the web app's header.
  async setLanguage(userId: string, language: Language): Promise<void> {
    await this.userDomainService.setLanguage(userId, language)
  }

  async getMe(userId: string) {
    try {
      return this.userDomainService.findById(userId)
    } catch (error) {
      if (error instanceof Error && isRecordNotFoundError(error)) {
        throw new errors.ForbiddenException(`User with ID ${userId} does not exist`)
      }
      throw error
    }
  }

  async getMeWithCourier(userId: string) {
    const user = await this.getMe(userId)
    const courier = await this.courierDomainService.getByUserId(user.id)

    return {
      user,
      courier,
    }
  }

  async updateMe(user: UserEntity, data: IUserUpdate) {
    return this.userDomainService.updateMe(user, data)
  }

  async deleteMe(user: UserEntity) {
    return this.userDomainService.deleteMe(user)
  }

  async userForAuthorizationHeader(authorization = '') {
    try {
      // The scheme in any case with any spacing, as passport-jwt reads it (row 113 review).
      const bearer = authorization.replace(/^\s*bearer\s+/i, '')
      const payload = this.tokenService.decodeToken(bearer)

      const user = await this.userDomainService.findById(payload.sub)
      // Spec 0051: deactivated first, so the app learns the real reason.
      await this.refuseIfDeactivated(user)
      // Spec 0013: a token from before an admin set a new password is refused with 401.
      this.refuseIfIssuedBeforeCredentialsChange(payload, user)

      return user
    } catch (error) {
      if (error instanceof Error && isRecordNotFoundError(error)) {
        throw new errors.ForbiddenException('User not found from authorization header')
      }
      throw error
    }
  }

  async userForRefreshToken(authorization = '') {
    try {
      // The scheme in any case with any spacing, as passport-jwt reads it (row 113 review).
      const bearer = authorization.replace(/^\s*bearer\s+/i, '')
      const payload = this.tokenService.decodeRefreshToken(bearer)

      const user = await this.userDomainService.findById(payload.sub)
      await this.refuseIfDeactivated(user)
      // Spec 0013: a refresh token from before an admin set a new password is refused with 401,
      // so the app's renewal fails and it ends the session.
      this.refuseIfIssuedBeforeCredentialsChange(payload, user)

      return user
    } catch (error) {
      if (error instanceof Error && isRecordNotFoundError(error)) {
        throw new errors.ForbiddenException('User not found from refresh token')
      }
      throw error
    }
  }

  // `iat` is not on the payload types, but jsonwebtoken always signs it; read it as unknown.
  private refuseIfIssuedBeforeCredentialsChange(payload: object, user: UserEntity) {
    const iat = (payload as { iat?: unknown }).iat
    if (isIssuedBeforeCredentialsChange(iat, user.credentialsChangedAt)) {
      // Spec 0051 (cross check 3): its own code, so the app can say why.
      throw new errors.CredentialsChangedException(CREDENTIALS_CHANGED_MESSAGE)
    }
  }

  // Spec 0037: the sent key is hashed, then looked up; the database holds only hashes. An unknown,
  // replaced or removed key is refused with 401 (AC-10).
  async userForApiKey(apiKey = '') {
    const user = await this.userDomainService.findByApiKeyHash(hashApiKey(apiKey))

    if (!user) {
      throw new errors.UnauthorizedException(API_KEY_DOES_NOT_WORK_MESSAGE)
    }

    return user
  }

  async getAblyToken(user: UserEntity) {
    return this.ablyService.createToken(user)
  }

  private async validateUser(password: string, email: string) {
    try {
      const user = await this.userDomainService.findByEmail(email)

      if (user.password && (await this.passwordService.compare(password, user.password))) {
        return user
      }
    } catch (error) {
      if (error instanceof Error && isRecordNotFoundError(error)) {
        return null
      }
      throw error
    }
  }

  private async validateUserByUsername(password: string, username: string) {
    try {
      const user = await this.userDomainService.findByUsername(username)

      if (user.password && (await this.passwordService.compare(password, user.password))) {
        return user
      }
    } catch {
      return null
    }

    return null
  }
}
