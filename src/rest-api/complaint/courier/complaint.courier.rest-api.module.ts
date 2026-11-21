import { Module } from '@nestjs/common'
import { ComplaintModule } from 'src/services/complaint/complaint.module'
import { ComplaintCourierRestApiController } from './complaint.courier.rest-api.controller'

@Module({
  imports: [ComplaintModule],
  controllers: [ComplaintCourierRestApiController],
})
export class ComplaintCourierRestApiModule {}
