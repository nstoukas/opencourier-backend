import { Global, Module } from '@nestjs/common'
import { useProvideClass } from '../../core/utils/provider'
import { WebsocketDispatcher } from '../../services/websocket/models/WebsocketDispatcher'
import { AblyDispatcher } from './ably.dispatcher'
import { AblyModule } from './ably.module'

// Sends courier notifications through Ably. Loaded only when WEBSOCKET_DISPATCHER=ably
// (see selectWebsocketDispatcherModule).
@Global()
@Module({
  imports: [AblyModule],
  providers: [useProvideClass(WebsocketDispatcher, AblyDispatcher)],
  exports: [WebsocketDispatcher],
})
export class AblyDispatcherModule {}
