import { EnumDeliveryStatus, Prisma } from '@prisma/types'

// The admin deliveries list's filter (row 96). The list's status filter and search box never
// reached the backend before: the route took only the page and a courier.
export const ADMIN_DELIVERY_STATES = ['all', 'active', 'dropped_off', 'canceled'] as const
// `(typeof X)[number]` = one of the array's values: 'all' | 'active' | 'dropped_off' | 'canceled'.
export type AdminDeliveryState = (typeof ADMIN_DELIVERY_STATES)[number]

// A delivery that ended: delivered, or did not happen. "Active" is every other status, the ones
// still waiting for a rider included. "Canceled" covers FAILED too: both are a delivery that did
// not reach the customer, and FAILED is rare (decision 96.1).
const ENDED = [EnumDeliveryStatus.DROPPED_OFF, EnumDeliveryStatus.CANCELED, EnumDeliveryStatus.FAILED]

// The longest search text the list accepts; longer is refused with a 400.
export const MAX_DELIVERY_SEARCH_LENGTH = 100

export function adminDeliveryListWhere(filter: {
  courierId?: string
  state?: AdminDeliveryState
  search?: string
}): Prisma.DeliveryWhereInput {
  const where: Prisma.DeliveryWhereInput = {}
  // As before row 96: a courierId sent (even empty) is a filter; only a missing one is not.
  if (filter.courierId !== undefined) where.courierId = filter.courierId

  switch (filter.state) {
    case 'active':
      where.status = { notIn: ENDED }
      break
    case 'dropped_off':
      where.status = EnumDeliveryStatus.DROPPED_OFF
      break
    case 'canceled':
      where.status = { in: [EnumDeliveryStatus.CANCELED, EnumDeliveryStatus.FAILED] }
      break
    default:
      // 'all' or nothing: no status rule.
      break
  }

  // A search finds a delivery by its order reference, its customer (the drop off name), its
  // restaurant, or the end of its id (the short id the admin shows), ignoring case (decision 96.1).
  // At co-op scale a plain ILIKE is fine; at many thousands of deliveries these columns would want
  // a pg_trgm index (row 96 review).
  const text = filter.search?.trim()
  if (text) {
    // Prisma passes the text into SQL LIKE as it is, where % and _ are wildcards: escape them (and
    // the escape character itself), so a search for "%" finds a "%" and not every delivery.
    const literal = text.replace(/[\\%_]/g, (character) => `\\${character}`)
    const contains = { contains: literal, mode: Prisma.QueryMode.insensitive }
    where.OR = [
      { orderReference: contains },
      { dropoffName: contains },
      { pickupBusinessName: contains },
      { id: { endsWith: literal } },
    ]
  }
  return where
}
