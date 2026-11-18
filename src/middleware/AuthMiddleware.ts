import { Injectable, NestMiddleware } from '@nestjs/common'
import { Response, NextFunction } from 'express'
import { AuthDomainService } from '../domains/auth/auth.domain.service'
import { AuthedRequest } from '../core/models/AuthedRequest'
import { isRecordNotFoundError } from '../prisma.util'
import { JsonWebTokenError } from '@nestjs/jwt'
import { JwtExpiredException, UnauthorizedException } from '../errors'
import { TokenExpiredError } from 'jsonwebtoken'
import { CourierDomainService } from 'src/domains/courier/courier.domain.service'
import { EnumUserRole } from '@prisma/types'
import { PartnerDomainService } from 'src/domains/partner/partner.domain.service'

// The 401's sentence when a request carries an API key and a login token together (row 113).
export const MIXED_CREDENTIALS_MESSAGE = 'Send either an API key or a login token, not both'

// "Bearer <token>" as passport-jwt reads it: the word in any case, then any whitespace (row 113 review).
export const BEARER_SCHEME = /^\s*bearer\s+/i

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    private readonly authService: AuthDomainService,
    private readonly courierDomainService: CourierDomainService,
    private readonly partnerDomainService: PartnerDomainService
  ) {}

  async use(req: AuthedRequest, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization ?? ''
    const refreshToken = req.headers['x-refresh-token']?.toString() ?? ''
    const apiKey = req.headers['x-api-key']?.toString() ?? req.query.api_key?.toString() ?? ''

    // The route's JWT guard (passport-jwt) reads the scheme in any case with any spacing ("bearer",
    // "BEARER", a tab), so this reads it the same way: a token passport would accept is always looked
    // up here too, with its checks (spec 0013), never skipped for its spelling (row 113 review).
    const hasBearer = BEARER_SCHEME.test(authHeader)

    if (!hasBearer && !refreshToken && !apiKey) {
      return next()
    }

    // Row 113: an API key sent beside any Authorization header or a refresh token is refused, whatever
    // the route. The key would win below, while the route's JWT guard only checks that some valid token
    // came, so any login plus a restaurant's key acted as that restaurant. One credential per request:
    // never guess which one.
    if (apiKey && (authHeader.trim() !== '' || refreshToken)) {
      next(new UnauthorizedException(MIXED_CREDENTIALS_MESSAGE))
      return
    }

    try {
      let user
      if (refreshToken) {
        user = await this.findUserForRefreshToken(refreshToken)
      } else if (apiKey) {
        user = await this.findUserForApiKey(apiKey)
      } else {
        user = await this.findUserForAuthorizationHeader(authHeader)
      }

      req.currentUser = user

      if (user.role.includes(EnumUserRole.COURIER)) {
        const courier = await this.courierDomainService.getByUserId(user.id)
        req.currentCourier = courier
      }

      if (user.role.includes(EnumUserRole.PARTNER)) {
        const partner = await this.partnerDomainService.getByUserId(user.id)
        req.currentPartner = partner
      }
    } catch (error) {
      console.log(error)
      if (error instanceof TokenExpiredError) {
        next(new JwtExpiredException('Unauthorized'))
        return
      } else if (error instanceof JsonWebTokenError || (error instanceof Error && isRecordNotFoundError(error))) {
        next(new UnauthorizedException('Unauthorized'))
        return
      } else {
        next(error)
        return
      }
    }

    next()
  }

  async findUserForAuthorizationHeader(authorizationHeader: string) {
    return this.authService.userForAuthorizationHeader(authorizationHeader)
  }

  async findUserForRefreshToken(refreshToken: string) {
    return this.authService.userForRefreshToken(refreshToken)
  }

  async findUserForApiKey(apiKey: string) {
    return this.authService.userForApiKey(apiKey)
  }
}
