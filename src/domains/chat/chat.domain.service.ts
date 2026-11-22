import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ChatPreset } from 'src/shared-types/config'
import { EnumChatSenderKind, EnumCourierStatus, EnumDeliveryStatus } from '@prisma/types'
import { CHAT_MESSAGE_MAX_LENGTH } from 'src/constants'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import {
  CHAT_PAGE_SIZE,
  ChatMessagePage,
  ChatMessageRow,
  ChatParty,
  ChatRepository,
  ChatThreadRow,
} from 'src/persistence/repositories/chat.repository'
import { searchWords } from 'src/rest-api/common/search-fold'
import { ChatMessageAdminDto, ChatMessagePartyDto } from 'src/rest-api/chat/dtos/chat-message.dto'
import { OfferPushService } from 'src/services/pushNotification/offer-push.service'
import { WebsocketDispatcher } from 'src/services/websocket/models/WebsocketDispatcher'

// Who is writing. The rider's and restaurant's ids come from their login (the auth guards), never
// from the request body (spec 0034, value sourcing).
export type ChatSender =
  | { kind: 'DISPATCH'; userId: string; threadId: string }
  | { kind: 'COURIER'; userId: string; courierId: string }
  | { kind: 'PARTNER'; userId: string; partnerId: string }

export type ChatSendInput = { body: string; deliveryId?: string | null; clientMessageId: string }

export const CHAT_TABS = ['UNREAD', 'COURIERS', 'RESTAURANTS', 'ALL'] as const
export type ChatTab = (typeof CHAT_TABS)[number]

export type ChatThreadListRow = {
  id: string
  kind: 'COURIER' | 'PARTNER'
  courierId: string | null
  partnerId: string | null
  name: string
  lastMessageAt: Date | null
  lastMessage: ChatMessageAdminDto | null
  // The newest order tagged in the thread (AC-2's "linked delivery").
  linkedDeliveryId: string | null
  linkedOrderReference: string | null
  unread: boolean
}

export type ChatThreadDetail = {
  id: string
  kind: 'COURIER' | 'PARTNER'
  courierId: string | null
  partnerId: string | null
  name: string
  phoneNumber: string | null
  // A rider's status, for the badge and the Offline note (AC-3, AC-10). Null for a restaurant.
  courierStatus: EnumCourierStatus | null
  activeDeliveries: { id: string; orderReference: string | null; status: EnumDeliveryStatus }[]
  moreActiveDeliveries: number
  // Spec 0054 (AC-7): both languages; the controller picks the reader's.
  quickReplies: ChatPreset[]
  dispatchLastReadAt: Date | null
}

export type ChatUnreadThread = {
  threadId: string
  oldestUnreadAt: Date
  courierId: string | null
  name: string
  // The newest unread message the rider or restaurant wrote (never dispatch's or a SYSTEM line).
  lastMessageBody: string | null
}

export const CHAT_BODY_REFUSAL = `A message must be 1 to ${CHAT_MESSAGE_MAX_LENGTH} characters`
export const CHAT_NO_LOGIN_REFUSAL = 'This restaurant has no login, so it could never read a reply'
export const CHAT_CLIENT_ID_TAKEN_REFUSAL = 'This clientMessageId is already used by another message'
// The same words whether the order does not exist or belongs to someone else (AC-21 gives nothing away);
// the rider's app shows it under the message and offers to send it without the order.
export const CHAT_TAG_REFUSAL = 'This message cannot be linked to that order, because it is not one of your orders now'

// Spec 0034 (chat): one continuing thread between dispatch and each rider and each restaurant.
//
// What this service never does (AC-6, AC-20, value 5): change a delivery, an offer or pay; count, time or
// rank anyone's messages; store when a rider or restaurant read something. A chat write reads delivery
// tables only to check a tag. No log line here carries a message body.
@Injectable()
export class ChatDomainService {
  private readonly logger = new Logger(ChatDomainService.name)

  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly configDomainService: ConfigDomainService,
    private readonly websocketDispatcher: WebsocketDispatcher,
    private readonly offerPushService: OfferPushService
  ) {}

  // AC-1, AC-4, AC-19: saves one message (or finds the one a retry already saved) and tells everyone live.
  async send(sender: ChatSender, input: ChatSendInput): Promise<{ thread: ChatThreadRow; message: ChatMessageRow }> {
    const body = checkBody(input.body)
    // The thread is only looked up here, not made: a first message whose tag is refused must leave
    // no empty thread behind (row 115). With no thread yet, no retry can have been stored either.
    const existing = await this.existingThreadFor(sender)

    // AC-19: a retry of a message already stored gets that message back, before the delivery tag is
    // checked. By the time a phone with bad signal retries, the delivery may have ended or gone to
    // another rider, and the message was saved anyway: the retry must not answer 404.
    const stored = existing ? await this.chatRepository.findByClientMessageId(existing.id, input.clientMessageId) : null
    if (existing && stored) {
      // Only the same sender's message counts as theirs; anyone else's under the same id is refused.
      if (stored.senderKind !== EnumChatSenderKind[sender.kind] || stored.senderUserId !== sender.userId) {
        throw new ConflictException(CHAT_CLIENT_ID_TAKEN_REFUSAL)
      }
      return { thread: existing, message: stored }
    }

    const deliveryId = await this.checkDeliveryTag(sender, input.deliveryId ?? null)
    // Only now, with the message allowed, is a rider's or restaurant's first thread made (AC-1).
    const thread = existing ?? (await this.threadFor(sender))

    const { message, created } = await this.chatRepository.createMessage({
      threadId: thread.id,
      senderKind: EnumChatSenderKind[sender.kind],
      senderUserId: sender.userId,
      body,
      deliveryId,
      clientMessageId: input.clientMessageId,
    })
    if (created) {
      this.publish(thread, message)
    }
    return { thread, message }
  }

  // AC-16: a rider's report repeated in their thread, written by the server. The caller (the report)
  // must not fail because of this, so it catches; this throws like any write.
  async addSystemLine(courierId: string, deliveryId: string, body: string): Promise<void> {
    const thread = await this.chatRepository.findOrCreateThread({ courierId })
    const { message } = await this.chatRepository.createMessage({
      threadId: thread.id,
      senderKind: EnumChatSenderKind.SYSTEM,
      senderUserId: null,
      body: body.slice(0, CHAT_MESSAGE_MAX_LENGTH),
      deliveryId,
      clientMessageId: null,
    })
    this.publish(thread, message)
  }

  // AC-2: one page of the thread list, newest first. Search matches every word against a rider's name
  // or phone, a restaurant's name, or any order tagged in the thread.
  async listThreads(input: {
    tab: ChatTab
    search?: string
    page: number
  }): Promise<{ threads: ChatThreadListRow[]; total: number; page: number; perPage: number }> {
    const unread = await this.chatRepository.findUnreadThreads()
    const unreadIds = new Set(unread.map((row) => row.threadId))

    let ids: string[] | null = null
    const words = searchWords(input.search)
    if (words.length > 0) {
      ids = await this.chatRepository.findThreadIdsMatching(words)
    }
    if (input.tab === 'UNREAD') {
      ids = ids === null ? [...unreadIds] : ids.filter((id) => unreadIds.has(id))
    }

    const { threads, total } = await this.chatRepository.findThreadPage({
      courierOnly: input.tab === 'COURIERS',
      partnerOnly: input.tab === 'RESTAURANTS',
      ids,
      page: input.page,
    })
    const { last, lastTagged } = await this.chatRepository.findLastMessages(threads.map((thread) => thread.id))

    return {
      threads: threads.map((thread) => {
        const name = partyName(thread)
        const lastMessage = last.get(thread.id)
        const tagged = lastTagged.get(thread.id)
        return {
          id: thread.id,
          kind: thread.courierId ? 'COURIER' : 'PARTNER',
          courierId: thread.courierId,
          partnerId: thread.partnerId,
          name,
          lastMessageAt: thread.lastMessageAt,
          lastMessage: lastMessage ? new ChatMessageAdminDto(lastMessage, name) : null,
          linkedDeliveryId: tagged?.deliveryId ?? null,
          linkedOrderReference: tagged?.delivery?.orderReference ?? null,
          unread: unreadIds.has(thread.id),
        }
      }),
      total,
      page: input.page,
      perPage: CHAT_PAGE_SIZE,
    }
  }

  // AC-2, AC-9: the sidebar's count of unread threads.
  async unreadCount(): Promise<number> {
    return (await this.chatRepository.findUnreadThreads()).length
  }

  // AC-17: the Dispatch board's UNREAD_MESSAGE rows, one per unread thread.
  async unreadThreadsForBoard(): Promise<ChatUnreadThread[]> {
    const unread = await this.chatRepository.findUnreadThreads()
    if (unread.length === 0) return []
    // Every unread thread, not a list page of 50: the board's own limit decides what is shown.
    const ids = unread.map((row) => row.threadId)
    const [threads, previews] = await Promise.all([
      this.chatRepository.findThreadsByIds(ids),
      this.chatRepository.findNewestUnreadBodies(ids),
    ])
    const byId = new Map(threads.map((thread) => [thread.id, thread]))
    return unread.flatMap((row) => {
      const thread = byId.get(row.threadId)
      if (!thread) return []
      return [
        {
          threadId: row.threadId,
          oldestUnreadAt: row.oldestUnreadAt,
          courierId: thread.courierId,
          name: partyName(thread),
          lastMessageBody: previews.get(row.threadId) ?? null,
        },
      ]
    })
  }

  // AC-15: an admin's Message button. Makes the thread if missing, so the page can open it ready to
  // write; it stays out of the list until someone writes (lastMessageAt is still empty).
  async openThread(party: ChatParty): Promise<ChatThreadRow> {
    if (party.courierId) {
      if (!(await this.chatRepository.findCourierForChat(party.courierId))) {
        throw new NotFoundException(`Courier ${party.courierId} not found`)
      }
    } else if (party.partnerId) {
      const partner = await this.chatRepository.findPartnerForChat(party.partnerId)
      if (!partner) {
        throw new NotFoundException(`Partner ${party.partnerId} not found`)
      }
      if (partner.userId === null) {
        throw new BadRequestException(CHAT_NO_LOGIN_REFUSAL)
      }
    }
    return this.chatRepository.findOrCreateThread(party)
  }

  // AC-3, AC-13: the conversation header and dispatch's presets.
  async getThreadDetail(threadId: string): Promise<ChatThreadDetail> {
    const thread = await this.requireThread(threadId)
    const party: ChatParty = thread.courierId ? { courierId: thread.courierId } : { partnerId: thread.partnerId as string }
    const [active, quickReplies] = await Promise.all([
      this.chatRepository.findActiveDeliveries(party),
      this.configDomainService.instanceConfig.getChatQuickRepliesDispatch(),
    ])
    return {
      id: thread.id,
      kind: thread.courierId ? 'COURIER' : 'PARTNER',
      courierId: thread.courierId,
      partnerId: thread.partnerId,
      name: partyName(thread),
      phoneNumber: thread.courier?.phoneNumber ?? thread.partner?.phoneNumber ?? null,
      courierStatus: thread.courier?.status ?? null,
      activeDeliveries: active.deliveries,
      moreActiveDeliveries: Math.max(0, active.total - active.deliveries.length),
      quickReplies,
      dispatchLastReadAt: thread.dispatchLastReadAt,
    }
  }

  async listMessagesForAdmin(threadId: string, page: ChatMessagePage): Promise<ChatMessageAdminDto[]> {
    const thread = await this.requireThread(threadId)
    const name = partyName(thread)
    const messages = await this.chatRepository.findMessages(threadId, page)
    return messages.map((message) => new ChatMessageAdminDto(message, name))
  }

  // AC-7: an admin opened the thread. Read for every admin up to its newest message, never backwards;
  // other admins' pages and the rider's phone hear of it only when the time really moved.
  async markReadByDispatch(threadId: string): Promise<Date | null> {
    const thread = await this.requireThread(threadId)
    const { dispatchLastReadAt, moved } = await this.chatRepository.markReadByDispatch(threadId)
    if (moved && dispatchLastReadAt) {
      const at = dispatchLastReadAt.toISOString()
      this.safely(() => this.websocketDispatcher.sendChatThreadRead({ threadId, dispatchLastReadAt: at }))
      if (thread.courier) {
        const courierUserId = thread.courier.userId
        this.safely(() => this.websocketDispatcher.sendChatReadByDispatch(courierUserId, { dispatchLastReadAt: at }))
      }
    }
    return dispatchLastReadAt
  }

  // A rider's or restaurant's own thread. With no thread yet there is nothing to show (AC-1: the
  // first message makes it).
  async listMessagesForParty(party: ChatParty, page: ChatMessagePage): Promise<ChatMessagePartyDto[]> {
    const thread = await this.chatRepository.findThreadByParty(party)
    if (!thread) return []
    const messages = await this.chatRepository.findMessages(thread.id, page)
    return messages.map((message) => new ChatMessagePartyDto(message, thread.dispatchLastReadAt))
  }

  // AC-13: a rider's presets.
  async courierQuickReplies(): Promise<ChatPreset[]> {
    return this.configDomainService.instanceConfig.getChatQuickRepliesCourier()
  }

  private async threadFor(sender: ChatSender): Promise<ChatThreadRow> {
    switch (sender.kind) {
      case 'DISPATCH':
        return this.requireThread(sender.threadId)
      case 'COURIER':
        return this.chatRepository.findOrCreateThread({ courierId: sender.courierId })
      case 'PARTNER':
        return this.chatRepository.findOrCreateThread({ partnerId: sender.partnerId })
    }
  }

  // The sender's thread if it exists, without making one. Dispatch writes only into an existing
  // thread, so a missing one is refused here as before.
  private async existingThreadFor(sender: ChatSender): Promise<ChatThreadRow | null> {
    switch (sender.kind) {
      case 'DISPATCH':
        return this.requireThread(sender.threadId)
      case 'COURIER':
        return this.chatRepository.findThreadByParty({ courierId: sender.courierId })
      case 'PARTNER':
        return this.chatRepository.findThreadByParty({ partnerId: sender.partnerId })
    }
  }

  private async requireThread(threadId: string): Promise<ChatThreadRow> {
    const thread = await this.chatRepository.findThreadById(threadId)
    if (!thread) {
      throw new NotFoundException(`Chat thread ${threadId} not found`)
    }
    return thread
  }

  // AC-21: a rider or restaurant can tag only their own delivery; anything else is the plain 404, the
  // same answer as a delivery that does not exist. An admin can tag any delivery that exists.
  private async checkDeliveryTag(sender: ChatSender, deliveryId: string | null): Promise<string | null> {
    if (deliveryId === null) return null
    const owners = await this.chatRepository.findDeliveryOwners(deliveryId)
    const theirs =
      owners !== null &&
      (sender.kind === 'DISPATCH' ||
        (sender.kind === 'COURIER' && owners.courierId === sender.courierId) ||
        (sender.kind === 'PARTNER' && owners.partnerId === sender.partnerId))
    if (!theirs) {
      throw new NotFoundException(CHAT_TAG_REFUSAL)
    }
    return deliveryId
  }

  // AC-8, AC-10, AC-11: the live news of a saved message. The message is already stored, so nothing here
  // may fail the send: each step is caught and logged by id.
  private publish(thread: ChatThreadRow, message: ChatMessageRow): void {
    const name = partyName(thread)
    this.safely(() =>
      this.websocketDispatcher.sendChatMessageToDispatch({
        threadId: thread.id,
        message: { ...new ChatMessageAdminDto(message, name) },
      })
    )
    if (!thread.courier) return

    const courier = thread.courier
    this.safely(() =>
      this.websocketDispatcher.sendChatMessageToCourier(courier.userId, {
        message: { ...new ChatMessagePartyDto(message, thread.dispatchLastReadAt) },
      })
    )
    // A rider's time off stays off (AC-10): an Offline rider gets no push; the message waits in the app.
    if (message.senderKind === EnumChatSenderKind.DISPATCH && courier.status !== EnumCourierStatus.OFFLINE) {
      this.offerPushService.chatMessage(courier.id, thread.id)
    }
  }

  private safely(send: () => Promise<void> | void): void {
    try {
      const result = send()
      if (result instanceof Promise) {
        result.catch((error) => this.logger.error(`Chat live message failed: ${error}`))
      }
    } catch (error) {
      this.logger.error(`Chat live message failed: ${error}`)
    }
  }
}

// AC-4: text only, trimmed, 1 to 1000 characters.
export function checkBody(body: unknown): string {
  const trimmed = typeof body === 'string' ? body.trim() : ''
  if (trimmed.length === 0 || trimmed.length > CHAT_MESSAGE_MAX_LENGTH) {
    throw new BadRequestException(CHAT_BODY_REFUSAL)
  }
  return trimmed
}

function partyName(thread: ChatThreadRow): string {
  if (thread.courier) {
    return `${thread.courier.firstName} ${thread.courier.lastName}`.trim()
  }
  return thread.partner?.name ?? ''
}
