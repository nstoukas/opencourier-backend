import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { IS_API_KEY_AUTH } from 'src/decorators/api-key-auth.decorator'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import { UserRepository } from 'src/persistence/repositories/user.repository'

@Injectable()
export class AuthApiKeyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly userRepository: UserRepository) {}

  async canActivate(context: ExecutionContext) {
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
    if (req.currentUser instanceof UserEntity) {
      return true
    }

    const key = req.headers['x-api-key'] ?? req.query.api_key

    if (!key) {
      return false
    }

    const user = await this.userRepository.findByApiKey(key)

    if (!user) {
      return false
    }

    req.currentUser = user
    return true
  }
}
