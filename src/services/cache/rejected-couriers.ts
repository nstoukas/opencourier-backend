import { CacheService } from './cache.service'
import { CacheHelpers } from './cache.helpers'

// How long a courier stays excluded from re-offers of one delivery after declining it, or after
// letting its offer expire (spec 0002), is the co-op setting offerSkipMinutes (row 144). Callers read it
// and pass it in seconds as `ttlSeconds`, to the add and the remove alike: re-saving the key resets its
// expiry, so both must use the setting as it is now.

// The one place a courier is put on a delivery's skip list. Returns true only when this call is
// what put them there; an entry left over from an earlier decline is not the caller's to remove.
export async function addCourierToRejectedList(
  cacheService: CacheService,
  deliveryId: string,
  courierId: string,
  ttlSeconds: number
): Promise<boolean> {
  const rejectedKey = CacheHelpers.getDeliveryRejectedCouriersKey(deliveryId)
  const rejectedCouriers = await cacheService.getOrDefault<Array<string>>(rejectedKey, [])

  const alreadyRejected = rejectedCouriers.includes(courierId)
  if (!alreadyRejected) rejectedCouriers.push(courierId)

  await cacheService.save<Array<string>>(rejectedKey, rejectedCouriers, ttlSeconds)

  return !alreadyRejected
}

// Mirror of addCourierToRejectedList: drops one courier from the list and leaves everyone else.
export async function removeCourierFromRejectedList(
  cacheService: CacheService,
  deliveryId: string,
  courierId: string,
  ttlSeconds: number
): Promise<void> {
  const rejectedKey = CacheHelpers.getDeliveryRejectedCouriersKey(deliveryId)
  const rejectedCouriers = await cacheService.getOrDefault<Array<string>>(rejectedKey, [])

  await cacheService.save<Array<string>>(
    rejectedKey,
    rejectedCouriers.filter((id) => id !== courierId),
    ttlSeconds
  )
}
