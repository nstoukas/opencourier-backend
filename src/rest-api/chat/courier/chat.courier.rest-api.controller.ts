import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import { EnumUserRole } from '@prisma/types'
import { COURIER_API_V1_PREFIX } from 'src/constants'
import { CurrentUserCourier } from 'src/decorators/currentUserCourier.decorator'
import { Roles } from 'src/decorators/roles.decorator'
import { ChatDomainService } from 'src/domains/chat/chat.domain.service'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import * as errors from 'src/errors'
import { ChatMessagePartyDto, ChatMessagesPartyDto } from '../dtos/chat-message.dto'
import { ChatMessagesArgs, ChatSendInputDto } from '../dtos/chat.inputs'

export class ChatQuickRepliesCourierDto {
  @swagger.ApiProperty({ type: String, isArray: true }) replies: string[]

  constructor(replies: string[]) {
    this.replies = replies
  }
}

// Spec 0034 (chat): a rider's one thread with dispatch. The thread is found from the rider's login,
// never from the request, so there is no route that names another rider's thread (AC-21).
@swagger.ApiBearerAuth()
@swagger.ApiTags('chat')
@common.Controller(`${COURIER_API_V1_PREFIX}/chat`)
export class ChatCourierRestApiController {
  constructor(private readonly chatDomainService: ChatDomainService) {}

  @common.Get('messages')
  // The rider's screen reads on open and polls while there is no live connection (AC-8).
  @SkipThrottle()
  @swagger.ApiOkResponse({ type: ChatMessagesPartyDto })
  @swagger.ApiUnauthorizedResponse({ type: errors.UnauthorizedException })
  @swagger.ApiOperation({ summary: 'A page of my messages with dispatch, oldest first' })
  @Roles(EnumUserRole.COURIER)
  async listMessages(
    @CurrentUserCourier() courier: CourierEntity,
    @common.Query() args: ChatMessagesArgs
  ): Promise<ChatMessagesPartyDto> {
    return new ChatMessagesPartyDto(
      await this.chatDomainService.listMessagesForParty({ courierId: courier.id }, { before: args.before, after: args.after })
    )
  }

  @common.Post('messages')
  @swagger.ApiCreatedResponse({ type: ChatMessagePartyDto })
  @swagger.ApiBadRequestResponse({ type: errors.BadRequestException })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiUnauthorizedResponse({ type: errors.UnauthorizedException })
  @swagger.ApiConflictResponse({ description: 'The clientMessageId is already used by another sender' })
  @swagger.ApiOperation({ summary: 'Write to dispatch' })
  @Roles(EnumUserRole.COURIER)
  async send(@CurrentUserCourier() courier: CourierEntity, @common.Body() input: ChatSendInputDto): Promise<ChatMessagePartyDto> {
    const { thread, message } = await this.chatDomainService.send(
      { kind: 'COURIER', userId: courier.userId, courierId: courier.id },
      { body: input.body, deliveryId: input.deliveryId, clientMessageId: input.clientMessageId }
    )
    return new ChatMessagePartyDto(message, thread.dispatchLastReadAt)
  }

  @common.Get('quick-replies')
  @SkipThrottle()
  @swagger.ApiOkResponse({ type: ChatQuickRepliesCourierDto })
  @swagger.ApiUnauthorizedResponse({ type: errors.UnauthorizedException })
  @swagger.ApiOperation({ summary: "The co-op's one tap presets for riders" })
  @Roles(EnumUserRole.COURIER)
  async quickReplies(): Promise<ChatQuickRepliesCourierDto> {
    return new ChatQuickRepliesCourierDto(await this.chatDomainService.courierQuickReplies())
  }
}
