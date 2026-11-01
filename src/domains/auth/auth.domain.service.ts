import { Injectable, Logger } from '@nestjs/common'
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
import { randomBytes } from 'crypto'
import { CREDENTIALS_CHANGED_MESSAGE, isIssuedBeforeCredentialsChange } from './credentials-change'

@Injectable()
export class AuthDomainService {
  private readonly logger = new Logger(AuthDomainService.name)

  constructor(
    private userDomainService: UserDomainService,
    private courierDomainService: CourierDomainService,
    private partnerDomainService: PartnerDomainService,
    private passwordService: PasswordService,
    private tokenService: TokenService,
    private ablyService: AblyService
  ) {}

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

  async loginPartnerWithUsername(input: { email: string; password: string }) {
    const { email, password } = input
    const user = await this.validateUser(password, email)

    if (!user) {
      throw new errors.ForbiddenException('These credentials are incorrect')
    }

    if (!user.role.includes(EnumUserRole.PARTNER)) {
      throw new errors.ForbiddenException('You are not allowed to login as partner')
    }

    const apiKey = await this.ensurePartnerApiKey(user)

    const session = await this.tokenService.createEmailAuthSession({
      sub: user.id,
      email: user.email || '',
      role: user.role,
    })

    return assign({
      session,
      user: assign(user, { apiKey }),
    })
  }

  async refreshTokens(userId: string, refreshToken: string) {
    const payload = this.tokenService.decodeRefreshToken(refreshToken)

    if (payload.sub !== userId) {
      throw new errors.ForbiddenException('Invalid refresh token')
    }

    const user = await this.userDomainService.findById(userId)

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
      const bearer = authorization.replace(/^Bearer\s/, '')
      const payload = this.tokenService.decodeToken(bearer)

      const user = await this.userDomainService.findById(payload.sub)
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
      const bearer = authorization.replace(/^Bearer\s/, '')
      const payload = this.tokenService.decodeRefreshToken(bearer)

      const user = await this.userDomainService.findById(payload.sub)
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
      throw new errors.UnauthorizedException(CREDENTIALS_CHANGED_MESSAGE)
    }
  }

  async userForApiKey(apiKey = '') {
    const user = await this.userDomainService.findByApiKey(apiKey)

    if (!user) {
      throw new errors.ForbiddenException('User not found from apiKey')
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

  private async ensurePartnerApiKey(user: UserEntity) {
    if (user.apiKey) return user.apiKey

    const apiKey = this.generateApiKey()
    const updatedUser = await this.userDomainService.updateMe(user, { apiKey })
    return updatedUser.apiKey || apiKey
  }

  generateApiKey() {
    return randomBytes(96).toString('hex')
  }
}
