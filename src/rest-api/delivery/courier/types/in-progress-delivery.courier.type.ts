import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { AddressNoteForCourier } from 'src/domains/location-note/location-note.domain.service'
import { LocationEntity } from 'src/domains/location/entities/location.entity'
import { DeliveryRemovalRequest, SplitRequest } from '@prisma/types'

export type InProgressDeliveryCourier = DeliveryEntity & {
  pickupLocation: LocationEntity
  dropoffLocation: LocationEntity
  // Spec 0053 (AC-3): author free notes for each stop.
  dropoffLocationNotes: AddressNoteForCourier[]
  pickupLocationNotes: AddressNoteForCourier[]
  // Spec 0035: this rider's newest request while open or refused, null otherwise.
  removalRequest?: DeliveryRemovalRequest | null
  // Spec 0047: this rider's newest split request while open, refused or confirmed, null otherwise.
  splitRequest?: SplitRequest | null
}
