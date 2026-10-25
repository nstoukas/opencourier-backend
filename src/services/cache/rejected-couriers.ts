import { CacheService } from './cache.service'
import { CacheHelpers } from './cache.helpers'

// How long a courier stays excluded from re-offers of one delivery after declining it, or after
// letting its offer expire (spec 0002). Both the add and the remove must use the same value,
// because re-saving the key resets its expiry. Hard coded for now; see spec 0002 Follow-up.
export const REJECTED_LIST_TTL_SECONDS = 60 * 20

// The one place a courier is put on a delivery's skip list. Returns true only when this call is
// what put them there; an entry left over from an earlier decline is not the caller's to remove.
export async function addCourierToRejectedList(
  cacheService: CacheService,
  deliveryId: string,
  courierId: string
): Promise<boolean> {
  const rejectedKey = CacheHelpers.getDeliveryRejectedCouriersKey(deliveryId)
  const rejectedCouriers = await cacheService.getOrDefault<Array<string>>(rejectedKey, [])

  const alreadyRejected = rejectedCouriers.includes(courierId)
  if (!alreadyRejected) rejectedCouriers.push(courierId)

  await cacheService.save<Array<string>>(rejectedKey, rejectedCouriers, REJECTED_LIST_TTL_SECONDS)

  return !alreadyRejected
}

// Mirror of addCourierToRejectedList: drops one courier from the list and leaves everyone else.
export async function removeCourierFromRejectedList(
  cacheService: CacheService,
  deliveryId: string,
  courierId: string
): Promise<void> {
  const rejectedKey = CacheHelpers.getDeliveryRejectedCouriersKey(deliveryId)
  const rejectedCouriers = await cacheService.getOrDefault<Array<string>>(rejectedKey, [])

  await cacheService.save<Array<string>>(
    rejectedKey,
    rejectedCouriers.filter((id) => id !== courierId),
    REJECTED_LIST_TTL_SECONDS
  )
}
