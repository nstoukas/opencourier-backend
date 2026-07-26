import { ApiProperty } from '@nestjs/swagger'
import { LocationEntity } from 'src/domains/location/entities/location.entity'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { PickupAddressPartnerDto } from './pickup-address.partner.dto'

export class PartnerProfileDto {
  @ApiProperty({ type: String })
  name: string

  @ApiProperty({ type: String, nullable: true })
  phoneNumber: string | null

  @ApiProperty({ type: PickupAddressPartnerDto, nullable: true })
  pickupAddress: PickupAddressPartnerDto | null

  constructor(data: { partner: PartnerEntity; pickupLocation: LocationEntity | null }) {
    this.name = data.partner.name
    this.phoneNumber = data.partner.phoneNumber
    this.pickupAddress = data.pickupLocation ? new PickupAddressPartnerDto(data.pickupLocation) : null
  }
}
