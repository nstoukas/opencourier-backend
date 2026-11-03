import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { EnumUserRole } from '@prisma/types'
import { ADMIN_API_V1_PREFIX } from 'src/constants'
import { CurrentUser } from 'src/decorators/currentUser.decorator'
import { Roles } from 'src/decorators/roles.decorator'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import * as errors from 'src/errors'
import { ShiftSlotService } from 'src/services/shift-slot/shift-slot.service'
import { ShiftSlotAdminDto, ShiftSlotChangeAdminDto } from './dtos/shift-slot.admin.dto'
import { ShiftSlotCreateAdminInput, ShiftSlotUpdateAdminInput } from './queries/shift-slot.admin.input'

// The co-op's weekly shift slots (spec 0026, row 77): admins only.
@swagger.ApiBearerAuth()
@swagger.ApiTags('shift-slot')
@common.Controller(`${ADMIN_API_V1_PREFIX}/shift-slots`)
export class ShiftSlotAdminRestApiController {
  constructor(private readonly shiftSlotService: ShiftSlotService) {}

  // The current slots by weekday then start; with ?includeRemoved=true the removed ones too.
  @common.Get('')
  @swagger.ApiQuery({ name: 'includeRemoved', required: false, type: Boolean })
  @swagger.ApiOkResponse({ type: [ShiftSlotAdminDto] })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @Roles(EnumUserRole.ADMIN)
  // Only the text 'true' lists the removed slots. `String(...)` reads it whatever type the pipe hands
  // over (a declared string arrives as 'true', a declared boolean as true).
  async list(@common.Query('includeRemoved') includeRemoved?: unknown): Promise<ShiftSlotAdminDto[]> {
    const slots = await this.shiftSlotService.list(String(includeRemoved) === 'true')
    return slots.map((slot) => new ShiftSlotAdminDto(slot))
  }

  @common.Post('')
  @swagger.ApiBody({ type: ShiftSlotCreateAdminInput })
  @swagger.ApiCreatedResponse({ type: ShiftSlotAdminDto })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @Roles(EnumUserRole.ADMIN)
  async create(@common.Body() body: ShiftSlotCreateAdminInput, @CurrentUser() admin: UserEntity): Promise<ShiftSlotAdminDto> {
    return new ShiftSlotAdminDto(await this.shiftSlotService.create(body, admin.id))
  }

  @common.Patch(':id')
  @swagger.ApiBody({ type: ShiftSlotUpdateAdminInput })
  @swagger.ApiOkResponse({ type: ShiftSlotAdminDto })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiConflictResponse({ description: 'The slot changed since it was read' })
  @Roles(EnumUserRole.ADMIN)
  async update(
    @common.Param('id') id: string,
    @common.Body() body: ShiftSlotUpdateAdminInput,
    @CurrentUser() admin: UserEntity
  ): Promise<ShiftSlotAdminDto> {
    return new ShiftSlotAdminDto(await this.shiftSlotService.update(id, body, admin.id))
  }

  // 200 with the removed slot (no void method in the hand edited admin SDK).
  @common.Delete(':id')
  @common.HttpCode(200)
  @swagger.ApiOkResponse({ type: ShiftSlotAdminDto })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @Roles(EnumUserRole.ADMIN)
  async remove(@common.Param('id') id: string, @CurrentUser() admin: UserEntity): Promise<ShiftSlotAdminDto> {
    return new ShiftSlotAdminDto(await this.shiftSlotService.remove(id, admin.id))
  }

  // The slot's record, newest first; a removed slot's too.
  @common.Get(':id/changes')
  @swagger.ApiOkResponse({ type: [ShiftSlotChangeAdminDto] })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @Roles(EnumUserRole.ADMIN)
  async changes(@common.Param('id') id: string): Promise<ShiftSlotChangeAdminDto[]> {
    const changes = await this.shiftSlotService.changes(id)
    return changes.map((change) => new ShiftSlotChangeAdminDto(change))
  }
}
