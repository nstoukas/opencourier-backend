import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { EnumChatSenderKind } from '@prisma/types'
import { ChatMessageRow } from 'src/persistence/repositories/chat.repository'

// Spec 0034 (chat), AC-5: riders and restaurants see every dispatch message as from "Dispatch".
export const DISPATCH_SENDER_NAME = 'Dispatch'

// A message as an admin sees it (AC-5): the colleague who wrote it, by username, else email.
// Nothing about whether a rider or restaurant read it exists to put here (AC-6).
export class ChatMessageAdminDto {
  @ApiProperty() id: string
  @ApiProperty() threadId: string
  @ApiProperty({ enum: EnumChatSenderKind }) senderKind: EnumChatSenderKind
  // The colleague for DISPATCH, the rider or restaurant for theirs, null for a SYSTEM line or a deleted account.
  @ApiProperty({ type: String, nullable: true }) senderName: string | null
  @ApiProperty() body: string
  @ApiProperty({ type: String, nullable: true }) deliveryId: string | null
  @ApiProperty({ type: String, nullable: true }) orderReference: string | null
  @ApiProperty() createdAt: Date

  // `partyName` is the rider's or restaurant's name, read from the thread.
  constructor(message: ChatMessageRow, partyName: string | null) {
    this.id = message.id
    this.threadId = message.threadId
    this.senderKind = message.senderKind
    this.senderName = adminSenderName(message, partyName)
    this.body = message.body
    this.deliveryId = message.deliveryId
    this.orderReference = message.delivery?.orderReference ?? null
    this.createdAt = message.createdAt
  }
}

function adminSenderName(message: ChatMessageRow, partyName: string | null): string | null {
  switch (message.senderKind) {
    case EnumChatSenderKind.DISPATCH:
      return message.senderUser?.username || message.senderUser?.email || null
    case EnumChatSenderKind.COURIER:
    case EnumChatSenderKind.PARTNER:
      return partyName
    default:
      return null
  }
}

// A message as a rider or a restaurant sees it in their own thread (AC-5, AC-6). Dispatch is "Dispatch",
// never a colleague's name. `readByDispatch` is on their own messages only, and absent (not false) on
// every other: it says whether any admin opened the thread after it arrived. No field anywhere says
// whether the rider or restaurant read something.
export class ChatMessagePartyDto {
  @ApiProperty() id: string
  @ApiProperty({ enum: EnumChatSenderKind }) senderKind: EnumChatSenderKind
  @ApiProperty({ type: String, nullable: true }) senderName: string | null
  @ApiProperty() body: string
  @ApiProperty({ type: String, nullable: true }) deliveryId: string | null
  @ApiProperty({ type: String, nullable: true }) orderReference: string | null
  // The sender's own id for the message, so a phone can match a retried send to the stored one (AC-19).
  // Only on the rider's or restaurant's own messages.
  @ApiPropertyOptional({ type: String }) clientMessageId?: string
  @ApiProperty() createdAt: Date
  @ApiPropertyOptional({ type: Boolean }) readByDispatch?: boolean

  constructor(message: ChatMessageRow, dispatchLastReadAt: Date | null) {
    this.id = message.id
    this.senderKind = message.senderKind
    this.senderName = message.senderKind === EnumChatSenderKind.DISPATCH ? DISPATCH_SENDER_NAME : null
    this.body = message.body
    this.deliveryId = message.deliveryId
    this.orderReference = message.delivery?.orderReference ?? null
    this.createdAt = message.createdAt
    if (isOwnMessage(message.senderKind)) {
      if (message.clientMessageId !== null) {
        this.clientMessageId = message.clientMessageId
      }
      this.readByDispatch = dispatchLastReadAt !== null && message.createdAt <= dispatchLastReadAt
    }
  }
}

function isOwnMessage(kind: EnumChatSenderKind): boolean {
  return kind === EnumChatSenderKind.COURIER || kind === EnumChatSenderKind.PARTNER
}

export class ChatMessagesPartyDto {
  @ApiProperty({ type: ChatMessagePartyDto, isArray: true }) messages: ChatMessagePartyDto[]

  constructor(messages: ChatMessagePartyDto[]) {
    this.messages = messages
  }
}
