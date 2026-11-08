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

  userId: string
  createdAt: Date
  updatedAt: Date

  // Omit: the entity never reads searchFold (spec 0025), so callers need not have it.
  constructor(data: Omit<Courier, 'searchFold'> & { currentLocation?: GeoPosition | null }) {
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

    this.userId = data.userId
    this.createdAt = data.createdAt
    this.updatedAt = data.updatedAt
  }
}
