import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { LocationNoteWithReactionCounts } from './location-note-with-reaction-counts.type'
import { LocationEntity } from 'src/domains/location/entities/location.entity'
import { DeliveryRemovalRequest } from '@prisma/types'

export type InProgressDeliveryCourier = DeliveryEntity & {
  pickupLocation: LocationEntity
  dropoffLocation: LocationEntity
  dropoffLocationNotes: LocationNoteWithReactionCounts[]
  pickupLocationNotes: LocationNoteWithReactionCounts[]
  // Spec 0035: this rider's newest request while open or refused, null otherwise.
  removalRequest?: DeliveryRemovalRequest | null
}
