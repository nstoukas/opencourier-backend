import { SplitRequestRepository } from 'src/persistence/repositories/split-request.repository'
import { DeliveryReadyDelayPartnerInput } from './queries/delivery-ready-delay.partner.input'
import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import * as errors from 'src/errors'
import { EnumUserRole } from '@prisma/types'
import { Roles } from 'src/decorators/roles.decorator'
import { PARTNER_API_V1_PREFIX } from 'src/constants'
import { ProductReportCreatePartnerInput } from './queries/product-report-create.partner.input'
import { DeliveryCreatePartnerInput } from './queries/delivery-create.partner.input'
import { DeliveryPartnerRestApiService } from './delivery.partner.rest-api.service'
import { CurrentUserPartner } from 'src/decorators/currentUserPartner.decorator'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { DeliveryOrderLegsPartnerDto } from './dtos/delivery-order-legs.partner.dto'
import { DeliveryPartnerDto } from './dtos/delivery.partner.dto'
import { DeliveryFindManyPartnerArgs } from './queries/delivery-find-many.partner.args'
import { DeliveryCancelPartnerInput } from './queries/delivery-cancel.partner.input'
import { DeliveryPartnerPaginatedDto } from './dtos/delivery.partner.paginated.dto'
import { DeliveryUpdatePartnerInput } from './queries/delivery-update.partner.input'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { ApiKeyAuth } from 'src/decorators/api-key-auth.decorator'

@swagger.ApiBearerAuth()
@swagger.ApiTags('deliveries')
@common.Controller(`${PARTNER_API_V1_PREFIX}/deliveries`)
export class DeliveryPartnerRestApiController {
  constructor(
    private readonly deliveryPartnerRestApiService: DeliveryPartnerRestApiService,
    private readonly deliveryEventService: DeliveryEventService,
    // Spec 0047: optional for the tests that build this controller by hand; Nest always injects it.
    private readonly splitRequestRepository?: SplitRequestRepository
  ) {}

  // Spec 0047 (AC-8, AC-10): tells the restaurant which of these orders were split at pickup or left unsplit.
  private async withSplitOutcomes<T extends { id: string; quoteId: string; splitOutcome: 'SPLIT' | 'LEFT' | null }>(
    dtos: T[]
  ): Promise<T[]> {
    if (!this.splitRequestRepository) return dtos
    const outcomes = await this.splitRequestRepository.findOutcomesForDeliveries(
      dtos.map((dto) => ({ id: dto.id, deliveryQuoteId: dto.quoteId }))
    )
    for (const dto of dtos) dto.splitOutcome = outcomes.get(dto.id) ?? null
    return dtos
  }

  @common.Get('')
  @swagger.ApiBody({ type: DeliveryFindManyPartnerArgs })
  @swagger.ApiResponse({ type: DeliveryPartnerPaginatedDto })
  @swagger.ApiNotFoundResponse({
    type: errors.NotFoundException,
  })
  @swagger.ApiForbiddenResponse({
    type: errors.ForbiddenException,
  })
  @swagger.ApiOperation({ summary: 'List deliveries' })
  @ApiKeyAuth()
  @Roles(EnumUserRole.PARTNER)
  async listDeliveries(
    @common.Query() args: DeliveryFindManyPartnerArgs,
    @CurrentUserPartner() partner: PartnerEntity
  ): Promise<DeliveryPartnerPaginatedDto> {
    const result = await this.deliveryPartnerRestApiService.getManyByPartnerId(partner.id, args.page, args.perPage)

    const dto = new DeliveryPartnerPaginatedDto(result, result.historyDays)
    await this.withSplitOutcomes(dto.data)

    return dto
  }

  @common.Get(':deliveryId')
  @swagger.ApiOkResponse({
    type: DeliveryPartnerDto,
  })
  @swagger.ApiNotFoundResponse({
    type: errors.NotFoundException,
  })
  @swagger.ApiForbiddenResponse({
    type: errors.ForbiddenException,
  })
  @swagger.ApiOperation({ summary: 'Get a delivery by id' })
  @ApiKeyAuth()
  @Roles(EnumUserRole.PARTNER)
  async getDelivery(
    @common.Param('deliveryId') deliveryId: string,
    @CurrentUserPartner() partner: PartnerEntity
  ): Promise<DeliveryPartnerDto> {
    const result = await this.deliveryPartnerRestApiService.getByIdWithRelations(deliveryId, partner.id)

    const dto = new DeliveryPartnerDto(result.delivery, {
      courierWithSettings: result.courierWithSettings,
      pickupLocation: result.pickupLocation,
      dropoffLocation: result.dropoffLocation,
    })
    await this.withSplitOutcomes([dto])

    return dto
  }

  // Spec 0046 (AC-3, AC-6): the order's legs, oldest leg number first, and any leg never sent, so the
  // order page can group them and offer Retry for a missing one. Empty for a single delivery.
  @common.Get(':deliveryId/order-legs')
  @swagger.ApiOkResponse({ type: DeliveryOrderLegsPartnerDto })
  @swagger.ApiNotFoundResponse({
    type: errors.NotFoundException,
  })
  @swagger.ApiOperation({ summary: 'Get the legs of the order this delivery belongs to' })
  @ApiKeyAuth()
  @Roles(EnumUserRole.PARTNER)
  async getOrderLegs(
    @common.Param('deliveryId') deliveryId: string,
    @CurrentUserPartner() partner: PartnerEntity
  ): Promise<DeliveryOrderLegsPartnerDto> {
    const result = await this.deliveryPartnerRestApiService.getOrderLegsWithRelations(deliveryId, partner.id)
    const legs = result.legs.map(
      (leg) =>
        new DeliveryPartnerDto(leg.delivery, {
          courierWithSettings: leg.courierWithSettings,
          pickupLocation: leg.pickupLocation,
          dropoffLocation: leg.dropoffLocation,
        })
    )
    return { legs: await this.withSplitOutcomes(legs), missingLegNumbers: result.missingLegNumbers }
  }

  @common.Post('')
  @swagger.ApiBody({
    type: DeliveryCreatePartnerInput,
  })
  @swagger.ApiOkResponse({
    type: DeliveryPartnerDto,
  })
  @swagger.ApiNotFoundResponse({
    type: errors.NotFoundException,
  })
  @swagger.ApiForbiddenResponse({
    type: errors.ForbiddenException,
  })
  @swagger.ApiOperation({ summary: 'Create delivery' })
  @ApiKeyAuth()
  @Roles(EnumUserRole.PARTNER)
  async createDelivery(
    @common.Body() data: DeliveryCreatePartnerInput,
    @CurrentUserPartner() partner: PartnerEntity
  ): Promise<DeliveryPartnerDto> {
    const delivery = await this.deliveryPartnerRestApiService.create(partner.id, data)

    const dto = new DeliveryPartnerDto(delivery)
    return dto
  }

  @common.Post(':deliveryId')
  @swagger.ApiBody({
    type: DeliveryUpdatePartnerInput,
  })
  @swagger.ApiOkResponse({
    type: DeliveryPartnerDto,
  })
  @swagger.ApiNotFoundResponse({
    type: errors.NotFoundException,
  })
  @swagger.ApiForbiddenResponse({
    type: errors.ForbiddenException,
  })
  @swagger.ApiOperation({ summary: 'Edit delivery (a left out field keeps its stored value)' })
  @ApiKeyAuth()
  @Roles(EnumUserRole.PARTNER)
  async updateDelivery(
    @common.Param('deliveryId') deliveryId: string,
    @common.Body() data: DeliveryUpdatePartnerInput,
    @CurrentUserPartner() partner: PartnerEntity
  ): Promise<DeliveryPartnerDto> {
    const delivery = await this.deliveryPartnerRestApiService.update(deliveryId, partner.id, data)

    const dto = new DeliveryPartnerDto(delivery)
    return dto
  }

  @common.Post(':deliveryId/cancel')
  @swagger.ApiOkResponse({
    type: DeliveryPartnerDto,
  })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'Cancel a delivery' })
  @ApiKeyAuth()
  @Roles(EnumUserRole.PARTNER)
  async cancelDelivery(
    @common.Param('deliveryId') deliveryId: string,
    @CurrentUserPartner() partner: PartnerEntity,
    // Optional body (spec 0015): an old client that sends none cancels as the restaurant.
    @common.Body() data: DeliveryCancelPartnerInput = {}
  ): Promise<DeliveryPartnerDto> {
    const result = await this.deliveryPartnerRestApiService.cancel(deliveryId, partner.id, data.cancelledBy)

    const dto = new DeliveryPartnerDto(result)

    return dto
  }

  // Spec 0023 (AC-3): "+5 / +10 / +15 min". 409 with a fixed sentence when it may not run.
  @common.Post(':deliveryId/ready-delay')
  @swagger.ApiOkResponse({ type: DeliveryPartnerDto })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: 'Move the food ready time later' })
  @ApiKeyAuth()
  @Roles(EnumUserRole.PARTNER)
  async delayReady(
    @common.Param('deliveryId') deliveryId: string,
    @CurrentUserPartner() partner: PartnerEntity,
    @common.Body() data: DeliveryReadyDelayPartnerInput
  ): Promise<DeliveryPartnerDto> {
    const expected = data.expectedReadyAt === null ? null : new Date(data.expectedReadyAt)
    const result = await this.deliveryPartnerRestApiService.delayReady(deliveryId, partner.id, data.minutes, expected)
    return new DeliveryPartnerDto(result)
  }

  // Spec 0023 (AC-4): "Food ready". A repeat answers the delivery as it is.
  @common.Post(':deliveryId/food-ready')
  @swagger.ApiOkResponse({ type: DeliveryPartnerDto })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: 'Mark the food ready' })
  @ApiKeyAuth()
  @Roles(EnumUserRole.PARTNER)
  async markFoodReady(
    @common.Param('deliveryId') deliveryId: string,
    @CurrentUserPartner() partner: PartnerEntity
  ): Promise<DeliveryPartnerDto> {
    const result = await this.deliveryPartnerRestApiService.markFoodReady(deliveryId, partner.id)
    return new DeliveryPartnerDto(result)
  }

  // Spec 0032, AC-3.
  @common.Post(':deliveryId/product-reports')
  @swagger.ApiBody({ type: ProductReportCreatePartnerInput })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: 'Report a wrong or missing product' })
  @ApiKeyAuth()
  @Roles(EnumUserRole.PARTNER)
  async reportProduct(
    @common.Param('deliveryId') deliveryId: string,
    @common.Body() input: ProductReportCreatePartnerInput,
    @CurrentUserPartner() partner: PartnerEntity
  ): Promise<{ id: string }> {
    const report = await this.deliveryPartnerRestApiService.reportProduct(deliveryId, partner, input)
    return { id: report.id }
  }

  @common.Post('test/:deliveryId/assign-courier')
  @swagger.ApiNotFoundResponse({
    type: errors.NotFoundException,
  })
  @swagger.ApiForbiddenResponse({
    type: errors.ForbiddenException,
  })
  @swagger.ApiOperation({ summary: 'Test endpoint: assigning courier for delivery' })
  @ApiKeyAuth()
  @Roles(EnumUserRole.PARTNER)
  async findCourier(
    @common.Param('deliveryId') deliveryId: string,
    @CurrentUserPartner() partner: PartnerEntity
  ): Promise<any> {
    // A partner may only trigger an offer for its own delivery (row 61 review). This throws the same
    // 404 for an unknown id and for another partner's delivery, so the route tells neither apart.
    await this.deliveryPartnerRestApiService.getByIdWithRelations(deliveryId, partner.id)

    // The real offer step (offeredAt, OFFERED event, expiry timer), never a bare matchedCourierId.
    const courier = await this.deliveryEventService.offerWaitingDeliveryNow(deliveryId)

    if (!courier) {
      throw new errors.NotFoundException('No couriers are available.')
    }

    return courier
  }
}
