import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import { EnumUserRole } from '@prisma/types'
import { PARTNER_API_V1_PREFIX } from 'src/constants'
import { CurrentUserPartner } from 'src/decorators/currentUserPartner.decorator'
import { Roles } from 'src/decorators/roles.decorator'
import { ChatDomainService } from 'src/domains/chat/chat.domain.service'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import * as errors from 'src/errors'
import { ChatMessagePartyDto, ChatMessagesPartyDto } from '../dtos/chat-message.dto'
import { ChatMessagesArgs, ChatSendInputDto } from '../dtos/chat.inputs'

// Spec 0034 (chat), AC-14: a restaurant's one thread with dispatch, reached through the restaurant app's
// server side proxy. Only a signed in restaurant: no @ApiKeyAuth(), so an ordering API key on its own
// is refused here. Not proven yet: sent beside some other valid login, the key may still decide which
// restaurant this is (AuthMiddleware prefers the key), a mechanism older than chat, to be checked live
// and fixed as its own row (2026-11-18 review). The thread comes from the login, never from the request (AC-21).
@swagger.ApiBearerAuth()
@swagger.ApiTags('chat')
@common.Controller(`${PARTNER_API_V1_PREFIX}/chat`)
export class ChatPartnerRestApiController {
  constructor(private readonly chatDomainService: ChatDomainService) {}

  @common.Get('messages')
  // Every restaurant reaches the backend from the restaurant app's one IP, and its side sheet polls,
  // so the global limit of 30 requests a minute per IP would trip (AC-14).
  @SkipThrottle()
  @swagger.ApiOkResponse({ type: ChatMessagesPartyDto })
  @swagger.ApiUnauthorizedResponse({ type: errors.UnauthorizedException })
  @swagger.ApiOperation({ summary: 'A page of my messages with dispatch, oldest first' })
  @Roles(EnumUserRole.PARTNER)
  async listMessages(
    @CurrentUserPartner() partner: PartnerEntity,
    @common.Query() args: ChatMessagesArgs
  ): Promise<ChatMessagesPartyDto> {
    return new ChatMessagesPartyDto(
      await this.chatDomainService.listMessagesForParty({ partnerId: partner.id }, { before: args.before, after: args.after })
    )
  }

  @common.Post('messages')
  @swagger.ApiCreatedResponse({ type: ChatMessagePartyDto })
  @swagger.ApiBadRequestResponse({ type: errors.BadRequestException })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiUnauthorizedResponse({ type: errors.UnauthorizedException })
  @swagger.ApiConflictResponse({ description: 'The clientMessageId is already used by another sender' })
  @swagger.ApiOperation({ summary: 'Write to dispatch' })
  @Roles(EnumUserRole.PARTNER)
  async send(@CurrentUserPartner() partner: PartnerEntity, @common.Body() input: ChatSendInputDto): Promise<ChatMessagePartyDto> {
    if (partner.userId === null) {
      // A restaurant reaches here only through its login, so this is a broken row, not a user error.
      throw new common.ForbiddenException('This restaurant has no login')
    }
    const { thread, message } = await this.chatDomainService.send(
      { kind: 'PARTNER', userId: partner.userId, partnerId: partner.id },
      { body: input.body, deliveryId: input.deliveryId, clientMessageId: input.clientMessageId }
    )
    return new ChatMessagePartyDto(message, thread.dispatchLastReadAt)
  }
}
