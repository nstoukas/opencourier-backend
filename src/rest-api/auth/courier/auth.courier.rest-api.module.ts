import { CourierAccountModule } from 'src/services/courier-account/courier-account.module'
import { Module } from '@nestjs/common'
import { AuthDomainModule } from '../../../domains/auth/auth.domain.module'
import { PasswordResetService } from '../../../domains/auth/password-reset.service'
import { ConfigDomainModule } from '../../../domains/config/config.domain.module'
import { CourierDomainModule } from '../../../domains/courier/courier.domain.module'
import { UserDomainModule } from '../../../domains/user/user.domain.module'
import { CacheModule } from '../../../services/cache/cache.module'
import { CourierCutOffModule } from '../../../services/courier-cut-off/courier-cut-off.module'
import { MailModule } from '../../../services/mail/mail.module'
import { AuthCourierRestApiController } from './auth.courier.rest-api.controller'
import { PasswordResetCourierRestApiService } from './password-reset.courier.rest-api.service'

@Module({
  // Row 17 (spec 0039): the reset by email needs Redis (CacheModule), mail, the instance's name
  // (ConfigDomainModule), the rider lookup, and the shared cut off.
  imports: [
    AuthDomainModule,
    CourierAccountModule,
    CacheModule,
    MailModule,
    ConfigDomainModule,
    UserDomainModule,
    CourierDomainModule,
    CourierCutOffModule,
  ],
  controllers: [AuthCourierRestApiController],
  providers: [PasswordResetService, PasswordResetCourierRestApiService],
})
export class AuthCourierRestApiModule {}
