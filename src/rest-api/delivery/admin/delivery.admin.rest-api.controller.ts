import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import * as errors from 'src/errors'
import { EnumUserRole } from '@prisma/types'
import { Roles } from 'src/decorators/roles.decorator'
import { DeliveryDomainService } from 'src/domains/delivery/delivery.domain.service'
import { DeliveryEventDomainService } from 'src/domains/delivery-event/delivery-event.domain.service'
import { ADMIN_API_V1_PREFIX } from 'src/constants'
import { DeliveryAdminPaginatedDto } from './dtos/delivery.admin.paginated.dto'
import { adminDeliveryListWhere } from './queries/delivery-list-filter'
import { DeliveryFindManyAdminArgs } from './queries/delivery-find-many.admin.args'
import { DeliveryAdminDto } from './dtos/delivery.admin.dto'
import { DeliveryEventAdminDto } from './dtos/delivery-event.admin.dto'
import { DeliveryIssueAdminDto } from './dtos/delivery-issue.admin.dto'
import { DeliveryIssueDomainService } from 'src/domains/delivery-issue/delivery-issue.domain.service'
import { DeliverySubmitEventAdminInput } from './queries/delivery-submit-event.admin.input'
import { DeliveryReassignAdminInput } from './queries/delivery-reassign.admin.input'

@swagger.ApiBearerAuth()
@swagger.ApiTags('deliveries')
@common.Controller(`${ADMIN_API_V1_PREFIX}/deliveries`)
export class DeliveryAdminRestApiController {
  // NestJS constructs the controller and injects both services.
  constructor(
    private readonly deliveryDomainService: DeliveryDomainService,
    private readonly deliveryEventDomainService: DeliveryEventDomainService,
    private readonly deliveryIssueDomainService: DeliveryIssueDomainService
  ) {}

  @common.Get('')
  @swagger.ApiResponse({ type: DeliveryAdminPaginatedDto })
  @swagger.ApiForbiddenResponse({
    type: errors.ForbiddenException,
  })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: 'Get deliveries' })
  @Roles(EnumUserRole.ADMIN)
  async getDeliveries(@common.Query() args: DeliveryFindManyAdminArgs): Promise<DeliveryAdminPaginatedDto> {
    // The courier, the restaurant, the status filter and the search, as one Prisma where (row 96, spec 0017).
    const deliveries = await this.deliveryDomainService.getMany(
      adminDeliveryListWhere({
        courierId: args.courierId,
        state: args.state,
        search: args.search,
        partnerId: args.partnerId,
      }),
      args.page,
      args.perPage
    )

    const offerViews = await this.deliveryDomainService.getOfferViews(deliveries.data)
    const dto = new DeliveryAdminPaginatedDto(deliveries, offerViews)
    return dto
  }

  @common.Get(':deliveryId')
  @swagger.ApiResponse({ type: DeliveryAdminDto })
  @swagger.ApiForbiddenResponse({
    type: errors.ForbiddenException,
  })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: 'Get delivery by id' })
  @Roles(EnumUserRole.ADMIN)
  async getDelivery(@common.Param('deliveryId') deliveryId: string): Promise<DeliveryAdminDto> {
    // Loads the quote too, so the page can show how the price and the rider's pay were built.
    const { delivery, quote } = await this.deliveryDomainService.getByIdOrThrowWithQuote(deliveryId)

    const offerViews = await this.deliveryDomainService.getOfferViews([delivery])
    // Spec 0015, AC-13: a restaurant's cancellation charge, shown on the delivery's page.
    const partnerCharge = delivery.cancelledAt ? await this.deliveryDomainService.getPartnerCharge(delivery.id) : null
    const dto = new DeliveryAdminDto(delivery, quote, offerViews.get(delivery.id), partnerCharge)
    return dto
  }

  @common.Get(':deliveryId/events')
  @swagger.ApiOkResponse({ type: [DeliveryEventAdminDto] })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: "Get a delivery's event history" })
  @Roles(EnumUserRole.ADMIN)
  async getDeliveryEvents(
    @common.Param('deliveryId') deliveryId: string
  ): Promise<DeliveryEventAdminDto[]> {
    // Check the delivery exists first: an unknown id must 404, not return [].
    // An empty array would read as "this delivery has no audit trail", which is a
    // different and much worse claim than "there is no such delivery".
    const delivery = await this.deliveryDomainService.getById(deliveryId)
    if (!delivery) {
      throw new errors.DeliveryNotFoundException(`Delivery ${deliveryId} not found`)
    }

    const events = await this.deliveryEventDomainService.getEventHistoryForDelivery(deliveryId)
    return events.map((event) => new DeliveryEventAdminDto(event))
  }

  @common.Get(':deliveryId/issues')
  @swagger.ApiOkResponse({ type: [DeliveryIssueAdminDto] })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: "Get the riders' reports about a delivery" })
  @Roles(EnumUserRole.ADMIN)
  async getDeliveryIssues(@common.Param('deliveryId') deliveryId: string): Promise<DeliveryIssueAdminDto[]> {
    // An unknown delivery answers 404, not [] ("no reports" is a different claim), as for events.
    const delivery = await this.deliveryDomainService.getById(deliveryId)
    if (!delivery) {
      throw new errors.DeliveryNotFoundException(`Delivery ${deliveryId} not found`)
    }
    const issues = await this.deliveryIssueDomainService.listForDelivery(deliveryId)
    return issues.map((issue) => new DeliveryIssueAdminDto(issue))
  }

  @common.Post(':id/submit-event')
  @swagger.ApiBody({
    type: DeliverySubmitEventAdminInput,
  })
  @swagger.ApiOkResponse({ type: DeliveryAdminDto })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiForbiddenResponse({
    type: errors.ForbiddenException,
  })
  @Roles(EnumUserRole.ADMIN)
  async submitOrderEvent(
    @common.Param('id') id: string,
    @common.Body() data: DeliverySubmitEventAdminInput
  ): Promise<DeliveryAdminDto> {
    const result = await this.deliveryDomainService.submitDeliveryEvent(data)
    return new DeliveryAdminDto(result)
  }

  @common.Post(':id/reassign')
  @swagger.ApiBody({ type: DeliveryReassignAdminInput })
  @swagger.ApiOkResponse({ type: DeliveryAdminDto })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiForbiddenResponse({
    type: errors.ForbiddenException,
  })
  @Roles(EnumUserRole.ADMIN)
  async reassignDelivery(
    @common.Param('id') id: string,
    @common.Body() data: DeliveryReassignAdminInput
  ): Promise<DeliveryAdminDto> {
    const result = await this.deliveryDomainService.reassignDelivery(
      id,
      data.courierId,
      data.payoutPolicy,
      data.message
    )
    return new DeliveryAdminDto(result)
  }
}
