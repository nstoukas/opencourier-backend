import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import { EnumUserRole } from '@prisma/types'
import { ADMIN_API_V1_PREFIX } from 'src/constants'
import { CurrentUser } from 'src/decorators/currentUser.decorator'
import { Roles } from 'src/decorators/roles.decorator'
import { ChatDomainService } from 'src/domains/chat/chat.domain.service'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import * as errors from 'src/errors'
import { ChatMessageAdminDto } from '../dtos/chat-message.dto'
import { ChatMessagesArgs, ChatOpenThreadAdminInput, ChatSendInputDto, ChatThreadsAdminArgs } from '../dtos/chat.inputs'
import {
  ChatReadAdminDto,
  ChatThreadAdminDto,
  ChatThreadsAdminDto,
  ChatUnreadCountAdminDto,
} from './chat.admin.dto'

// Spec 0034 (chat): dispatch's shared inbox. Every admin reads and writes every thread (AC-21).
// The read routes carry @SkipThrottle: admins in one office share an IP, and the page polls as a
// backstop to the live connection (AC-8). The write routes stay under the global limit.
@swagger.ApiBearerAuth()
@swagger.ApiTags('chat')
@common.Controller(`${ADMIN_API_V1_PREFIX}/chat`)
export class ChatAdminRestApiController {
  constructor(private readonly chatDomainService: ChatDomainService) {}

  @common.Get('threads')
  @SkipThrottle()
  @swagger.ApiOkResponse({ type: ChatThreadsAdminDto })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'The chat inbox, newest first, 50 a page' })
  @Roles(EnumUserRole.ADMIN)
  async listThreads(@common.Query() args: ChatThreadsAdminArgs): Promise<ChatThreadsAdminDto> {
    return new ChatThreadsAdminDto(
      await this.chatDomainService.listThreads({ tab: args.tab ?? 'ALL', search: args.search, page: args.page ?? 1 })
    )
  }

  @common.Get('threads/unread-count')
  @SkipThrottle()
  @swagger.ApiOkResponse({ type: ChatUnreadCountAdminDto })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'How many threads have a message dispatch has not read' })
  @Roles(EnumUserRole.ADMIN)
  async unreadCount(): Promise<ChatUnreadCountAdminDto> {
    return new ChatUnreadCountAdminDto(await this.chatDomainService.unreadCount())
  }

  @common.Post('threads')
  @swagger.ApiCreatedResponse({ type: ChatThreadAdminDto })
  @swagger.ApiBadRequestResponse({ type: errors.BadRequestException })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: "Open a rider's or restaurant's thread, making it if missing" })
  @Roles(EnumUserRole.ADMIN)
  async openThread(
    @common.Body() input: ChatOpenThreadAdminInput,
    // Optional only so tests that call the method by hand keep compiling; Nest always passes it.
    @CurrentUser() user?: UserEntity
  ): Promise<ChatThreadAdminDto> {
    const hasCourier = typeof input.courierId === 'string' && input.courierId !== ''
    const hasPartner = typeof input.partnerId === 'string' && input.partnerId !== ''
    if (hasCourier === hasPartner) {
      throw new common.BadRequestException('Send exactly one of courierId and partnerId')
    }
    const thread = await this.chatDomainService.openThread(
      hasCourier ? { courierId: input.courierId as string } : { partnerId: input.partnerId as string }
    )
    // Spec 0054: the presets in this admin's language.
    return new ChatThreadAdminDto(await this.chatDomainService.getThreadDetail(thread.id), user?.language)
  }

  @common.Get('threads/:threadId')
  @SkipThrottle()
  @swagger.ApiOkResponse({ type: ChatThreadAdminDto })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: "One thread's header: who, their active deliveries, and the presets" })
  @Roles(EnumUserRole.ADMIN)
  async getThread(
    @common.Param('threadId') threadId: string,
    // Optional only so tests that call the method by hand keep compiling; Nest always passes it.
    @CurrentUser() user?: UserEntity
  ): Promise<ChatThreadAdminDto> {
    return new ChatThreadAdminDto(await this.chatDomainService.getThreadDetail(threadId), user?.language)
  }

  @common.Get('threads/:threadId/messages')
  @SkipThrottle()
  @swagger.ApiOkResponse({ type: ChatMessageAdminDto, isArray: true })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: "A page of one thread's messages, oldest first" })
  @Roles(EnumUserRole.ADMIN)
  async listMessages(
    @common.Param('threadId') threadId: string,
    @common.Query() args: ChatMessagesArgs
  ): Promise<ChatMessageAdminDto[]> {
    return this.chatDomainService.listMessagesForAdmin(threadId, { before: args.before, after: args.after })
  }

  @common.Post('threads/:threadId/messages')
  @swagger.ApiCreatedResponse({ type: ChatMessageAdminDto })
  @swagger.ApiBadRequestResponse({ type: errors.BadRequestException })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiConflictResponse({ description: 'The clientMessageId is already used by another sender' })
  @swagger.ApiOperation({ summary: 'Write to a rider or restaurant as dispatch' })
  @Roles(EnumUserRole.ADMIN)
  async send(
    @common.Param('threadId') threadId: string,
    @common.Body() input: ChatSendInputDto,
    @CurrentUser() admin: UserEntity
  ): Promise<ChatMessageAdminDto> {
    const { thread, message } = await this.chatDomainService.send(
      { kind: 'DISPATCH', userId: admin.id, threadId },
      { body: input.body, deliveryId: input.deliveryId, clientMessageId: input.clientMessageId }
    )
    const name = thread.courier ? `${thread.courier.firstName} ${thread.courier.lastName}`.trim() : thread.partner?.name ?? ''
    return new ChatMessageAdminDto(message, name)
  }

  @common.Post('threads/:threadId/read')
  @common.HttpCode(200)
  @swagger.ApiOkResponse({ type: ChatReadAdminDto })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiOperation({ summary: 'Mark a thread read for all of dispatch, up to its newest message' })
  @Roles(EnumUserRole.ADMIN)
  async markRead(@common.Param('threadId') threadId: string): Promise<ChatReadAdminDto> {
    return new ChatReadAdminDto(await this.chatDomainService.markReadByDispatch(threadId))
  }
}
