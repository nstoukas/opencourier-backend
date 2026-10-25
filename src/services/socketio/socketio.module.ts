import { Global, Module } from '@nestjs/common'
import { SocketGateway } from './socketio.gateway'
import { SocketIOService } from './socketio.service'
import { SocketIODispatcher } from './socketio.dispatcher'
import { WebsocketDispatcher } from '../websocket/models/WebsocketDispatcher'
import { useProvideClass } from 'src/core/utils/provider'

// @Global() makes this module's exports (the WebsocketDispatcher) injectable everywhere,
// the same way the Ably dispatcher module is, so DeliveryEventService gets whichever one
// app.module chose without importing it.
@Global()
@Module({
  providers: [useProvideClass(WebsocketDispatcher, SocketIODispatcher), SocketGateway, SocketIOService],
  exports: [SocketIOService, WebsocketDispatcher],
})
export class SocketIOModule {}
