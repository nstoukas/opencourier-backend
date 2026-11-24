import { Module } from '@nestjs/common'
import { AuthDomainModule } from '../../../domains/auth/auth.domain.module'
import { PasswordResetService } from '../../../domains/auth/password-reset.service'
import { ConfigDomainModule } from '../../../domains/config/config.domain.module'
import { CourierDomainModule } from '../../../domains/courier/courier.domain.module'
import { UserDomainModule } from '../../../domains/user/user.domain.module'
import { CacheModule } from '../../../services/cache/cache.module'
import { MailModule } from '../../../services/mail/mail.module'
import { AuthPartnerRestApiController } from './auth.partner.rest-api.controller'
import { PasswordResetPartnerRestApiService } from './password-reset.partner.rest-api.service'

@Module({
  // Row 153: the reset by email needs what the rider's does (row 17): Redis, mail, the instance's name and the
  // user lookup. CourierDomainModule only because the shared PasswordResetService also serves riders.
  imports: [AuthDomainModule, CacheModule, MailModule, ConfigDomainModule, UserDomainModule, CourierDomainModule],
  controllers: [AuthPartnerRestApiController],
  providers: [PasswordResetService, PasswordResetPartnerRestApiService],
})
export class AuthPartnerRestApiModule {}
