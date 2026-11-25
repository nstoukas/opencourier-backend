import { ApiProperty } from '@nestjs/swagger'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { availabilityOf } from 'src/domains/partner/partner-availability'
import { LocationAdminDto } from 'src/rest-api/location/admin/dtos/location.admin.dto'
import { PartnerAvailabilityAdminDto } from './partner-availability.admin.dto'

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

  // Spec 0023: whole minutes this restaurant usually takes to prepare an order.
  @ApiProperty({ type: Number })
  usualPrepMinutes: number

  // Spec 0029, AC-7.
  @ApiProperty({ type: PartnerAvailabilityAdminDto })
  availability: PartnerAvailabilityAdminDto

  @ApiProperty({ type: String, nullable: true })
  userId: string | null

  @ApiProperty({ type: String, nullable: true })
  email: string | null

  // Spec 0037, AC-5: when the restaurant's current API key was made; null when it has none. The key
  // and its hash are never sent.
  @ApiProperty({ type: Date, nullable: true })
  apiKeyCreatedAt: Date | null

  // Row 162: when the restaurant's own password reset by email switched its key off. Null when the
  // restaurant has a key, never had one, or an admin made, replaced or removed it since.
  @ApiProperty({ type: Date, nullable: true })
  apiKeyRemovedByResetAt: Date | null

  @ApiProperty({ type: LocationAdminDto, nullable: true })
  pickupAddress: LocationAdminDto | null

  @ApiProperty({ type: Date })
  createdAt: Date

  @ApiProperty({ type: Date })
  updatedAt: Date

  constructor(data: PartnerEntity, now = new Date()) {
    this.id = data.id
    this.name = data.name
    this.phoneNumber = data.phoneNumber
    this.logo = data.logo
    this.webhookUrl = data.webhookUrl
    this.usualPrepMinutes = data.usualPrepMinutes
    this.availability = new PartnerAvailabilityAdminDto(availabilityOf(data, now))
    this.userId = data.userId
    this.email = data.userEmail ?? null
    this.apiKeyCreatedAt = data.userApiKeyCreatedAt ?? null
    this.apiKeyRemovedByResetAt = data.userApiKeyRemovedByResetAt ?? null
    this.pickupAddress = data.pickupLocation ? new LocationAdminDto(data.pickupLocation) : null
    this.createdAt = data.createdAt
    this.updatedAt = data.updatedAt
  }
}
