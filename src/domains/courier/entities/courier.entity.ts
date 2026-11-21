import { Courier, EnumCourierDeliverySetting, EnumCourierStatus, EnumStripeAccountStatus } from '@prisma/types'
import { GeoPosition } from 'src/shared-types'

export class CourierEntity implements Courier {
  id: string
  node_uri: string | null
  firstName: string
  lastName: string
  phoneNumber: string | null
  status: EnumCourierStatus
  deliverySetting: EnumCourierDeliverySetting
  rejectedOffers: string[]

  stripeAccountId: string | null
  stripeAccountStatus: EnumStripeAccountStatus

  currentLocation?: GeoPosition | null

  // Spec 0025: the admin search's folded copy of the searched fields. Declared because the Prisma
  // model has it, never copied from the row: folded personal data stops at the repository.
  // `declare` emits nothing at runtime, so a serialised entity (the partner webhook posts whole
  // entities) never gains a "searchFold" key (row 98 review, decision 98.3).
  declare searchFold: string | null

  // Spec 0034: when the position was last written. Declared because the Prisma model has it, never
  // copied from the row, like searchFold: only the dispatch board's query reads it (AC-13).
  declare currentLocationAt: Date | null

  // Spec 0051: when an admin deactivated this rider; null while active. Copied, because the auth doors,
  // matching and the admin page read it.
  deactivatedAt: Date | null

  // Spec 0051: declared, never copied, like searchFold: the emergency contact and the deactivating admin
  // are read only through their own queries, so a serialised entity (the partner webhook) never carries them.
  declare deactivatedByUserId: string | null
  declare emergencyContactName: string | null
  declare emergencyContactPhone: string | null

  userId: string
  createdAt: Date
  updatedAt: Date

  // Omit: the entity never reads searchFold (spec 0025) or currentLocationAt (spec 0034), so callers need not have them.
  // Spec 0051: the new columns are optional here, so a caller built before them still compiles; a missing
  // deactivatedAt reads as active.
  constructor(
    data: Omit<
      Courier,
      | 'searchFold'
      | 'currentLocationAt'
      | 'deactivatedAt'
      | 'deactivatedByUserId'
      | 'emergencyContactName'
      | 'emergencyContactPhone'
    > & { currentLocation?: GeoPosition | null; deactivatedAt?: Date | null }
  ) {
    this.id = data.id
    this.node_uri = data.node_uri
    this.firstName = data.firstName
    this.lastName = data.lastName
    this.phoneNumber = data.phoneNumber
    this.status = data.status
    this.deliverySetting = data.deliverySetting
    this.rejectedOffers = data.rejectedOffers
    this.stripeAccountId = data.stripeAccountId
    this.stripeAccountStatus = data.stripeAccountStatus

    this.currentLocation = data.currentLocation

    this.deactivatedAt = data.deactivatedAt ?? null

    this.userId = data.userId
    this.createdAt = data.createdAt
    this.updatedAt = data.updatedAt
  }
}
