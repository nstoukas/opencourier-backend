import { ApiProperty } from '@nestjs/swagger'
import { IsInt, Max, Min, ValidateIf } from 'class-validator'
import { RefuseIfNotSentAsNumber } from 'src/decorators/refuseIfNotSentAsNumber.decorator'

// Spec 0026 (AC-1, AC-4): a weekly slot in Athens wall time. Each field must arrive as a JSON number
// (@RefuseIfNotSentAsNumber: the ValidationPipe would otherwise turn "", true and false into numbers).
// The end after the start is checked on the whole slot in the service, since an edit may send one side.
export class ShiftSlotCreateAdminInput {
  @ApiProperty({ type: Number, minimum: 1, maximum: 7, description: 'ISO weekday: 1 Monday to 7 Sunday' })
  @RefuseIfNotSentAsNumber()
  @IsInt({ message: 'The day must be a whole number from 1 (Monday) to 7 (Sunday).' })
  @Min(1, { message: 'The day must be a whole number from 1 (Monday) to 7 (Sunday).' })
  @Max(7, { message: 'The day must be a whole number from 1 (Monday) to 7 (Sunday).' })
  weekday: number

  @ApiProperty({ type: Number, minimum: 0, maximum: 1439, description: 'Minutes after midnight' })
  @RefuseIfNotSentAsNumber()
  @IsInt({ message: 'The start must be a whole minute from 00:00 to 23:59.' })
  @Min(0, { message: 'The start must be a whole minute from 00:00 to 23:59.' })
  @Max(1439, { message: 'The start must be a whole minute from 00:00 to 23:59.' })
  startMinute: number

  @ApiProperty({ type: Number, minimum: 1, maximum: 1440, description: 'Minutes after midnight; 1440 is 24:00' })
  @RefuseIfNotSentAsNumber()
  @IsInt({ message: 'The end must be a whole minute from 00:01 to 24:00.' })
  @Min(1, { message: 'The end must be a whole minute from 00:01 to 24:00.' })
  @Max(1440, { message: 'The end must be a whole minute from 00:01 to 24:00.' })
  endMinute: number

  @ApiProperty({ type: Number, minimum: 1, maximum: 50 })
  @RefuseIfNotSentAsNumber()
  @IsInt({ message: 'The rider cap must be a whole number from 1 to 50.' })
  @Min(1, { message: 'The rider cap must be a whole number from 1 to 50.' })
  @Max(50, { message: 'The rider cap must be a whole number from 1 to 50.' })
  riderCap: number
}

// An edit sends any of the four; one left out keeps its stored value. Sent as null is refused, like
// the other number inputs here (@IsOptional would let null through).
export class ShiftSlotUpdateAdminInput {
  @ApiProperty({ type: Number, required: false, minimum: 1, maximum: 7 })
  @RefuseIfNotSentAsNumber()
  @ValidateIf((_input, value) => value !== undefined)
  @IsInt({ message: 'The day must be a whole number from 1 (Monday) to 7 (Sunday).' })
  @Min(1, { message: 'The day must be a whole number from 1 (Monday) to 7 (Sunday).' })
  @Max(7, { message: 'The day must be a whole number from 1 (Monday) to 7 (Sunday).' })
  weekday?: number

  @ApiProperty({ type: Number, required: false, minimum: 0, maximum: 1439 })
  @RefuseIfNotSentAsNumber()
  @ValidateIf((_input, value) => value !== undefined)
  @IsInt({ message: 'The start must be a whole minute from 00:00 to 23:59.' })
  @Min(0, { message: 'The start must be a whole minute from 00:00 to 23:59.' })
  @Max(1439, { message: 'The start must be a whole minute from 00:00 to 23:59.' })
  startMinute?: number

  @ApiProperty({ type: Number, required: false, minimum: 1, maximum: 1440 })
  @RefuseIfNotSentAsNumber()
  @ValidateIf((_input, value) => value !== undefined)
  @IsInt({ message: 'The end must be a whole minute from 00:01 to 24:00.' })
  @Min(1, { message: 'The end must be a whole minute from 00:01 to 24:00.' })
  @Max(1440, { message: 'The end must be a whole minute from 00:01 to 24:00.' })
  endMinute?: number

  @ApiProperty({ type: Number, required: false, minimum: 1, maximum: 50 })
  @RefuseIfNotSentAsNumber()
  @ValidateIf((_input, value) => value !== undefined)
  @IsInt({ message: 'The rider cap must be a whole number from 1 to 50.' })
  @Min(1, { message: 'The rider cap must be a whole number from 1 to 50.' })
  @Max(50, { message: 'The rider cap must be a whole number from 1 to 50.' })
  riderCap?: number
}
