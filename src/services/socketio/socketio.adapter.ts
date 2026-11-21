import {
  CREDENTIALS_CHANGED_MESSAGE,
  accountDeactivatedMessage,
  isIssuedBeforeCredentialsChange,
} from 'src/domains/auth/credentials-change'
import { IoAdapter } from '@nestjs/platform-socket.io'
import { Server, ServerOptions } from 'socket.io'
import { INestApplicationContext, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { AccountDeactivatedException, CredentialsChangedException, ErrorCode, ForbiddenException } from 'src/errors'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import { SOCKET_GATEWAY_NAMESPACE } from './socketio.gateway'
import { ADMIN_SOCKET_NAMESPACE } from './admin-socket.gateway'
import { UserRepository } from 'src/persistence/repositories/user.repository'
import { EnumUserRole } from '@prisma/types'
import { ExtendedError } from 'socket.io/dist/namespace'

export class SocketIOAdapter extends IoAdapter {
  private readonly logger = new Logger(SocketIOAdapter.name)

  constructor(private readonly app: INestApplicationContext, private readonly configService: ConfigService) {
    super(app)
  }

  createIOServer(port: number, options: ServerOptions) {
    const cors = {
      origin: ['*'],
    }

    this.logger.log(`SocketIOAdapter: createIOServer with custom options: ${JSON.stringify(options)}`)

    const optionsWithCors = {
      ...options,
      cors,
    }

    const jwtService = this.app.get(JwtService)
    const userRepository = this.app.get(UserRepository)
    const courierRepository = this.app.get(CourierRepository)

    const server: Server = super.createIOServer(port, optionsWithCors)

    server
      .of(SOCKET_GATEWAY_NAMESPACE)
      .use(createTokenMiddleware(jwtService, userRepository, this.logger, {}, courierRepository))
    // Spec 0034 (chat), AC-21: the same token check, and the stored user must be an admin.
    server
      .of(ADMIN_SOCKET_NAMESPACE)
      .use(createTokenMiddleware(jwtService, userRepository, this.logger, { adminOnly: true }, courierRepository))

    return server
  }
}

const createTokenMiddleware =
  (
    jwtService: JwtService,
    userRepository: UserRepository,
    logger: Logger,
    options: { adminOnly?: boolean } = {},
    // Spec 0051: optional so the existing tests that build the middleware keep compiling.
    courierRepository?: CourierRepository
  ) =>
  async (socket: any, next: (err?: ExtendedError | undefined) => void) => {
    const authHeader = socket.handshake.auth.authorization || socket.handshake.headers['authorization']

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(new ForbiddenException('Invalid token'))
    }

    const token = authHeader.replace(/^Bearer\s/, '')

    // Never log the token itself: it is a live login credential.
    logger.debug('Validating auth token before connection')

    try {
      const payload = jwtService.verify(token)

      const user = await userRepository.findUserWithEmail(payload.email)
      socket.user = user
      if (!user) {
        return next(new ForbiddenException('User not found'))
      }
      // Spec 0051 (AC-2, cross check 2): a deactivated rider cannot connect; checked before the credentials
      // change, and the code travels in the error's data, where socket.io clients read it.
      if (
        courierRepository &&
        user.role.includes(EnumUserRole.COURIER) &&
        (await courierRepository.isUserDeactivated(user.id))
      ) {
        const refused: ExtendedError = new AccountDeactivatedException(accountDeactivatedMessage(null))
        refused.data = { code: ErrorCode.ACCOUNT_DEACTIVATED }
        return next(refused)
      }
      // Spec 0013: a token from before an admin set a new password cannot open a connection.
      if (isIssuedBeforeCredentialsChange(payload.iat, user.credentialsChangedAt)) {
        const refused: ExtendedError = new CredentialsChangedException(CREDENTIALS_CHANGED_MESSAGE)
        refused.data = { code: ErrorCode.CREDENTIALS_CHANGED }
        return next(refused)
      }
      // The roles stored on the user, not the token's claim, decide: a role taken away counts at the next
      // connection. A socket already open keeps going until it drops, or until disconnectUser closes it.
      if (options.adminOnly && !user.role.includes(EnumUserRole.ADMIN)) {
        return next(new ForbiddenException('Admins only'))
      }

      socket.userId = payload.sub
      socket.role = payload.role
      socket.email = payload.email

      const roles = payload.role as EnumUserRole[]
      socket.channelNames = roles.map((role) => createChannelNameFromUserIdAndRole(payload.sub, role))
      next()
    } catch (error) {
      next(new ForbiddenException('Invalid token'))
    }
  }

const createChannelNameFromUserIdAndRole = (userId: string, role: string) => {
  return `${role}:${userId}`
}
