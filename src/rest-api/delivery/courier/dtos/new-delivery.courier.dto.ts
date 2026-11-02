import { DeliveryCourierDto } from './delivery.courier.dto'
import { ApiProperty } from '@nestjs/swagger'
import { LocationCourierDto } from 'src/rest-api/location/courier/dto/location.courier.dto'
import { NewDeliveryCourier } from '../types/new-delivery.courier.type'
import { OfferTrip } from 'src/domains/delivery/offer-trip'
import { dropoffAreaOf } from 'src/domains/delivery/offer-card-payload'

// Spec 0019 (AC-1): the ride an offer means, for the offer card. Display only.
export class OfferTripCourierDto implements OfferTrip {
  @ApiProperty({ type: Number, nullable: true, description: 'Road metres from the rider to the restaurant' })
  toPickupMetres: number | null

  @ApiProperty({ type: Number, nullable: true, description: 'Road metres from the restaurant to the customer' })
  toDropoffMetres: number | null

  @ApiProperty({ type: Number, nullable: true, description: 'The whole ride in minutes, when both legs are known' })
  minutes: number | null
}

export class NewDeliveryCourierDto extends DeliveryCourierDto {
  @ApiProperty({ type: LocationCourierDto })
  pickupLocation: LocationCourierDto

  @ApiProperty({ type: LocationCourierDto })
  dropoffLocation: LocationCourierDto

  @ApiProperty({ type: OfferTripCourierDto })
  offerTrip: OfferTripCourierDto

  // The same area the offer push shows: the street, or the city when the street would give the
  // house away (spec 0019, AC-3).
  @ApiProperty({ type: String })
  dropoffArea: string

  constructor(data: NewDeliveryCourier, offerTrip: OfferTrip) {
    super(data)

    this.pickupLocation = new LocationCourierDto(data.pickupLocation)
    this.dropoffLocation = new LocationCourierDto(data.dropoffLocation)
    this.offerTrip = {
      toPickupMetres: offerTrip.toPickupMetres,
      toDropoffMetres: offerTrip.toDropoffMetres,
      minutes: offerTrip.minutes,
    }
    this.dropoffArea = dropoffAreaOf(data.dropoffLocation)
  }
}
