import { Module } from '@nestjs/common'
import { ConfigDomainModule } from 'src/domains/config/config.domain.module'
import { ChatDomainService } from './chat.domain.service'
import { ChatRetentionService } from './chat-retention.service'

// Spec 0034 (chat). The repository, the live dispatcher and push are global modules, so only config is
// imported here.
@Module({
  imports: [ConfigDomainModule],
  providers: [ChatDomainService, ChatRetentionService],
  exports: [ChatDomainService],
})
export class ChatDomainModule {}
