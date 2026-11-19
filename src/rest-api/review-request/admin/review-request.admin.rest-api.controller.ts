import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import * as errors from 'src/errors'
import { EnumReviewRequestStatus, EnumUserRole } from '@prisma/types'
import { ADMIN_API_V1_PREFIX } from 'src/constants'
import { Roles } from 'src/decorators/roles.decorator'
import { CurrentUser } from 'src/decorators/currentUser.decorator'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import { ReviewRequestService } from 'src/services/review-request/review-request.service'
import {
  ReviewRequestAdminDto,
  ReviewRequestAdminPageDto,
  ReviewRequestCountAdminDto,
} from '../dtos/review-request.dto'
import { ReviewRequestAnswerAdminInput, ReviewRequestListAdminArgs } from '../queries/review-request.inputs'

// Spec 0038: the admin's Reviews page. A person answers every request; nothing here answers or closes
// one on its own, and an overdue request stays open until someone does (AC-6).
@swagger.ApiBearerAuth()
@swagger.ApiTags('review-requests')
@common.Controller(`${ADMIN_API_V1_PREFIX}/review-requests`)
export class ReviewRequestAdminRestApiController {
  constructor(private readonly reviewRequestService: ReviewRequestService) {}

  @common.Get()
  @swagger.ApiOkResponse({ type: ReviewRequestAdminPageDto })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'Review requests by tab: open ones by due date, the others newest first' })
  @Roles(EnumUserRole.ADMIN)
  async list(@common.Query() args: ReviewRequestListAdminArgs): Promise<ReviewRequestAdminPageDto> {
    const page = await this.reviewRequestService.listForAdmin(args.status ?? EnumReviewRequestStatus.OPEN, args)
    const now = new Date()
    return { data: page.data.map((request) => new ReviewRequestAdminDto(request, now)), pagination: page.pagination }
  }

  // Declared before ':id', so "count" is never read as an id.
  @common.Get('count')
  @swagger.ApiOkResponse({ type: ReviewRequestCountAdminDto })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'How many requests are open, and how many of those are overdue' })
  @Roles(EnumUserRole.ADMIN)
  async count(): Promise<ReviewRequestCountAdminDto> {
    return this.reviewRequestService.countOpen()
  }

  @common.Get(':id')
  @swagger.ApiOkResponse({ type: ReviewRequestAdminDto })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'One review request' })
  @Roles(EnumUserRole.ADMIN)
  async get(@common.Param('id') id: string): Promise<ReviewRequestAdminDto> {
    return new ReviewRequestAdminDto(await this.reviewRequestService.get(id))
  }

  @common.Post(':id/answer')
  @common.HttpCode(200)
  @swagger.ApiOkResponse({ type: ReviewRequestAdminDto })
  @swagger.ApiBadRequestResponse({ type: errors.BadRequestException })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiConflictResponse({ description: 'The request is no longer open' })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'Answer a review request, with an optional pay correction' })
  @Roles(EnumUserRole.ADMIN)
  async answer(
    @common.Param('id') id: string,
    @common.Body() input: ReviewRequestAnswerAdminInput,
    @CurrentUser() admin: UserEntity
  ): Promise<ReviewRequestAdminDto> {
    return new ReviewRequestAdminDto(await this.reviewRequestService.answer(id, admin.id, input))
  }
}
