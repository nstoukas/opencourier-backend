import { Location, Partner } from '@prisma/types'
import { LocationEntity } from 'src/domains/location/entities/location.entity'

export class PartnerEntity implements Partner {
  id: string
  name: string
  logo: string | null
  phoneNumber: string | null
  webhookUrl: string | null
  // Whole minutes this restaurant usually needs to prepare an order (spec 0023).
  usualPrepMinutes: number

  // Spec 0029: busy mode, a pause and an admin's disable.
  busyExtraMinutes: number | null
  pausedUntil: Date | null
  disabledAt: Date | null
  disabledReason: string | null

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
    this.usualPrepMinutes = data.usualPrepMinutes
    this.busyExtraMinutes = data.busyExtraMinutes
    this.pausedUntil = data.pausedUntil
    this.disabledAt = data.disabledAt
    this.disabledReason = data.disabledReason

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
