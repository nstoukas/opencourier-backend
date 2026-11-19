import { Module } from '@nestjs/common'
import { ReviewRequestModule } from 'src/services/review-request/review-request.module'
import { ReviewRequestAdminRestApiController } from './review-request.admin.rest-api.controller'

@Module({
  imports: [ReviewRequestModule],
  controllers: [ReviewRequestAdminRestApiController],
})
export class ReviewRequestAdminRestApiModule {}
