import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import * as errors from 'src/errors'
import { EnumUserRole } from '@prisma/types'
import { ADMIN_API_V1_PREFIX } from 'src/constants'
import { Roles } from 'src/decorators/roles.decorator'
import { CurrentUser } from 'src/decorators/currentUser.decorator'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import { SplitRequestService } from 'src/services/split-request/split-request.service'
import { SplitConfirmAdminInput, SplitRefuseAdminInput, SplitRequestAdminDto } from '../dtos/split-request.dto'

// Spec 0047 (AC-4, AC-9): the admin's Split requests queue. Each open request is answered once: a second
// answer, or an answer after the rider left, is 409.
@swagger.ApiBearerAuth()
@swagger.ApiTags('split-requests')
@common.Controller(`${ADMIN_API_V1_PREFIX}/split-requests`)
export class SplitRequestAdminRestApiController {
  constructor(private readonly splitRequestService: SplitRequestService) {}

  @common.Get()
  @swagger.ApiOkResponse({ type: [SplitRequestAdminDto] })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'Open split requests, oldest first' })
  @Roles(EnumUserRole.ADMIN)
  async list(): Promise<SplitRequestAdminDto[]> {
    const now = new Date()
    return (await this.splitRequestService.listOpen()).map((request) => new SplitRequestAdminDto(request, now))
  }

  // Declared before ':id', so "count" is never read as an id.
  @common.Get('count')
  @swagger.ApiOkResponse({ description: '{ open: number }' })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'How many split requests are open' })
  @Roles(EnumUserRole.ADMIN)
  async count(): Promise<{ open: number }> {
    return { open: await this.splitRequestService.countOpen() }
  }

  @common.Post(':id/confirm')
  @common.HttpCode(200)
  @swagger.ApiOkResponse({ description: '{ status: "CONFIRMED" }' })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiConflictResponse({ description: 'Already answered or closed, too many legs, or the order changed' })
  @swagger.ApiOperation({ summary: 'Split the order as proposed, or with these boxes' })
  @Roles(EnumUserRole.ADMIN)
  async confirm(
    @common.Param('id') id: string,
    @common.Body() input: SplitConfirmAdminInput,
    @CurrentUser() user: UserEntity
  ): Promise<{ status: 'CONFIRMED' }> {
    await this.splitRequestService.confirm({ id: user.id }, id, input.legs)
    return { status: 'CONFIRMED' }
  }

  @common.Post(':id/refuse')
  @common.HttpCode(200)
  @swagger.ApiOkResponse({ description: '{ status: "REFUSED" }' })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiConflictResponse({ description: 'Already answered or closed' })
  @swagger.ApiOperation({ summary: 'It fits: the rider carries the order as is' })
  @Roles(EnumUserRole.ADMIN)
  async refuse(
    @common.Param('id') id: string,
    @common.Body() input: SplitRefuseAdminInput,
    @CurrentUser() user: UserEntity
  ): Promise<{ status: 'REFUSED' }> {
    await this.splitRequestService.refuse({ id: user.id }, id, input.note ?? null)
    return { status: 'REFUSED' }
  }
}
