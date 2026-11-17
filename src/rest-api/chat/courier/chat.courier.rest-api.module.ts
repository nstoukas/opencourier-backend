import { Module } from '@nestjs/common'
import { ChatDomainModule } from 'src/domains/chat/chat.domain.module'
import { ChatCourierRestApiController } from './chat.courier.rest-api.controller'

// Spec 0034 (chat): a rider's chat routes, registered in the courier API tree.
@Module({
  imports: [ChatDomainModule],
  controllers: [ChatCourierRestApiController],
})
export class ChatCourierRestApiModule {}
