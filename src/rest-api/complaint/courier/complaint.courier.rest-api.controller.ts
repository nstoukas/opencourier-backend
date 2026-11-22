import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'
import * as errors from 'src/errors'
import { EnumUserRole } from '@prisma/types'
import { COURIER_API_V1_PREFIX } from 'src/constants'
import { Roles } from 'src/decorators/roles.decorator'
import { CurrentUserCourier } from 'src/decorators/currentUserCourier.decorator'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { COMPLAINT_PHOTO_MAX_BYTES } from 'src/domains/complaint/complaint-photo'
import { ComplaintService } from 'src/services/complaint/complaint.service'
import { complaintPhotoResponse } from '../complaint-photo-response'
import { ComplaintCourierDto, ComplaintCourierPageDto } from '../dtos/complaint.dto'
import { ComplaintCreateCourierInput, ComplaintPageArgs, ComplaintReplyInput } from '../dtos/complaint.inputs'

// Spec 0052: a rider's complaints. They file about a restaurant or a customer from a job, read the
// complaints they filed and the ones about them, and reply to one about them. The session decides
// which rider; no route takes a rider id.
// Slice 2: the filing may carry one photo, and only the rider who filed it can read it back.
@swagger.ApiBearerAuth()
@swagger.ApiTags('complaints')
@common.Controller(`${COURIER_API_V1_PREFIX}/complaints`)
export class ComplaintCourierRestApiController {
  constructor(private readonly complaintService: ComplaintService) {}

  // Slice 2: JSON as before, or multipart/form-data with the same fields as text plus an optional file
  // field `photo`. `@UseInterceptors(FileInterceptor(...))` runs multer before the route: it reads the
  // multipart body into memory and hands the file to `@UploadedFile()`. Its limits refuse more than one
  // file or a file over 5 MB (413) before the service sees anything; a file under any other field name
  // is 400. For a JSON body multer does nothing. The service checks the bytes and re-encodes the photo.
  @common.Post()
  @common.UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: COMPLAINT_PHOTO_MAX_BYTES, files: 1, fields: 10, fieldSize: 16 * 1024, parts: 12 },
    })
  )
  @swagger.ApiConsumes('application/json', 'multipart/form-data')
  @swagger.ApiCreatedResponse({ type: ComplaintCourierDto })
  @swagger.ApiBadRequestResponse({ description: 'A bad field, or a photo that is not a readable JPEG or PNG' })
  @swagger.ApiNotFoundResponse({ description: 'Not one of my jobs within my Earnings reach' })
  @swagger.ApiConflictResponse({ description: 'I already have an open complaint about this job and party' })
  @swagger.ApiPayloadTooLargeResponse({ description: 'The photo is over 5 MB' })
  @swagger.ApiServiceUnavailableResponse({ description: 'A photo was sent and cannot be stored right now' })
  @swagger.ApiOperation({ summary: 'Complain about the restaurant or the customer of one of my jobs' })
  @Roles(EnumUserRole.COURIER)
  async file(
    @common.Body() input: ComplaintCreateCourierInput,
    @CurrentUserCourier() courier: CourierEntity,
    // `Express.Multer.File` = multer's description of an uploaded file; `buffer` holds its bytes.
    @common.UploadedFile() photo?: Express.Multer.File
  ): Promise<ComplaintCourierDto> {
    const complaint = await this.complaintService.fileByRider(courier.id, input, photo?.buffer ?? null)
    return new ComplaintCourierDto(complaint, courier.id)
  }

  @common.Get(':id/photo')
  @swagger.ApiProduces('image/jpeg')
  @swagger.ApiOkResponse({ description: 'The photo, as a JPEG with no metadata' })
  @swagger.ApiNotFoundResponse({ description: 'Not a complaint I filed, or it has no photo' })
  @swagger.ApiServiceUnavailableResponse({ description: 'The photo storage cannot be read right now' })
  @swagger.ApiOperation({ summary: 'The photo of a complaint I filed' })
  @Roles(EnumUserRole.COURIER)
  async photo(
    @common.Param('id') id: string,
    @CurrentUserCourier() courier: CourierEntity,
    // `passthrough: true` lets this set headers and still return the file for Nest to send.
    @common.Res({ passthrough: true }) res: Response
  ): Promise<common.StreamableFile> {
    return complaintPhotoResponse(res, await this.complaintService.photoForCourier(courier.id, id))
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
