import { ApiProperty } from '@nestjs/swagger'
// `@Type` (class-transformer) says which class each array item becomes, so the rules on that class
// run for every point; `@ValidateNested` is what makes class-validator check them.
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator'
import { RefuseIfNotSentAsNumber } from 'src/decorators/refuseIfNotSentAsNumber.decorator'
import { MAX_TAP_AGE_MS } from 'src/domains/delivery-event/utils/occurred-at.util'

// The most points one request may carry (spec 0022, AC-5): 10 minutes of points at one every 5 s.
export const SOS_POINTS_PER_REQUEST_MAX = 120

// One position the phone took during an active SOS. Every number must arrive as a JSON number.
// A bad point refuses the whole batch with a 400 whose sentences name fields, never values (AC-13).
export class SosPointCourierInput {
  @ApiProperty({ type: Number, required: true, minimum: -90, maximum: 90 })
  @RefuseIfNotSentAsNumber()
  @IsLatitude()
  latitude: number

  @ApiProperty({ type: Number, required: true, minimum: -180, maximum: 180 })
  @RefuseIfNotSentAsNumber()
  @IsLongitude()
  longitude: number

  // The phone's own estimate of how far off the fix may be, in metres.
  @ApiProperty({ type: Number, required: false, minimum: 0 })
  @RefuseIfNotSentAsNumber()
  @ValidateIf((_input, value) => value !== undefined)
  @IsNumber()
  @Min(0)
  @Max(100000)
  accuracyMetres?: number

  // How long before sending the phone took this fix, in milliseconds (0 to 7 days).
  @ApiProperty({ type: Number, required: true })
  @RefuseIfNotSentAsNumber()
  @IsInt()
  @Min(0)
  @Max(MAX_TAP_AGE_MS)
  ageMs: number
}

export class SosPointsCourierInput {
  @ApiProperty({ type: [SosPointCourierInput], required: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(SOS_POINTS_PER_REQUEST_MAX)
  @ValidateNested({ each: true })
  @Type(() => SosPointCourierInput)
  points: SosPointCourierInput[]
}
