import { PrismaClient } from '@prisma/types'

async function main() {
  const db = new PrismaClient()

  // Longitude and Latitude for Volos, Greece (matching user's coordinates)
  const longitude = 22.9471954
  const latitude = 39.3597002
  const point = `POINT(${longitude} ${latitude})`

  console.log(`Relocating all couriers to coordinates: (${latitude}, ${longitude})...`)

  const couriers = await db.courier.findMany()
  
  for (const courier of couriers) {
    await db.$queryRaw`
      UPDATE "Courier"
      SET "currentLocation" = ST_GeomFromText(${point}, 4326),
          "status" = 'ONLINE'
      WHERE "id" = ${courier.id}
    `
  }

  console.log(`Successfully updated ${couriers.length} couriers to ONLINE status and relocated them to Greece.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
