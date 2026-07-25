import { config as loadEnv } from 'dotenv'
loadEnv()

import {
  EnumCourierDeliverySetting,
  EnumCourierStatus,
  EnumUserRole,
  PrismaClient,
} from '@prisma/types'
import { hash } from 'bcryptjs'

const prisma = new PrismaClient()

// --- Volos, Greece ---
const VOLOS_CENTER = { latitude: 39.3621, longitude: 22.942 }

// Bounding polygon (GeoJSON) roughly covering the Volos urban area.
const VOLOS_REGION = {
  type: 'Polygon',
  coordinates: [
    [
      [22.88, 39.33],
      [23.02, 39.33],
      [23.02, 39.41],
      [22.88, 39.41],
      [22.88, 39.33],
    ],
  ],
}

const INSTANCE_DETAILS = {
  name: 'Volos Couriers',
  link: 'http://localhost:3000',
  websocketLink: 'ws://localhost:3000',
  region: VOLOS_REGION,
  imageUrl: '',
  rulesUrl: '',
  rulesContent:
    '# Volos Couriers — Rules\n\n1. Be respectful to customers and partners.\n2. Keep deliveries on time.\n3. Follow local traffic laws in Volos.',
  descriptionUrl: '',
  descriptionContent:
    '# Welcome to Volos Couriers\n\nA test delivery instance serving the city of **Volos, Greece** 🇬🇷. Fast, local courier delivery across the Volos urban area.',
  termsOfServiceUrl: '',
  termsOfServiceContent: 'Test instance — terms of service placeholder.',
  privacyPolicyUrl: '',
  privacyPolicyContent: 'Test instance — privacy policy placeholder.',
}

// 10 couriers with Greek names, spread around Volos center.
const COURIERS = [
  { firstName: 'Giorgos', lastName: 'Papadopoulos' },
  { firstName: 'Maria', lastName: 'Nikolaou' },
  { firstName: 'Dimitris', lastName: 'Georgiou' },
  { firstName: 'Eleni', lastName: 'Vasileiou' },
  { firstName: 'Kostas', lastName: 'Ioannou' },
  { firstName: 'Sofia', lastName: 'Makri' },
  { firstName: 'Nikos', lastName: 'Antoniou' },
  { firstName: 'Katerina', lastName: 'Dimitriou' },
  { firstName: 'Yannis', lastName: 'Panagiotou' },
  { firstName: 'Christina', lastName: 'Alexiou' },
]

async function configureInstance() {
  console.log('Configuring instance details for Volos...')

  await prisma.config.upsert({
    where: { key: 'details' },
    update: { value: JSON.stringify(INSTANCE_DETAILS), type: 'object' },
    create: { key: 'details', value: JSON.stringify(INSTANCE_DETAILS), type: 'object' },
  })

  // Widen assignment distance so couriers spread across Volos still match orders.
  await prisma.config.upsert({
    where: { key: 'maxAssignmentDistance' },
    update: { value: '20', type: 'number' },
    create: { key: 'maxAssignmentDistance', value: '20', type: 'number' },
  })

  await prisma.config.upsert({
    where: { key: 'updatedAt' },
    update: { value: new Date().toISOString(), type: 'string' },
    create: { key: 'updatedAt', value: new Date().toISOString(), type: 'string' },
  })

  console.log('  -> instance "Volos Couriers" configured, maxAssignmentDistance=20km')
}

async function createCouriers() {
  const rounds = Number(process.env.BCRYPT_SALT)
  if (!rounds) {
    throw new Error('BCRYPT_SALT is not defined / not numeric')
  }

  const password = 'password'
  let created = 0

  for (let i = 0; i < COURIERS.length; i++) {
    const c = COURIERS[i]
    if (!c) continue
    const email = `volos-courier-${i + 1}@opencourier.com`

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      console.log(`  ${email} already exists — skipping`)
      continue
    }

    const user = await prisma.user.create({
      data: {
        email,
        password: await hash(password, rounds),
        role: [EnumUserRole.COURIER],
      },
    })

    const courier = await prisma.courier.create({
      data: {
        node_uri: 'http://localhost:3000',
        firstName: c.firstName,
        lastName: c.lastName,
        phoneNumber: `+3024210${String(10000 + i).padStart(5, '0')}`,
        status: EnumCourierStatus.ONLINE,
        deliverySetting: EnumCourierDeliverySetting.AUTO_ACCEPT,
        userId: user.id,
      },
    })

    // Spread couriers in a small ring around Volos center (~1-2 km).
    const angle = (i / COURIERS.length) * 2 * Math.PI
    const radius = 0.012 + (i % 3) * 0.004 // ~1.3–2.6 km
    const lng = VOLOS_CENTER.longitude + radius * Math.cos(angle)
    const lat = VOLOS_CENTER.latitude + radius * Math.sin(angle)
    const point = `POINT(${lng} ${lat})`

    await prisma.$queryRaw`
      UPDATE "Courier"
      SET "currentLocation" = ST_GeomFromText(${point}, 4326)
      WHERE "id" = ${courier.id}
    `

    console.log(`  + ${c.firstName} ${c.lastName} (${email}) @ ${lat.toFixed(5)},${lng.toFixed(5)}`)
    created++
  }

  console.log(`Created ${created} Volos couriers (ONLINE, AUTO_ACCEPT). Password for all: "${password}"`)
}

async function main() {
  await configureInstance()
  await createCouriers()
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
