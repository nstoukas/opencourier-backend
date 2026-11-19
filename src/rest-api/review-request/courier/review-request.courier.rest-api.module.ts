import { Module } from '@nestjs/common'
import { ReviewRequestModule } from 'src/services/review-request/review-request.module'
import { ReviewRequestCourierRestApiController } from './review-request.courier.rest-api.controller'

@Module({
  imports: [ReviewRequestModule],
  controllers: [ReviewRequestCourierRestApiController],
})
export class ReviewRequestCourierRestApiModule {}
