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
import { ConfigKey } from 'src/shared-types/index'
import { resolveInstanceCurrency } from 'src/db-seeds/instance-currency'

const prisma = new PrismaClient()

/**
 * Creates ONE delivery sitting in an ongoing status with a courier already on it, which
 * is the only state a reassignment can act on. Reassignment is impossible to exercise
 * against seeded history because every seeded delivery is already DROPPED_OFF (terminal).
 *
 * Idempotent: re-running replaces the previous fixture rather than piling up deliveries.
 */
const COURIER_EMAIL = process.env.COURIER_EMAIL ?? 'volos-courier-1@opencourier.com'
const IDEMPOTENCY_KEY = 'seed-reassignable-delivery'

async function main() {
  const user = await prisma.user.findUnique({ where: { email: COURIER_EMAIL }, include: { courier: true } })
  if (!user?.courier) throw new Error(`No courier for ${COURIER_EMAIL}`)

  const partner = await prisma.partner.findFirst({ where: { name: 'Souvlaki tou Nikou' } })
  if (!partner) throw new Error('Expected the test restaurant "Souvlaki tou Nikou" to exist (unit 1 fixture).')

  // One currency per instance, read from the votable Config so the fixture stays correct
  // whatever the members have voted — rather than baking a literal into a test fixture.
  const currencyConfig = await prisma.config.findUnique({ where: { key: ConfigKey.CURRENCY } })
  const currency = resolveInstanceCurrency(currencyConfig?.value)

  const existing = await prisma.delivery.findFirst({ where: { idempotencyKey: IDEMPOTENCY_KEY } })
  if (existing) {
    await prisma.deliveryEvent.deleteMany({ where: { deliveryId: existing.id } })
    await prisma.courierCompensation.deleteMany({ where: { deliveryId: existing.id } })
    await prisma.delivery.delete({ where: { id: existing.id } })
    console.log('Removed the previous fixture delivery')
  }

  const mkLocation = (label: string, lat: number, lng: number) =>
    prisma.location.create({
      data: {
        addressLine1: label,
        city: 'Volos',
        countryCode: EnumCountryCode.GR,
        formattedAddress: `${label}, Volos, Greece`,
        latitude: lat,
        longitude: lng,
      },
    })

  const pickup = await mkLocation('Dimitriados 88', 39.3615, 22.941)
  const dropoff = await mkLocation('Iasonos 30', 39.3644, 22.9465)

  const quote = await prisma.deliveryQuote.create({
    data: {
      quote: 8,
      quoteRangeFrom: 800,
      quoteRangeTo: 800,
      // The two parts the rider is paid (spec 0001). The fee % is 0 here, so they sum to the price.
      baseFee: 200,
      distanceFee: 600,
      currency,
      duration: 900,
      distance: 2.1,
      distanceUnit: EnumDistanceUnit.KILOMETERS,
      pickupLocationId: pickup.id,
      dropoffLocationId: dropoff.id,
      partnerId: partner.id,
    },
  })

  const delivery = await prisma.delivery.create({
    data: {
      pickupName: partner.name,
      pickupPhoneNumber: partner.phoneNumber ?? '+302421000000',
      pickupBusinessName: partner.name,
      pickupLocationId: pickup.id,
      dropoffName: 'Reassignment Test Customer',
      dropoffPhoneNumber: '+302421000002',
      dropoffLocationId: dropoff.id,
      // ACCEPTED: a courier is committed, which is what makes it reassignable.
      status: EnumDeliveryStatus.ACCEPTED,
      currencyCode: currency,
      courierId: user.courier.id,
      partnerId: partner.id,
      deliveryQuoteId: quote.id,
      idempotencyKey: IDEMPOTENCY_KEY,
      pay: 800,
      tips: 200,
      totalCompensation: 800,
      totalCost: 1000,
    },
  })

  await prisma.deliveryEvent.create({
    data: {
      deliveryId: delivery.id,
      type: EnumDeliveryEventType.ACCEPTED,
      actor: EnumEventActor.COURIER,
      eventSource: EnumDeliveryEventSource.OPENCOURIER,
      oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
      newStatus: EnumDeliveryStatus.ACCEPTED,
      transitionSuccessful: true,
      message: 'Seeded reassignment fixture',
    },
  })

  console.log(`Delivery ${delivery.id}`)
  console.log(`  status            ACCEPTED`)
  console.log(`  courier           ${COURIER_EMAIL} (${user.courier.id})`)
  console.log(`  totalCompensation ${delivery.totalCompensation}c, tips ${delivery.tips}c (${currency})`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
