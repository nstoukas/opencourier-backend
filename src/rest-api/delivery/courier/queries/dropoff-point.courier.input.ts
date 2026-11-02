import { ApiProperty } from '@nestjs/swagger'
import { IsLatitude, IsLongitude } from 'class-validator'
import { RefuseIfNotSentAsNumber } from 'src/decorators/refuseIfNotSentAsNumber.decorator'

// Where the rider stands at the customer's door, read by the app when the rider taps
// "Pin wrong? Set it where I stand" (spec 0016, AC-9). Both must arrive as JSON numbers.
export class DropoffPointCourierInput {
  @ApiProperty({ type: Number, required: true, minimum: -90, maximum: 90 })
  @RefuseIfNotSentAsNumber()
  @IsLatitude()
  latitude: number

  @ApiProperty({ type: Number, required: true, minimum: -180, maximum: 180 })
  @RefuseIfNotSentAsNumber()
  @IsLongitude()
  longitude: number
}
