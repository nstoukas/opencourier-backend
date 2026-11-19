import { Module } from '@nestjs/common'
import { MailService } from './mail.service'

// Row 17 (spec 0039): import this module to send mail. Not global, so the places that send mail
// are the places that import it.
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
