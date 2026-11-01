import { EnumCourierStatus, Prisma } from '@prisma/types'

// The admin couriers list's tabs and search (row 97). The route took only the page before, so the
// board's tabs and search box had nothing to ask.
export const ADMIN_COURIER_STATUSES = ['all', 'working', 'offline'] as const
// `(typeof X)[number]` = one of the array's values: 'all' | 'working' | 'offline'.
export type AdminCourierStatus = (typeof ADMIN_COURIER_STATUSES)[number]

// "Working now" is Online or Last call: a rider on last call takes no new offers but is still
// finishing deliveries, so they are working (decision 97.1).
const WORKING = [EnumCourierStatus.ONLINE, EnumCourierStatus.LAST_CALL]

// The longest search text the list accepts; longer is refused with a 400.
export const MAX_COURIER_SEARCH_LENGTH = 100

export function adminCourierListWhere(filter: { status?: AdminCourierStatus; search?: string }): Prisma.CourierWhereInput {
  const where: Prisma.CourierWhereInput = {}

  switch (filter.status) {
    case 'working':
      where.status = { in: WORKING }
      break
    case 'offline':
      where.status = EnumCourierStatus.OFFLINE
      break
    default:
      // 'all' or nothing: no status rule.
      break
  }

  // A search finds a rider by name or phone, ignoring case. The text is split into words and every
  // word must match the first name, the last name or the phone, so "Giorgos Pap" finds Giorgos
  // Papadopoulos although the two names are stored apart (decision 97.1).
  const words = (filter.search ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length > 0) {
    where.AND = words.map((word) => {
      // Prisma passes the text into SQL LIKE as it is, where % and _ are wildcards: escape them (and
      // the escape character itself), as row 96 does for deliveries.
      const literal = word.replace(/[\\%_]/g, (character) => `\\${character}`)
      const contains = { contains: literal, mode: Prisma.QueryMode.insensitive }
      return { OR: [{ firstName: contains }, { lastName: contains }, { phoneNumber: contains }] }
    })
  }
  return where
}
