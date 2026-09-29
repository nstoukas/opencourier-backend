import { config as loadEnv } from 'dotenv'
loadEnv()

import { randomBytes } from 'crypto'
import { EnumCountryCode, EnumUserRole, PrismaClient } from '@prisma/types'
import { hash } from 'bcryptjs'

const prisma = new PrismaClient()

/**
 * Recreates the "Souvlaki tou Nikou" test restaurant, its login and its pickup address.
 * It was first made by hand through the admin API (2026-07-26), so `yarn db:fresh` lost it
 * with nothing to rebuild it. The values below are copied from that hand made record.
 *
 * Idempotent: an existing login keeps its password and API key, so re-running never logs
 * anyone out; only a missing partner or pickup address is created, and the address is
 * corrected in place if it drifted.
 *
 *   yarn ts-node scripts/seedNikouRestaurant.ts
 */
const PARTNER_NAME = 'Souvlaki tou Nikou'
const PARTNER_EMAIL = 'nikou@volos.test'
// Used only when the login is created. Same dev password as the other partner fixtures.
const PARTNER_PASSWORD = 'partnerUser@123'
const PARTNER_PHONE = '+302421099001'

// Must stay inside the Volos polygon in `Config.details.region`, or quotes 503.
// A different street from "Nosh" (Ermou 120) so the two restaurants are told apart.
const ADDRESS = {
  street: 'Dimitriados',
  houseNumber: '88',
  city: 'Volos',
  state: 'Thessaly',
  stateCode: 'Thessaly',
  zipCode: '38221',
  countryCode: EnumCountryCode.GR,
  latitude: 39.3615,
  longitude: 22.941,
}

async function main() {
  const rounds = Number(process.env.BCRYPT_SALT)
  if (!rounds) {
    throw new Error('BCRYPT_SALT is not defined / not numeric')
  }

  const existingUser = await prisma.user.findUnique({ where: { email: PARTNER_EMAIL } })
  const user =
    existingUser ??
    (await prisma.user.create({
      data: {
        email: PARTNER_EMAIL,
        password: await hash(PARTNER_PASSWORD, rounds),
        role: [EnumUserRole.PARTNER],
        // Same shape as the admin API gives a new restaurant. Dev logins use email and
        // password, so the key is never printed.
        apiKey: randomBytes(48).toString('base64url'),
      },
    }))

  const existingPartner = await prisma.partner.findFirst({ where: { userId: user.id } })
  const partner =
    existingPartner ??
    (await prisma.partner.create({
      data: { name: PARTNER_NAME, phoneNumber: PARTNER_PHONE, userId: user.id },
    }))

  // The partner profile DTO exposes `street`/`houseNumber`, not `addressLine1`; set both,
  // as `seedPartnerPickupLocation.ts` does.
  const addressData = {
    ...ADDRESS,
    addressLine1: `${ADDRESS.street} ${ADDRESS.houseNumber}`,
    formattedAddress: `${ADDRESS.street} ${ADDRESS.houseNumber}, ${ADDRESS.city}, ${ADDRESS.state}, ${ADDRESS.zipCode}, ${ADDRESS.countryCode}`,
  }
  const location = partner.pickupLocationId
    ? await prisma.location.update({ where: { id: partner.pickupLocationId }, data: addressData })
    : await prisma.location.create({ data: addressData })
  if (!partner.pickupLocationId) {
    await prisma.partner.update({ where: { id: partner.id }, data: { pickupLocationId: location.id } })
  }

  console.log(`${partner.name} (${partner.id})`)
  console.log(
    `  login     ${user.email} ${
      existingUser ? '(existing, password unchanged)' : `(created, password ${PARTNER_PASSWORD})`
    }`
  )
  console.log(`  partner   ${existingPartner ? 'existing' : 'created'}`)
  console.log(
    `  pickup    ${location.formattedAddress} ${partner.pickupLocationId ? '(updated in place)' : '(created)'}`
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
