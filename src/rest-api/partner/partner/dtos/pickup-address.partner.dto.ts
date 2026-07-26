import { ApiProperty } from '@nestjs/swagger'
import { EnumCountryCode } from '@prisma/types'
import { LocationEntity } from 'src/domains/location/entities/location.entity'

export class PickupAddressPartnerDto {
  @ApiProperty({ type: String, nullable: true })
  street: string | null

  @ApiProperty({ type: String, nullable: true })
  houseNumber: string | null

  @ApiProperty({ type: String, nullable: true })
  city: string | null

  @ApiProperty({ type: String, nullable: true })
  state: string | null

  @ApiProperty({ type: String, nullable: true })
  zipCode: string | null

  @ApiProperty({ enum: EnumCountryCode })
  countryCode: EnumCountryCode

  @ApiProperty({ type: Number })
  latitude: number

  @ApiProperty({ type: Number })
  longitude: number

  @ApiProperty({ type: String, nullable: true })
  formattedAddress: string | null

  constructor(data: LocationEntity) {
    this.street = data.street
    this.houseNumber = data.houseNumber
    this.city = data.city
    this.state = data.state
    this.zipCode = data.zipCode
    this.countryCode = data.countryCode
    this.latitude = data.latitude
    this.longitude = data.longitude
    this.formattedAddress = data.formattedAddress
  }
}
