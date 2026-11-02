import { ApiProperty } from '@nestjs/swagger'
import { GeoPosition } from 'src/shared-types'

// A route is drawn in legs, in riding order (spec 0018, AC-1).
export enum DeliveryRouteLegKind {
  RIDER_TO_PICKUP = 'RIDER_TO_PICKUP',
  PICKUP_TO_DROPOFF = 'PICKUP_TO_DROPOFF',
  RIDER_TO_DROPOFF = 'RIDER_TO_DROPOFF',
}

export class DeliveryRoutePointCourierDto {
  @ApiProperty({ type: Number })
  latitude: number

  @ApiProperty({ type: Number })
  longitude: number
}

export class DeliveryRouteLegCourierDto {
  @ApiProperty({ enum: DeliveryRouteLegKind })
  kind: DeliveryRouteLegKind

  @ApiProperty({ type: Number, description: 'Whole metres along the road' })
  distanceMetres: number

  @ApiProperty({ type: Number, description: 'Whole seconds of riding, by the moped profile' })
  durationSeconds: number

  @ApiProperty({ type: DeliveryRoutePointCourierDto, isArray: true })
  points: GeoPosition[]
}

export class DeliveryRouteCourierDto {
  @ApiProperty({ type: DeliveryRouteLegCourierDto, isArray: true })
  legs: DeliveryRouteLegCourierDto[]

  constructor(legs: DeliveryRouteLegCourierDto[]) {
    this.legs = legs
  }
}
