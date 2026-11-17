import { ApiProperty } from '@nestjs/swagger'
import { IsIn, IsInt, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator'
import { RefuseIfNotSentAsString } from 'src/decorators/refuseIfNotSentAsString.decorator'
import { CHAT_TABS, ChatTab } from 'src/domains/chat/chat.domain.service'

// Spec 0034 (chat), AC-4 and AC-19. The body's 1 to 1000 characters are checked after trimming, in the
// domain service, so a message of spaces is refused the same way however it arrives.
// @RefuseIfNotSentAsString(): the ValidationPipe would otherwise turn a JSON number into text.
export class ChatSendInputDto {
  @ApiProperty({ type: String })
  @IsString()
  @RefuseIfNotSentAsString()
  body: string

  // The delivery this message is about. A rider or restaurant can tag only their own (AC-21).
  @ApiProperty({ type: String, required: false, nullable: true })
  @IsOptional()
  @IsString()
  @RefuseIfNotSentAsString()
  deliveryId?: string | null

  // The sender's own id for this message. A retry with the same id never makes a second message (AC-19).
  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 100)
  @RefuseIfNotSentAsString()
  clientMessageId: string
}

// Paging by message id (AC-8): `before` for older messages, `after` for newer ones, neither for the newest.
export class ChatMessagesArgs {
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  before?: string

  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  after?: string
}

export class ChatThreadsAdminArgs {
  @ApiProperty({ required: false, enum: CHAT_TABS })
  @IsOptional()
  @IsIn(CHAT_TABS)
  tab?: ChatTab

  // A rider's or restaurant's name, a rider's phone, or an order number (AC-2). Never logged (row 96).
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string

  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number
}

// AC-15: exactly one of the two. The service answers 400 when both or neither come.
export class ChatOpenThreadAdminInput {
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  @RefuseIfNotSentAsString()
  courierId?: string

  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  @RefuseIfNotSentAsString()
  partnerId?: string
}
