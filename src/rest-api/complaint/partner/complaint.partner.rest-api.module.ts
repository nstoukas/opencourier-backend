import { Module } from '@nestjs/common'
import { ComplaintModule } from 'src/services/complaint/complaint.module'
import { ComplaintPartnerRestApiController } from './complaint.partner.rest-api.controller'

@Module({
  imports: [ComplaintModule],
  controllers: [ComplaintPartnerRestApiController],
})
export class ComplaintPartnerRestApiModule {}
