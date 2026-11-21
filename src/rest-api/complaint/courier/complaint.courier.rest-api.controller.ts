import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import * as errors from 'src/errors'
import { EnumUserRole } from '@prisma/types'
import { COURIER_API_V1_PREFIX } from 'src/constants'
import { Roles } from 'src/decorators/roles.decorator'
import { CurrentUserCourier } from 'src/decorators/currentUserCourier.decorator'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { ComplaintService } from 'src/services/complaint/complaint.service'
import { ComplaintCourierDto, ComplaintCourierPageDto } from '../dtos/complaint.dto'
import { ComplaintCreateCourierInput, ComplaintPageArgs, ComplaintReplyInput } from '../dtos/complaint.inputs'

// Spec 0052: a rider's complaints. They file about a restaurant or a customer from a job, read the
// complaints they filed and the ones about them, and reply to one about them. The session decides
// which rider; no route takes a rider id.
@swagger.ApiBearerAuth()
@swagger.ApiTags('complaints')
@common.Controller(`${COURIER_API_V1_PREFIX}/complaints`)
export class ComplaintCourierRestApiController {
  constructor(private readonly complaintService: ComplaintService) {}

  @common.Post()
  @swagger.ApiCreatedResponse({ type: ComplaintCourierDto })
  @swagger.ApiBadRequestResponse({ type: errors.BadRequestException })
  @swagger.ApiNotFoundResponse({ description: 'Not one of my jobs within my Earnings reach' })
  @swagger.ApiConflictResponse({ description: 'I already have an open complaint about this job and party' })
  @swagger.ApiOperation({ summary: 'Complain about the restaurant or the customer of one of my jobs' })
  @Roles(EnumUserRole.COURIER)
  async file(
    @common.Body() input: ComplaintCreateCourierInput,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<ComplaintCourierDto> {
    return new ComplaintCourierDto(await this.complaintService.fileByRider(courier.id, input), courier.id)
  }

  @common.Get()
  @swagger.ApiOkResponse({ type: ComplaintCourierPageDto })
  @swagger.ApiOperation({ summary: 'Complaints I filed and complaints about me, newest first' })
  @Roles(EnumUserRole.COURIER)
  async list(
    @common.Query() args: ComplaintPageArgs,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<ComplaintCourierPageDto> {
    const page = await this.complaintService.listForCourier(courier.id, args)
    return {
      data: page.data.map((complaint) => new ComplaintCourierDto(complaint, courier.id)),
      pagination: page.pagination,
    }
  }

  // @HttpCode = answer 200 instead of Nest's default 201 for a POST: nothing new is created.
  @common.Post(':id/reply')
  @common.HttpCode(200)
  @swagger.ApiOkResponse({ type: ComplaintCourierDto })
  @swagger.ApiBadRequestResponse({ type: errors.BadRequestException })
  @swagger.ApiNotFoundResponse({ description: 'No complaint about me with this id' })
  @swagger.ApiConflictResponse({ description: 'Already replied, or the complaint is closed' })
  @swagger.ApiOperation({ summary: 'Reply to a complaint about me (once)' })
  @Roles(EnumUserRole.COURIER)
  async reply(
    @common.Param('id') id: string,
    @common.Body() input: ComplaintReplyInput,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<ComplaintCourierDto> {
    return new ComplaintCourierDto(await this.complaintService.reply(courier.id, id, input.text), courier.id)
  }
}
