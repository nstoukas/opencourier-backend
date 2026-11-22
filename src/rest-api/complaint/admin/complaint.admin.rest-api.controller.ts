import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import type { Response } from 'express'
import * as errors from 'src/errors'
import { EnumUserRole } from '@prisma/types'
import { ADMIN_API_V1_PREFIX } from 'src/constants'
import { Roles } from 'src/decorators/roles.decorator'
import { CurrentUser } from 'src/decorators/currentUser.decorator'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import { ComplaintService } from 'src/services/complaint/complaint.service'
import { complaintPhotoResponse } from '../complaint-photo-response'
import { ComplaintAdminDto, ComplaintAdminPageDto, ComplaintDeliveryRiderDto } from '../dtos/complaint.dto'
import {
  ComplaintCreateAdminInput,
  ComplaintDecideAdminInput,
  ComplaintListAdminArgs,
  ComplaintReplyInput,
  ComplaintWithdrawAdminInput,
} from '../dtos/complaint.inputs'

// Spec 0052 (AC-3, AC-5, AC-6): the admin's Complaints. A person decides every complaint; a complaint
// about a rider cannot be decided before the rider's reply, and nothing closes one on its own. The list
// is never filtered, grouped, counted or sorted by rider (cross check 13).
@swagger.ApiBearerAuth()
@swagger.ApiTags('complaints')
@common.Controller(`${ADMIN_API_V1_PREFIX}/complaints`)
export class ComplaintAdminRestApiController {
  constructor(private readonly complaintService: ComplaintService) {}

  @common.Get()
  @swagger.ApiOkResponse({ type: ComplaintAdminPageDto })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'Complaints, newest first, filtered by status and about' })
  @Roles(EnumUserRole.ADMIN)
  async list(@common.Query() args: ComplaintListAdminArgs): Promise<ComplaintAdminPageDto> {
    const page = await this.complaintService.listForAdmin({ status: args.status, about: args.about }, args)
    return { data: page.data.map((complaint) => new ComplaintAdminDto(complaint)), pagination: page.pagination }
  }

  // Declared before ':id', so "delivery-riders" is never read as an id.
  @common.Get('delivery-riders/:deliveryId')
  @swagger.ApiOkResponse({ type: [ComplaintDeliveryRiderDto] })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'The riders who accepted this delivery, newest first, to pick one when filing' })
  @Roles(EnumUserRole.ADMIN)
  async deliveryRiders(@common.Param('deliveryId') deliveryId: string): Promise<ComplaintDeliveryRiderDto[]> {
    return this.complaintService.ridersForAdmin(deliveryId)
  }

  @common.Get(':id')
  @swagger.ApiOkResponse({ type: ComplaintAdminDto })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'One complaint' })
  @Roles(EnumUserRole.ADMIN)
  async get(@common.Param('id') id: string): Promise<ComplaintAdminDto> {
    return new ComplaintAdminDto(await this.complaintService.get(id))
  }

  // Slice 2 (AC-6, cross check 8): adminweb fetches this with the bearer and shows it as an object URL;
  // there is no other way to the photo, and never a storage URL.
  @common.Get(':id/photo')
  @swagger.ApiProduces('image/jpeg')
  @swagger.ApiOkResponse({ description: 'The photo, as a JPEG with no metadata' })
  @swagger.ApiNotFoundResponse({ description: 'No complaint with this id, or it has no photo' })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiServiceUnavailableResponse({ description: 'The photo storage cannot be read right now' })
  @swagger.ApiOperation({ summary: "A complaint's photo" })
  @Roles(EnumUserRole.ADMIN)
  async photo(
    @common.Param('id') id: string,
    // `passthrough: true` lets this set headers and still return the file for Nest to send.
    @common.Res({ passthrough: true }) res: Response
  ): Promise<common.StreamableFile> {
    return complaintPhotoResponse(res, await this.complaintService.photoForAdmin(id))
  }

  @common.Post()
  @swagger.ApiCreatedResponse({ type: ComplaintAdminDto })
  @swagger.ApiBadRequestResponse({ description: 'A bad text or category, or more than one rider and none named' })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiConflictResponse({ description: 'The order had no rider, or the named rider never accepted it' })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'File a complaint about a rider on behalf of whoever called in' })
  @Roles(EnumUserRole.ADMIN)
  async file(@common.Body() input: ComplaintCreateAdminInput, @CurrentUser() admin: UserEntity): Promise<ComplaintAdminDto> {
    return new ComplaintAdminDto(await this.complaintService.fileByAdmin(admin.id, input))
  }

  @common.Post(':id/decide')
  @common.HttpCode(200)
  @swagger.ApiOkResponse({ type: ComplaintAdminDto })
  @swagger.ApiBadRequestResponse({ type: errors.BadRequestException })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiConflictResponse({ description: "Waiting for the rider's reply, or already decided or withdrawn" })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'Record the outcome (only after the rider replied, for a complaint about a rider)' })
  @Roles(EnumUserRole.ADMIN)
  async decide(
    @common.Param('id') id: string,
    @common.Body() input: ComplaintDecideAdminInput,
    @CurrentUser() admin: UserEntity
  ): Promise<ComplaintAdminDto> {
    return new ComplaintAdminDto(await this.complaintService.decide(admin.id, id, input.outcome))
  }

  @common.Post(':id/withdraw')
  @common.HttpCode(200)
  @swagger.ApiOkResponse({ type: ComplaintAdminDto })
  @swagger.ApiBadRequestResponse({ type: errors.BadRequestException })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiConflictResponse({ description: 'Already decided or withdrawn' })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'Close it as withdrawn, with no finding against anyone' })
  @Roles(EnumUserRole.ADMIN)
  async withdraw(
    @common.Param('id') id: string,
    @common.Body() input: ComplaintWithdrawAdminInput,
    @CurrentUser() admin: UserEntity
  ): Promise<ComplaintAdminDto> {
    return new ComplaintAdminDto(await this.complaintService.withdraw(admin.id, id, input.reason))
  }

  // Cross check 2: only for a deactivated rider, who cannot log in to reply.
  @common.Post(':id/reply-for-rider')
  @common.HttpCode(200)
  @swagger.ApiOkResponse({ type: ComplaintAdminDto })
  @swagger.ApiBadRequestResponse({ type: errors.BadRequestException })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiConflictResponse({ description: 'The rider is active, or the complaint is not waiting for a reply' })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: "Enter a deactivated rider's reply taken by phone, or that they could not reply" })
  @Roles(EnumUserRole.ADMIN)
  async replyForRider(
    @common.Param('id') id: string,
    @common.Body() input: ComplaintReplyInput,
    @CurrentUser() admin: UserEntity
  ): Promise<ComplaintAdminDto> {
    return new ComplaintAdminDto(await this.complaintService.replyForRider(admin.id, id, input.text))
  }
}
