import { EnumLocationNoteActor, LocationNote } from '@prisma/types'

export class LocationNoteEntity implements LocationNote {
  id: string
  note: string | null
  locationId: string | null
  deliveryId: string | null
  actor: EnumLocationNoteActor

  courierId: string | null

  // Spec 0053: the point the note is about, and when a rider last confirmed it.
  latitude: number
  longitude: number
  lastConfirmedAt: Date

  createdAt: Date
  updatedAt: Date

  constructor(data: LocationNote) {
    this.id = data.id
    this.note = data.note
    this.actor = data.actor
    this.courierId = data.courierId
    this.locationId = data.locationId
    this.deliveryId = data.deliveryId

    this.latitude = data.latitude
    this.longitude = data.longitude
    this.lastConfirmedAt = data.lastConfirmedAt

    this.createdAt = data.createdAt
    this.updatedAt = data.updatedAt
  }
}
