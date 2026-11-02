import { ApiProperty } from '@nestjs/swagger'

// One restaurant on the courier app's restaurant layer (spec 0018, AC-4): its name and where
// riders collect from, nothing else.
export class PickupPointCourierDto {
  @ApiProperty({ type: String })
  id: string

  @ApiProperty({ type: String })
  name: string

  @ApiProperty({ type: Number })
  latitude: number

  @ApiProperty({ type: Number })
  longitude: number

  constructor(data: { id: string; name: string; latitude: number; longitude: number }) {
    this.id = data.id
    this.name = data.name
    this.latitude = data.latitude
    this.longitude = data.longitude
  }
}
