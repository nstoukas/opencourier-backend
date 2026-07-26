import { config as loadEnv } from 'dotenv'
loadEnv()

import {
  EnumCountryCode,
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumDistanceUnit,
  EnumEventActor,
  PrismaClient,
} from '@prisma/types'

const prisma = new PrismaClient()

/**
 * Seeds completed deliveries so the courier Earnings screen has something real to show.
 *
 * `GET /courier/earnings-summary` reads the DeliveryEvent ledger, not the Delivery table:
 * it looks for a successful transition to DROPPED_OFF and attributes it to the delivery's
 * current courier. So each delivery here gets a matching DROPPED_OFF event, backdated to
 * the moment the drop-off "happened" — that event timestamp, not Delivery.createdAt, is
 * what puts the money on a given day.
 */

// The courier the mobile app logs in as. Override with COURIER_EMAIL=... to target another.
const COURIER_EMAIL = process.env.COURIER_EMAIL ?? 'opencourier-courier-testing@opencourier.com'

const VOLOS_CENTER = { latitude: 39.3621, longitude: 22.942 }

/**
 * Ten deliveries, deliberately spread so every tab on the Earnings screen has data:
 * two land today, three more earlier this week, and five in the weeks before — which is
 * also what makes the week arrows worth pressing.
 *
 * Money is in **integer cents**, matching the API. `pay` is the piece-rate the co-op owes
 * for the leg; `tips` is the customer's and is deliberately uneven, including zeroes —
 * a seed where every delivery tips the same would hide exactly the variation the
 * pay/tips split on the screen exists to show.
 */
const DELIVERIES = [
  { store: 'Souvlaki tou Nikou', daysAgo: 0, hour: 12, pay: 420, tips: 100 },
  { store: 'Tsipouradiko Ampelos', daysAgo: 0, hour: 20, pay: 560, tips: 0 },
  { store: 'Pizza Volos', daysAgo: 1, hour: 13, pay: 380, tips: 250 },
  { store: 'Kafeneio Pelion', daysAgo: 2, hour: 9, pay: 340, tips: 50 },
  { store: 'To Steki tis Marias', daysAgo: 3, hour: 21, pay: 610, tips: 300 },
  { store: 'Ouzeri Anatoli', daysAgo: 8, hour: 14, pay: 450, tips: 0 },
  { store: 'Bakaliko Argo', daysAgo: 9, hour: 11, pay: 290, tips: 120 },
  { store: 'Psarotaverna Akti', daysAgo: 12, hour: 19, pay: 700, tips: 400 },
  { store: 'Fournos Dimitriou', daysAgo: 17, hour: 8, pay: 310, tips: 0 },
  { store: 'Gyradiko Kentro', daysAgo: 23, hour: 18, pay: 480, tips: 180 },
]

/** A point a short, random-ish hop from the Volos city centre. */
function nearVolos(seed: number) {
  const angle = (seed / DELIVERIES.length) * 2 * Math.PI
  const radius = 0.008 + (seed % 4) * 0.003 // roughly 0.9–1.9 km out
  return {
    latitude: VOLOS_CENTER.latitude + radius * Math.sin(angle),
    longitude: VOLOS_CENTER.longitude + radius * Math.cos(angle),
  }
}

/**
 * `daysAgo`/`hour` in the machine's local timezone, which is the courier's in local dev.
 * The API buckets by the timezone the app asks for, so a delivery seeded at 21:00 local
 * is a useful check that late-evening work lands on the right day.
 */
function dropOffTime(daysAgo: number, hour: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(hour, 15, 0, 0)
  return d
}

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: COURIER_EMAIL },
    include: { courier: true },
  })

  if (!user?.courier) {
    throw new Error(`No courier found for ${COURIER_EMAIL}. Set COURIER_EMAIL to an existing courier.`)
  }
  const courierId = user.courier.id

  const partner = await prisma.partner.findFirst()
  if (!partner) {
    throw new Error('No partner exists. Run the partner seed first (scripts/createTestPartner.ts).')
  }

  // One currency per instance, read from the votable Config so seeded rows agree with
  // whatever the co-op has set rather than hard-coding USD.
  const currencyConfig = await prisma.config.findUnique({ where: { key: 'currency' } })
  const currency = currencyConfig?.value ?? 'USD'

  console.log(`Seeding ${DELIVERIES.length} completed deliveries for ${COURIER_EMAIL} (${currency})`)

  let created = 0

  for (let i = 0; i < DELIVERIES.length; i++) {
    const spec = DELIVERIES[i]
    if (!spec) continue

    // Re-running the script shouldn't double a courier's earnings, so each delivery
    // carries a stable key we can check for first.
    const idempotencyKey = `seed-earnings-${courierId}-${i}`
    const existing = await prisma.delivery.findFirst({ where: { idempotencyKey, partnerId: partner.id } })
    if (existing) {
      console.log(`  ${spec.store} — already seeded, skipping`)
      continue
    }

    const droppedOffAt = dropOffTime(spec.daysAgo, spec.hour)
    const pickupPoint = nearVolos(i)
    const dropoffPoint = nearVolos(i + 3)

    const pickupLocation = await prisma.location.create({
      data: {
        addressLine1: `${spec.store}, Volos`,
        city: 'Volos',
        countryCode: EnumCountryCode.GR,
        formattedAddress: `${spec.store}, Volos, Greece`,
        ...pickupPoint,
      },
    })

    const dropoffLocation = await prisma.location.create({
      data: {
        addressLine1: `Odos Dimitriados ${10 + i}`,
        city: 'Volos',
        countryCode: EnumCountryCode.GR,
        formattedAddress: `Odos Dimitriados ${10 + i}, Volos, Greece`,
        ...dropoffPoint,
      },
    })

    const quote = await prisma.deliveryQuote.create({
      data: {
        quote: spec.pay / 100,
        quoteRangeFrom: spec.pay,
        quoteRangeTo: spec.pay,
        currency,
        duration: 900,
        distance: 2.4,
        distanceUnit: EnumDistanceUnit.KILOMETERS,
        pickupLocationId: pickupLocation.id,
        dropoffLocationId: dropoffLocation.id,
        partnerId: partner.id,
      },
    })

    const delivery = await prisma.delivery.create({
      data: {
        pickupName: spec.store,
        pickupPhoneNumber: '+302421000000',
        pickupBusinessName: spec.store,
        pickupLocationId: pickupLocation.id,
        dropoffName: 'Test Customer',
        dropoffPhoneNumber: '+302421000001',
        dropoffLocationId: dropoffLocation.id,
        status: EnumDeliveryStatus.DROPPED_OFF,
        currencyCode: currency,
        courierId,
        partnerId: partner.id,
        deliveryQuoteId: quote.id,
        idempotencyKey,
        pay: spec.pay,
        tips: spec.tips,
        // What the earnings report actually sums for piece-rate pay.
        totalCompensation: spec.pay,
        totalCost: spec.pay + spec.tips,
        // Delivery started shortly before it was dropped off.
        createdAt: new Date(droppedOffAt.getTime() - 30 * 60 * 1000),
      },
    })

    // The row the earnings query looks for. Written directly rather than through
    // processDeliveryEvent because the state machine would refuse to walk a brand-new
    // delivery straight to DROPPED_OFF — and because the timestamp has to be backdated.
    await prisma.deliveryEvent.create({
      data: {
        deliveryId: delivery.id,
        type: EnumDeliveryEventType.DROPPED_OFF,
        actor: EnumEventActor.COURIER,
        eventSource: EnumDeliveryEventSource.OPENCOURIER,
        oldStatus: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
        newStatus: EnumDeliveryStatus.DROPPED_OFF,
        transitionSuccessful: true,
        message: 'Seeded completed delivery',
        createdAt: droppedOffAt,
      },
    })

    console.log(
      `  + ${spec.store} — ${droppedOffAt.toISOString()} — pay ${spec.pay}c + tips ${spec.tips}c = ${
        spec.pay + spec.tips
      }c`
    )
    created++
  }

  const total = DELIVERIES.reduce((sum, d) => sum + d.pay + d.tips, 0)
  console.log(`\nSeeded ${created} deliveries. Full set totals ${total}c across ${DELIVERIES.length} deliveries.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
