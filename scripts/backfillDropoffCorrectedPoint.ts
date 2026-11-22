// Spec 0053 (cross check 1): a one off backfill of Delivery.dropoffCorrectedLatitude and
// dropoffCorrectedLongitude for pins riders moved before row 82, read from each DROPOFF_POINT_CORRECTED
// event's message ("Drop off pin moved 141 m by the rider, from 39.36400, 22.94800 to 39.36500,
// 22.94900; ..."). Only the rider's moves: a restaurant's move gave the delivery a new Location already.
// A delivery whose columns are already set is left alone, so running it twice changes nothing.
// Logs event and delivery ids only, never a coordinate (value 5).
//
//   corepack yarn ts-node -r tsconfig-paths/register scripts/backfillDropoffCorrectedPoint.ts --dry-run
//   corepack yarn ts-node -r tsconfig-paths/register scripts/backfillDropoffCorrectedPoint.ts
import { EnumDeliveryEventType, PrismaClient } from '@prisma/types'

const RIDER_MOVE = /by the rider, from -?\d+(?:\.\d+)?, -?\d+(?:\.\d+)? to (-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)/

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const db = new PrismaClient()
  try {
    const events = await db.deliveryEvent.findMany({
      where: { type: EnumDeliveryEventType.DROPOFF_POINT_CORRECTED, message: { contains: 'by the rider' } },
      select: { id: true, deliveryId: true, message: true },
      orderBy: { createdAt: 'desc' },
    })
    const done = new Set<string>()
    let filled = 0
    let alreadySet = 0
    let unreadable = 0
    for (const event of events) {
      if (done.has(event.deliveryId)) continue
      const match = RIDER_MOVE.exec(event.message ?? '')
      const latitude = match ? Number(match[1]) : NaN
      const longitude = match ? Number(match[2]) : NaN
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        unreadable++
        console.log(`Could not read the new point of event ${event.id} (delivery ${event.deliveryId})`)
        continue
      }
      done.add(event.deliveryId)
      const where = { id: event.deliveryId, dropoffCorrectedLatitude: null, dropoffCorrectedLongitude: null }
      if (dryRun) {
        const count = await db.delivery.count({ where })
        if (count === 0) alreadySet++
        else filled++
        continue
      }
      const result = await db.delivery.updateMany({
        where,
        data: { dropoffCorrectedLatitude: latitude, dropoffCorrectedLongitude: longitude },
      })
      if (result.count === 0) alreadySet++
      else filled++
    }
    console.log(
      `${dryRun ? 'Dry run: would fill' : 'Filled'} ${filled} deliveries; ${alreadySet} already set; ` +
        `${unreadable} event(s) unreadable; ${events.length} rider move event(s) read.`
    )
  } finally {
    await db.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
