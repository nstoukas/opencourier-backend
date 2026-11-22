import { Module } from '@nestjs/common'
import { ConfigDomainModule } from 'src/domains/config/config.domain.module'
import { MinioStorageModule } from 'src/integrations/minioStorage/minioStorage.module'
import { ComplaintService } from './complaint.service'

// Spec 0052. The repositories and the push service come from global modules; the photo storage
// (slice 2) from MinioStorageModule, imported here only.
@Module({
  imports: [ConfigDomainModule, MinioStorageModule],
  providers: [ComplaintService],
  exports: [ComplaintService],
})
export class ComplaintModule {}
