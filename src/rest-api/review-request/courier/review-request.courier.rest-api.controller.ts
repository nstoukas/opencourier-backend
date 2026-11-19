import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import * as errors from 'src/errors'
import { EnumUserRole } from '@prisma/types'
import { COURIER_API_V1_PREFIX } from 'src/constants'
import { Roles } from 'src/decorators/roles.decorator'
import { CurrentUserCourier } from 'src/decorators/currentUserCourier.decorator'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { ReviewRequestService } from 'src/services/review-request/review-request.service'
import { ReviewRequestCourierDto, ReviewRequestCourierPageDto } from '../dtos/review-request.dto'
import { ReviewPageArgs, ReviewRequestCreateCourierInput } from '../queries/review-request.inputs'

// Spec 0038: a rider asks a person to review a decision the app took about their work. A rider
// reads, sends and withdraws only their own requests; another rider's is a 404.
@swagger.ApiBearerAuth()
@swagger.ApiTags('review-requests')
@common.Controller(`${COURIER_API_V1_PREFIX}/review-requests`)
export class ReviewRequestCourierRestApiController {
  constructor(private readonly reviewRequestService: ReviewRequestService) {}

  @common.Post()
  @swagger.ApiCreatedResponse({ type: ReviewRequestCourierDto })
  @swagger.ApiBadRequestResponse({ type: errors.BadRequestException })
  @swagger.ApiNotFoundResponse({ description: 'The delivery does not exist, or was never offered to or held by me' })
  @swagger.ApiConflictResponse({ description: 'I already have an open request about this delivery' })
  @swagger.ApiOperation({ summary: 'Ask a person to review a decision about my work' })
  @Roles(EnumUserRole.COURIER)
  async send(
    @common.Body() input: ReviewRequestCreateCourierInput,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<ReviewRequestCourierDto> {
    return new ReviewRequestCourierDto(await this.reviewRequestService.send(courier.id, input))
  }

  @common.Get()
  @swagger.ApiOkResponse({ type: ReviewRequestCourierPageDto })
  @swagger.ApiOperation({ summary: 'My review requests, newest first' })
  @Roles(EnumUserRole.COURIER)
  async list(
    @common.Query() args: ReviewPageArgs,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<ReviewRequestCourierPageDto> {
    const page = await this.reviewRequestService.listForCourier(courier.id, args)
    const now = new Date()
    return { data: page.data.map((request) => new ReviewRequestCourierDto(request, now)), pagination: page.pagination }
  }

  // @HttpCode = answer 200 instead of Nest's default 201 for a POST: nothing new is created.
  @common.Post(':id/withdraw')
  @common.HttpCode(200)
  @swagger.ApiOkResponse({ type: ReviewRequestCourierDto })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiConflictResponse({ description: 'The request is no longer open' })
  @swagger.ApiOperation({ summary: 'Withdraw my open review request' })
  @Roles(EnumUserRole.COURIER)
  async withdraw(
    @common.Param('id') id: string,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<ReviewRequestCourierDto> {
    return new ReviewRequestCourierDto(await this.reviewRequestService.withdraw(id, courier.id))
  }
}
