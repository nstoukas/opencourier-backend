import { ApiProperty } from '@nestjs/swagger'
import { EnumDispatchStopReason } from '@prisma/types'
import { Type } from 'class-transformer'
import { IsEnum, IsOptional, Matches, ValidateNested } from 'class-validator'

// A date and a time in Athens time, as the admin typed them (spec 0014, AC-2).
export class LocalDateTimeInput {
  @ApiProperty({ type: String, example: '2026-07-15' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date: string

  @ApiProperty({ type: String, example: '12:00' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'time must be HH:mm' })
  time: string
}

// Stop now (no startsOn; endsOn optional: "until I restart" when left out) or schedule a stop
// (startsOn and endsOn), both in Athens time (spec 0014, AC-1, AC-2).
export class DispatchStopCreateAdminInput {
  @ApiProperty({ enum: EnumDispatchStopReason })
  @IsEnum(EnumDispatchStopReason)
  reason: EnumDispatchStopReason

  // `@ValidateNested` with `@Type` makes the pipe check the inner object's own rules too.
  @ApiProperty({ type: LocalDateTimeInput, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalDateTimeInput)
  startsOn?: LocalDateTimeInput

  @ApiProperty({ type: LocalDateTimeInput, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalDateTimeInput)
  endsOn?: LocalDateTimeInput
}
