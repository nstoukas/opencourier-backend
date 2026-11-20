import { ApiProperty } from '@nestjs/swagger'
import { PaginationDto } from 'src/core/dtos/PaginationDto'

// Spec 0038, AC-11: the "How offers and pay work" page, as plain sentences from the live settings.
export class HowItWorksCourierDto {
  @ApiProperty({ type: [String] }) offers: string[]
  @ApiProperty({ type: [String] }) pay: string[]
  @ApiProperty({ type: [String] }) personDecides: string[]
  @ApiProperty({ type: [String] }) appRecords: string[]
  // Spec 0040 (AC-13): how time worked is counted.
  @ApiProperty({ type: [String] }) timeWorked: string[]
  // Spec 0042 (AC-14): how the Earnings figures are counted.
  @ApiProperty({ type: [String] }) earningsFigures: string[]
  @ApiProperty({ type: Number }) reviewAnswerDays: number
}

// Spec 0038, AC-13: one line of the rider's "What changed" list. Never names a person.
export class SettingChangeCourierDto {
  @ApiProperty({ type: Date }) at: Date
  @ApiProperty({ type: String }) label: string
  @ApiProperty({ type: String }) oldText: string
  @ApiProperty({ type: String }) newText: string
}

export class SettingChangeCourierPageDto {
  @ApiProperty({ type: () => [SettingChangeCourierDto] }) data: SettingChangeCourierDto[]
  @ApiProperty({ type: () => PaginationDto, required: false }) pagination?: PaginationDto
}

// Spec 0038, AC-13: one line of the admin's Change history, with the person's login.
export class SettingChangeAdminDto {
  @ApiProperty({ type: String }) id: string
  @ApiProperty({ type: Date }) at: Date
  @ApiProperty({ type: String }) key: string
  @ApiProperty({ type: String }) label: string
  @ApiProperty({ type: String, nullable: true }) subject: string | null
  @ApiProperty({ nullable: true }) oldValue: unknown
  @ApiProperty({ nullable: true }) newValue: unknown
  @ApiProperty({ type: String, nullable: true }) changedBy: string | null
}

export class SettingChangeAdminPageDto {
  @ApiProperty({ type: () => [SettingChangeAdminDto] }) data: SettingChangeAdminDto[]
  @ApiProperty({ type: () => PaginationDto, required: false }) pagination?: PaginationDto
  // When the first change was recorded: the record starts on the day spec 0038 shipped.
  @ApiProperty({ type: Date, nullable: true }) recordedSince: Date | null
}
