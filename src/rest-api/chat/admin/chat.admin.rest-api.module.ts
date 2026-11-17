import { Module } from '@nestjs/common'
import { ChatDomainModule } from 'src/domains/chat/chat.domain.module'
import { ChatAdminRestApiController } from './chat.admin.rest-api.controller'

// Spec 0034 (chat): dispatch's inbox routes, registered in the admin API tree.
@Module({
  imports: [ChatDomainModule],
  controllers: [ChatAdminRestApiController],
})
export class ChatAdminRestApiModule {}
