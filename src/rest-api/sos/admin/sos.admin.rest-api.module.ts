import { Module } from '@nestjs/common'
import { SosModule } from 'src/services/sos/sos.module'
import { SosAdminRestApiController } from './sos.admin.rest-api.controller'

// The admin SOS routes (spec 0022), registered in the admin API tree.
@Module({
  imports: [SosModule],
  controllers: [SosAdminRestApiController],
})
export class SosAdminRestApiModule {}
