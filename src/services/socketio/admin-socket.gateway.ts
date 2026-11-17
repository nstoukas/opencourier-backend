import { Logger } from '@nestjs/common'
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets'
import { Namespace } from 'socket.io'
import { SocketWithAuth } from './types/socket-with-auth.type'

// Spec 0034 (chat): admins get their own namespace, so riders and admins never share an audience.
// `SocketIOAdapter` checks the token and the admin role before a socket gets here.
export const ADMIN_SOCKET_NAMESPACE = 'admins'
// Every admin socket joins this one room: the chat inbox is shared by all of dispatch (AC-7).
export const DISPATCH_ROOM = 'dispatch'

// @WebSocketGateway registers this class as the handler of one Socket.IO namespace.
@WebSocketGateway({ namespace: ADMIN_SOCKET_NAMESPACE })
export class AdminSocketGateway implements OnGatewayConnection {
  private readonly logger = new Logger(AdminSocketGateway.name)

  // @WebSocketServer() hands this class the namespace itself, which can emit to a room.
  // Undefined until Nest has started the namespace.
  @WebSocketServer()
  private namespace: Namespace | undefined

  handleConnection(client: SocketWithAuth): void {
    void client.join(DISPATCH_ROOM)
    this.logger.log(`Admin socket connected: ${client.id}, userId: ${client.userId}`)
  }

  // To every admin page that is open. Callers log ids only: a message body is personal data.
  emitToDispatch(eventName: string, payload: unknown): void {
    if (!this.namespace) {
      this.logger.warn(`No admin namespace yet; ${eventName} not sent live`)
      return
    }
    this.namespace.to(DISPATCH_ROOM).emit(eventName, payload)
  }
}
