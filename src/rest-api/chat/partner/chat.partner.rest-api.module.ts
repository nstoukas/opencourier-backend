import { Module } from '@nestjs/common'
import { ChatDomainModule } from 'src/domains/chat/chat.domain.module'
import { ChatPartnerRestApiController } from './chat.partner.rest-api.controller'

// Spec 0034 (chat), AC-14: a restaurant's chat routes, registered in the partner API tree.
@Module({
  imports: [ChatDomainModule],
  controllers: [ChatPartnerRestApiController],
})
export class ChatPartnerRestApiModule {}
