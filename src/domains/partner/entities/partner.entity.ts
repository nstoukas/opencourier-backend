import { Location, Partner } from '@prisma/types'
import { LocationEntity } from 'src/domains/location/entities/location.entity'

export class PartnerEntity implements Partner {
  id: string
  name: string
  logo: string | null
  phoneNumber: string | null
  webhookUrl: string | null

  userId: string | null
  pickupLocationId: string | null

  // Hydrated fields are populated only when the database query explicitly includes the relation.
  userEmail?: string | null
  pickupLocation?: LocationEntity | null

  createdAt: Date
  updatedAt: Date

  constructor(
    data: Partner & {
      user?: { email: string | null } | null
      pickupLocation?: Location | null
    },
  ) {
    this.id = data.id

    this.name = data.name
    this.logo = data.logo
    this.phoneNumber = data.phoneNumber
    this.webhookUrl = data.webhookUrl

    this.userId = data.userId
    this.pickupLocationId = data.pickupLocationId

    this.userEmail = data.user ? data.user.email : undefined

    // undefined = relation not loaded; null = loaded, partner has no pickup location
    if (data.pickupLocation) {
      this.pickupLocation = new LocationEntity(data.pickupLocation)
    } else {
      this.pickupLocation = data.pickupLocation === null ? null : undefined
    }

    this.createdAt = data.createdAt
    this.updatedAt = data.updatedAt
  }
}
