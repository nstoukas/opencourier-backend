import { Module } from '@nestjs/common'
import { ConfigDomainModule } from 'src/domains/config/config.domain.module'
import { CourierDomainModule } from 'src/domains/courier/courier.domain.module'
import { UserDomainModule } from 'src/domains/user/user.domain.module'
import { CacheModule } from 'src/services/cache/cache.module'
import { CourierCutOffModule } from 'src/services/courier-cut-off/courier-cut-off.module'
import { MailModule } from 'src/services/mail/mail.module'
import { CourierAccountService } from './courier-account.service'

// Spec 0051 (row 108): rider account upkeep, imported by the admin courier routes and the courier routes.
// Repositories, auth, delivery events and sockets come from global modules.
@Module({
  imports: [ConfigDomainModule, CourierDomainModule, UserDomainModule, CacheModule, CourierCutOffModule, MailModule],
  providers: [CourierAccountService],
  exports: [CourierAccountService],
})
export class CourierAccountModule {}
