import { ApiProperty } from '@nestjs/swagger'
import { EnumFoodOutcome } from '@prisma/types'
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator'
import { RefuseIfNotSentAsString } from 'src/decorators/refuseIfNotSentAsString.decorator'

// What happened to food picked up before a cancellation (spec 0015, AC-8).
export class FoodOutcomeCourierInput {
  @ApiProperty({ enum: EnumFoodOutcome, required: true })
  @IsEnum(EnumFoodOutcome)
  outcome: EnumFoodOutcome

  // Required with NOT_RETURNED (the service checks it), 1 to 500 characters.
  @ApiProperty({ type: String, required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @RefuseIfNotSentAsString()
  @MaxLength(500)
  note?: string
}
