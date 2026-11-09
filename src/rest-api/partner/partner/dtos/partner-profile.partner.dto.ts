import { ApiProperty } from '@nestjs/swagger'
import { LocationEntity } from 'src/domains/location/entities/location.entity'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { availabilityOf } from 'src/domains/partner/partner-availability'
import { PartnerAvailabilityPartnerDto } from './partner-availability.partner.dto'
import { PickupAddressPartnerDto } from './pickup-address.partner.dto'

export class PartnerProfileDto {
  @ApiProperty({ type: String })
  name: string

  @ApiProperty({ type: String, nullable: true })
  phoneNumber: string | null

  @ApiProperty({ type: PickupAddressPartnerDto, nullable: true })
  pickupAddress: PickupAddressPartnerDto | null

  // Spec 0023 (decision 21.13): the minutes this restaurant usually needs; the order form's Ready in
  // starts on it.
  @ApiProperty({ type: Number })
  usualPrepMinutes: number

  // Spec 0029, AC-7.
  @ApiProperty({ type: PartnerAvailabilityPartnerDto })
  availability: PartnerAvailabilityPartnerDto

  constructor(data: { partner: PartnerEntity; pickupLocation: LocationEntity | null }, now = new Date()) {
    this.name = data.partner.name
    this.phoneNumber = data.partner.phoneNumber
    this.pickupAddress = data.pickupLocation ? new PickupAddressPartnerDto(data.pickupLocation) : null
    this.usualPrepMinutes = data.partner.usualPrepMinutes
    this.availability = new PartnerAvailabilityPartnerDto(availabilityOf(data.partner, now))
  }
}
