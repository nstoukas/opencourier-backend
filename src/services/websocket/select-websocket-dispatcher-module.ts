import { AblyDispatcherModule } from '../../integrations/ably/ably-dispatcher.module'
import { SocketIOModule } from '../socketio/socketio.module'

// Picks the module that provides the WebsocketDispatcher (how offers and delivery status
// updates reach the courier app). Socket.IO unless WEBSOCKET_DISPATCHER is exactly 'ably'.
// Exactly one of the two is ever loaded, so there is never a second dispatcher to win.
export function selectWebsocketDispatcherModule(
  websocketDispatcher: string | undefined
): typeof AblyDispatcherModule | typeof SocketIOModule {
  return websocketDispatcher === 'ably' ? AblyDispatcherModule : SocketIOModule
}
