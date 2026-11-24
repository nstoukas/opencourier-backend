import { CacheService } from './cache.service'
import { CacheHelpers } from './cache.helpers'

// How long a courier stays excluded from re-offers of one delivery after declining it, or after
// letting its offer expire (spec 0002), is the co-op setting offerSkipMinutes (row 144). Callers read it
// and pass it in seconds as `ttlSeconds`.
//
// Row 148: each courier on the list has an end time of their own (a Redis sorted set, scored by that
// end), so a later courier added to the same delivery never starts anyone else's time again. Before,
// the list was one JSON array under one expiry, and every add reset it for everybody.

// The one place a courier is put on a delivery's skip list. Returns true only when this call is
// what put them there; an entry left over from an earlier decline is not the caller's to remove.
// A courier already on the list keeps the later of their two end times.
export async function addCourierToRejectedList(
  cacheService: CacheService,
  deliveryId: string,
  courierId: string,
  ttlSeconds: number
): Promise<boolean> {
  const rejectedKey = CacheHelpers.getDeliveryRejectedCouriersKey(deliveryId)
  const now = Date.now()
  return cacheService.addWithOwnExpiry(rejectedKey, courierId, now, now + ttlSeconds * 1000)
}

// Mirror of addCourierToRejectedList: drops one courier from the list and leaves everyone else
// with their own end times.
export async function removeCourierFromRejectedList(
  cacheService: CacheService,
  deliveryId: string,
  courierId: string
): Promise<void> {
  await cacheService.removeMember(CacheHelpers.getDeliveryRejectedCouriersKey(deliveryId), courierId)
}

// The couriers still skipped for this delivery: those whose own end has not come yet. Every reader of
// the skip list (matching, stacking, add ons) goes through here.
export async function getRejectedCourierIds(cacheService: CacheService, deliveryId: string): Promise<string[]> {
  return cacheService.membersStillCounting(CacheHelpers.getDeliveryRejectedCouriersKey(deliveryId), Date.now())
}
