import { Module } from '@nestjs/common'
import { ComplaintModule } from 'src/services/complaint/complaint.module'
import { ComplaintAdminRestApiController } from './complaint.admin.rest-api.controller'

@Module({
  imports: [ComplaintModule],
  controllers: [ComplaintAdminRestApiController],
})
export class ComplaintAdminRestApiModule {}
