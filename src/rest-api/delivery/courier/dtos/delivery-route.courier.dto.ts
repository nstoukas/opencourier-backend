import { ApiProperty } from '@nestjs/swagger'
import { GeoPosition } from 'src/shared-types'

// A route is drawn in legs, in riding order (spec 0018, AC-1).
export enum DeliveryRouteLegKind {
  RIDER_TO_PICKUP = 'RIDER_TO_PICKUP',
  PICKUP_TO_DROPOFF = 'PICKUP_TO_DROPOFF',
  RIDER_TO_DROPOFF = 'RIDER_TO_DROPOFF',
  // Spec 0048 (AC-10): from one stop of a stack to the next (pickup or drop off, either order).
  BETWEEN_STOPS = 'BETWEEN_STOPS',
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

  @ApiProperty({ type: Number, required: false, description: 'Stack only: the number of the stop this leg ends at' })
  toStopNumber?: number
}

// Spec 0048 (AC-10): a numbered stop of a stack (1 to 4, in riding order).
export class DeliveryRouteStopCourierDto {
  @ApiProperty({ type: Number })
  number: number

  @ApiProperty({ type: String })
  deliveryId: string

  @ApiProperty({ enum: ['PICKUP', 'DROPOFF'] })
  stop: 'PICKUP' | 'DROPOFF'

  @ApiProperty({ type: Number })
  latitude: number

  @ApiProperty({ type: Number })
  longitude: number

  @ApiProperty({ type: Boolean, description: 'Already behind the rider; no leg goes to it' })
  done: boolean
}

export class DeliveryRouteCourierDto {
  @ApiProperty({ type: DeliveryRouteLegCourierDto, isArray: true })
  legs: DeliveryRouteLegCourierDto[]

  // Spec 0048 (AC-10): the stack's stops, the waypoints the legs pass through; empty for a single delivery.
  @ApiProperty({ type: DeliveryRouteStopCourierDto, isArray: true })
  stops: DeliveryRouteStopCourierDto[]

  constructor(legs: DeliveryRouteLegCourierDto[], stops: DeliveryRouteStopCourierDto[] = []) {
    this.legs = legs
    this.stops = stops
  }
}
