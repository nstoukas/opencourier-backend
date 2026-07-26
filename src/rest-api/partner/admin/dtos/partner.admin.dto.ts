import { ApiProperty } from '@nestjs/swagger'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { LocationAdminDto } from 'src/rest-api/location/admin/dtos/location.admin.dto'

export class PartnerAdminDto {
  @ApiProperty({ type: String })
  id: string

  @ApiProperty({ type: String })
  name: string

  @ApiProperty({ type: String, nullable: true })
  phoneNumber: string | null

  @ApiProperty({ type: String, nullable: true })
  logo: string | null

  @ApiProperty({ type: String, nullable: true })
  webhookUrl: string | null

  @ApiProperty({ type: String, nullable: true })
  userId: string | null

  @ApiProperty({ type: String, nullable: true })
  email: string | null

  @ApiProperty({ type: LocationAdminDto, nullable: true })
  pickupAddress: LocationAdminDto | null

  @ApiProperty({ type: Date })
  createdAt: Date

  @ApiProperty({ type: Date })
  updatedAt: Date

  constructor(data: PartnerEntity) {
    this.id = data.id
    this.name = data.name
    this.phoneNumber = data.phoneNumber
    this.logo = data.logo
    this.webhookUrl = data.webhookUrl
    this.userId = data.userId
    this.email = data.userEmail ?? null
    this.pickupAddress = data.pickupLocation ? new LocationAdminDto(data.pickupLocation) : null
    this.createdAt = data.createdAt
    this.updatedAt = data.updatedAt
  }
}
