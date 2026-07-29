import { config as loadEnv } from 'dotenv'
loadEnv()

import { EnumCountryCode, PrismaClient } from '@prisma/types'

const prisma = new PrismaClient()

/**
 * Gives a partner a pickup address, because the seeded partner "Nosh" has none and
 * `GET /api/partner/v1/partner/profile` therefore returns `pickupAddress: null`.
 * Prefilling that profile read-only is Unit 4, so without this there is nothing to prefill.
 *
 * The address must sit inside the instance's geo region (the Volos polygon in
 * `Config.details.region`, lon 22.88–23.02 / lat 39.33–39.41) or a quote 503s with
 * "beyond the geo area this instance serves" before matching ever runs.
 *
 * Idempotent: re-running updates the partner's existing Location in place rather than
 * leaving orphaned rows behind. `yarn db:fresh` wipes this — re-run it afterwards.
 *
 *   PARTNER_NAME="Volos Test Kitchen" yarn ts-node scripts/seedPartnerPickupLocation.ts
 */
const PARTNER_NAME = process.env.PARTNER_NAME ?? 'Nosh'

// Central Volos, deliberately a different street from the "Souvlaki tou Nikou" fixture
// (Dimitriados 88) so the two restaurants are told apart in the UI. Coordinates are
// approximate — precise enough to fall inside the region and near the seeded couriers.
const ADDRESS = {
  street: 'Ermou',
  houseNumber: '120',
  city: 'Volos',
  state: 'Thessaly',
  stateCode: 'Thessaly',
  zipCode: '38221',
  countryCode: EnumCountryCode.GR,
  latitude: 39.3628,
  longitude: 22.9435,
}

async function main() {
  const partner = await prisma.partner.findFirst({ where: { name: PARTNER_NAME } })
  if (!partner) throw new Error(`No partner named "${PARTNER_NAME}"`)

  const data = {
    ...ADDRESS,
    // The partner profile DTO exposes `street`/`houseNumber`, not `addressLine1` — set both
    // so the raw Location still reads well anywhere addressLine1 is displayed.
    addressLine1: `${ADDRESS.street} ${ADDRESS.houseNumber}`,
    formattedAddress: `${ADDRESS.street} ${ADDRESS.houseNumber}, ${ADDRESS.city}, ${ADDRESS.state}, ${ADDRESS.zipCode}, ${ADDRESS.countryCode}`,
  }

  const location = partner.pickupLocationId
    ? await prisma.location.update({ where: { id: partner.pickupLocationId }, data })
    : await prisma.location.create({ data })

  if (!partner.pickupLocationId) {
    await prisma.partner.update({ where: { id: partner.id }, data: { pickupLocationId: location.id } })
  }

  console.log(`${partner.name} (${partner.id})`)
  console.log(`  pickupLocationId  ${location.id}${partner.pickupLocationId ? ' (updated in place)' : ' (created)'}`)
  console.log(`  address           ${location.formattedAddress}`)
  console.log(`  coordinates       ${location.latitude}, ${location.longitude}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
