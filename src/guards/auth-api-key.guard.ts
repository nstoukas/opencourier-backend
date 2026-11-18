import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { IS_API_KEY_AUTH } from 'src/decorators/api-key-auth.decorator'
import { UserEntity } from 'src/domains/user/entities/user.entity'

@Injectable()
export class AuthApiKeyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isApiKey = this.reflector.get<boolean>(IS_API_KEY_AUTH, context.getHandler())

    if (!isApiKey) {
      return true
    }

    const req = context.switchToHttp().getRequest()

    // AuthMiddleware runs before every guard and has already turned whichever credential
    // was sent (Bearer token, refresh token or API key) into req.currentUser. If it did,
    // this request is authenticated — @Roles() below decides whether THIS user may call
    // THIS route. We use `instanceof UserEntity` so this guard agrees exactly with
    // RolesGuard, which makes the same check.
    // Note: This includes bearer, API-key, and refresh-token credentials as set by AuthMiddleware.
    // Spec 0037: AuthMiddleware is the one place a key is looked up (hashed first). It runs on every
    // route before any guard and refuses an unknown key with 401, so with no user here nothing else
    // can find one: the request is simply not signed in.
    return req.currentUser instanceof UserEntity
  }
}
