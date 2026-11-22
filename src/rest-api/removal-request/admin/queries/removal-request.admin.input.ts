import { ApiProperty } from '@nestjs/swagger'
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength } from 'class-validator'
import { RefuseIfNotSentAsBoolean } from 'src/decorators/refuseIfNotSentAsBoolean.decorator'
import { RefuseIfNotSentAsNumber } from 'src/decorators/refuseIfNotSentAsNumber.decorator'
import { RefuseIfNotSentAsString } from 'src/decorators/refuseIfNotSentAsString.decorator'

// Spec 0035, AC-8: the `pickedUp` the admin saw on the board, so a stale board cannot cancel an order.
export class RemovalApproveAdminInput {
  @ApiProperty({ type: Boolean })
  @RefuseIfNotSentAsBoolean()
  @IsBoolean()
  pickedUp: boolean
}

export class RemovalDeclineAdminInput {
  @ApiProperty({ type: String, required: false, maxLength: 500 })
  @IsOptional()
  @RefuseIfNotSentAsString()
  @IsString()
  @MaxLength(500)
  note?: string
}

export class RemovalReasonCreateAdminInput {
  @ApiProperty({ type: String, maxLength: 60 })
  @RefuseIfNotSentAsString()
  @IsString()
  @MaxLength(60)
  label: string

  // Spec 0054 (AC-7): the same label in Greek. Optional here so an older admin page still saves; an empty
  // text clears it, and the apps then show the English label.
  @ApiProperty({ type: String, required: false, maxLength: 60, nullable: true })
  @IsOptional()
  @RefuseIfNotSentAsString()
  @IsString()
  @MaxLength(60)
  labelEl?: string | null

  @ApiProperty({ type: Boolean, required: false })
  @IsOptional()
  @RefuseIfNotSentAsBoolean()
  @IsBoolean()
  paidToRider?: boolean

  @ApiProperty({ type: Boolean, required: false })
  @IsOptional()
  @RefuseIfNotSentAsBoolean()
  @IsBoolean()
  chargedToRestaurant?: boolean

  @ApiProperty({ type: Boolean, required: false })
  @IsOptional()
  @RefuseIfNotSentAsBoolean()
  @IsBoolean()
  needsNote?: boolean
}

// Every field optional: only what was sent is changed. `position` is editable here only.
export class RemovalReasonUpdateAdminInput {
  @ApiProperty({ type: String, required: false, maxLength: 60 })
  @IsOptional()
  @RefuseIfNotSentAsString()
  @IsString()
  @MaxLength(60)
  label?: string

  // Spec 0054 (AC-7): the same label in Greek. Optional here so an older admin page still saves; an empty
  // text clears it, and the apps then show the English label.
  @ApiProperty({ type: String, required: false, maxLength: 60, nullable: true })
  @IsOptional()
  @RefuseIfNotSentAsString()
  @IsString()
  @MaxLength(60)
  labelEl?: string | null

  @ApiProperty({ type: Boolean, required: false })
  @IsOptional()
  @RefuseIfNotSentAsBoolean()
  @IsBoolean()
  paidToRider?: boolean

  @ApiProperty({ type: Boolean, required: false })
  @IsOptional()
  @RefuseIfNotSentAsBoolean()
  @IsBoolean()
  chargedToRestaurant?: boolean

  @ApiProperty({ type: Boolean, required: false })
  @IsOptional()
  @RefuseIfNotSentAsBoolean()
  @IsBoolean()
  needsNote?: boolean

  @ApiProperty({ type: Number, required: false })
  @IsOptional()
  @RefuseIfNotSentAsNumber()
  @IsInt()
  position?: number
}
