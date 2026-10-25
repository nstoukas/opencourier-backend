import { Global, Module } from '@nestjs/common'
import { AblyService } from './ably.service'
import { ablyClientFactory } from './ablyClientFactory'

// Only the Ably client and token service live here. AuthDomainModule imports this module
// whatever dispatcher is chosen, so it must not also hand out a WebsocketDispatcher: it used
// to, and because it is global that Ably dispatcher silently replaced Socket.IO everywhere,
// so offers and status updates never reached the courier app (row 57).
@Global()
@Module({
  providers: [AblyService, ablyClientFactory],
  exports: [AblyService],
})
export class AblyModule {}
