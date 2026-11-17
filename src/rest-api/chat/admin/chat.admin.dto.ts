import { ApiProperty } from '@nestjs/swagger'
import { EnumCourierStatus, EnumDeliveryStatus } from '@prisma/types'
import { PaginationDto } from 'src/core/dtos/PaginationDto'
import { ChatThreadDetail, ChatThreadListRow } from 'src/domains/chat/chat.domain.service'
import { ChatMessageAdminDto } from '../dtos/chat-message.dto'

export class ChatThreadRowAdminDto {
  @ApiProperty() id: string
  @ApiProperty({ enum: ['COURIER', 'PARTNER'] }) kind: 'COURIER' | 'PARTNER'
  @ApiProperty({ type: String, nullable: true }) courierId: string | null
  @ApiProperty({ type: String, nullable: true }) partnerId: string | null
  @ApiProperty() name: string
  @ApiProperty({ type: Date, nullable: true }) lastMessageAt: Date | null
  @ApiProperty({ type: ChatMessageAdminDto, nullable: true }) lastMessage: ChatMessageAdminDto | null
  @ApiProperty({ type: String, nullable: true }) linkedDeliveryId: string | null
  @ApiProperty({ type: String, nullable: true }) linkedOrderReference: string | null
  @ApiProperty() unread: boolean

  constructor(row: ChatThreadListRow) {
    Object.assign(this, row)
  }
}

export class ChatThreadsAdminDto {
  @ApiProperty({ type: ChatThreadRowAdminDto, isArray: true }) data: ChatThreadRowAdminDto[]
  @ApiProperty({ type: PaginationDto }) pagination: PaginationDto

  constructor(input: { threads: ChatThreadListRow[]; total: number; page: number; perPage: number }) {
    this.data = input.threads.map((row) => new ChatThreadRowAdminDto(row))
    const totalPages = Math.ceil(input.total / input.perPage)
    this.pagination = {
      perPage: input.perPage,
      totalItems: input.total,
      totalPages,
      currentItems: input.threads.length,
      currentPage: input.page,
      prevPage: input.page > 1 ? input.page - 1 : null,
      nextPage: input.page < totalPages ? input.page + 1 : null,
    }
  }
}

export class ChatActiveDeliveryAdminDto {
  @ApiProperty() id: string
  @ApiProperty({ type: String, nullable: true }) orderReference: string | null
  @ApiProperty({ enum: EnumDeliveryStatus }) status: EnumDeliveryStatus
}

// AC-3: the conversation header. No vehicle (all mopeds), and nothing about the rider's position.
export class ChatThreadAdminDto {
  @ApiProperty() id: string
  @ApiProperty({ enum: ['COURIER', 'PARTNER'] }) kind: 'COURIER' | 'PARTNER'
  @ApiProperty({ type: String, nullable: true }) courierId: string | null
  @ApiProperty({ type: String, nullable: true }) partnerId: string | null
  @ApiProperty() name: string
  @ApiProperty({ type: String, nullable: true }) phoneNumber: string | null
  @ApiProperty({ enum: EnumCourierStatus, nullable: true }) courierStatus: EnumCourierStatus | null
  @ApiProperty({ type: ChatActiveDeliveryAdminDto, isArray: true }) activeDeliveries: ChatActiveDeliveryAdminDto[]
  @ApiProperty() moreActiveDeliveries: number
  @ApiProperty({ type: String, isArray: true }) quickReplies: string[]
  @ApiProperty({ type: Date, nullable: true }) dispatchLastReadAt: Date | null

  constructor(detail: ChatThreadDetail) {
    Object.assign(this, detail)
  }
}

export class ChatUnreadCountAdminDto {
  @ApiProperty() count: number

  constructor(count: number) {
    this.count = count
  }
}

export class ChatReadAdminDto {
  @ApiProperty({ type: Date, nullable: true }) dispatchLastReadAt: Date | null

  constructor(dispatchLastReadAt: Date | null) {
    this.dispatchLastReadAt = dispatchLastReadAt
  }
}
