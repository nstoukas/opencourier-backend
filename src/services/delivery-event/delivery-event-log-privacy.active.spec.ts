import { inspect } from 'util'
import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  EnumCourierStatus,
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
} from '@prisma/types'
import { DeliveryEventService } from './delivery-event.service'
import { SocketIODispatcher } from '../socketio/socketio.dispatcher'
import { SocketIOService } from '../socketio/socketio.service'
import { SocketWithAuth } from '../socketio/types/socket-with-auth.type'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { DeliveryEventRepository } from 'src/persistence/repositories/delivery-event.repository'
import { TaskBusScheduler } from '../taskBus/models/TaskBusScheduler'
import { TaskBusService } from '../taskBus/taskBus.service'
import { PartnerWebhookService } from '../partner-webhooks/partner-webhooks.service'
import { DeliveryMatchingService } from '../delivery-matching/delivery-matching.service'
import { DeliveryCalculationService } from '../delivery-calculation/delivery-calculation.service'
import { BullMQService } from 'src/integrations/bullMQ/bullMQ.service'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { CacheService } from '../cache/cache.service'
import { OfferPushService } from '../pushNotification/offer-push.service'
import { DispatchStopRepository } from 'src/persistence/repositories/dispatch-stop.repository'
import { DeliveryEvent, NotificationEventType, STATE_MACHINE } from 'src/shared-types'

// Row 95: a delivery's creation, its events and its offer to a rider log only ids, type, status and
// times, never the recipient's or the pickup contact's name, phone or address, and never an event's
// free text message. The rider's offer still carries the restaurant and both addresses; since row 101
// (decision 101.1) it carries no customer name, order items or notes until the rider accepts. The service
// runs with the real socket dispatcher and SocketIOService, so every log line on the way to the rider's
// socket is checked, and what reaches the socket is what the rider gets.
describe('DeliveryEventService logs no contact details (row 95)', () => {
  // The delivery's own contact details. Each is distinctive, so a hit can only be a leak.
  const DROPOFF_NAME = 'Euthymia Recipientopoulou'
  const DROPOFF_PHONE = '+306977000951'
  const PICKUP_NAME = 'Pantelis Pickupakis'
  const PICKUP_PHONE = '+302421000952'
  const DROPOFF_NOTES = 'Gate code 4471 behind the bakery'
  const PICKUP_NOTES = 'Ask for Stamatis at the till'
  const SELLER_NOTES = 'Leave by the blue door'
  const FLOOR = 'Floor 5 flat 5B'
  const DOORBELL = 'Bell Karamanlidou'
  const ORDER_ITEM = 'Spetsofai Pilioritiko'
  const CUSTOMER_NOTE = 'Knock twice, baby asleep'
  const DROPOFF_STREET = 'Iasonos 123'
  const PICKUP_STREET = 'Kartali 77'

  // What a client or an admin might type into an event's message.
  const MESSAGE_NAME = 'Theodosia Messagaki'
  const MESSAGE_PHONE = '+306900111222'
  const MESSAGE_ADDRESS = 'Dimitriados 404'
  const PII_MESSAGE = `Customer ${MESSAGE_NAME} at ${MESSAGE_ADDRESS}, call ${MESSAGE_PHONE}`

  const DELIVERY_DETAILS = [
    DROPOFF_NAME,
    DROPOFF_PHONE,
    PICKUP_NAME,
    PICKUP_PHONE,
    DROPOFF_NOTES,
    PICKUP_NOTES,
    SELLER_NOTES,
    FLOOR,
    DOORBELL,
    ORDER_ITEM,
    CUSTOMER_NOTE,
    DROPOFF_STREET,
    PICKUP_STREET,
  ]
  const MESSAGE_DETAILS = [MESSAGE_NAME, MESSAGE_PHONE, MESSAGE_ADDRESS]
  const ALL_DETAILS = [...DELIVERY_DETAILS, ...MESSAGE_DETAILS]

  const DELIVERY_ID = 'del-r95'
  const COURIER_ID = 'courier-r95'
  const COURIER_USER_ID = 'user-r95'

  function deliveryAt(status: EnumDeliveryStatus, extra: Record<string, unknown> = {}): any {
    return {
      id: DELIVERY_ID,
      status,
      partnerId: 'partner-r95',
      courierId: null,
      matchedCourierId: null,
      offeredAt: null,
      offerExpiresAt: null,
      handBackUntil: null,
      createdAt: new Date('2026-11-03T05:00:00.000Z'),
      pickupName: PICKUP_NAME,
      pickupPhoneNumber: PICKUP_PHONE,
      pickupBusinessName: 'Volos Test Kitchen',
      pickupNotes: PICKUP_NOTES,
      dropoffName: DROPOFF_NAME,
      dropoffPhoneNumber: DROPOFF_PHONE,
      dropoffNotes: DROPOFF_NOTES,
      dropoffSellerNotes: SELLER_NOTES,
      dropoffFloor: FLOOR,
      dropoffDoorbell: DOORBELL,
      orderItems: [{ name: ORDER_ITEM, quantity: 1 }],
      customerNotes: [CUSTOMER_NOTE],
      pickupLocation: { street: PICKUP_STREET, city: 'Volos', state: null },
      dropoffLocation: { street: DROPOFF_STREET, city: 'Volos', state: null },
      ...extra,
    }
  }

  const ongoing = (status: EnumDeliveryStatus) => deliveryAt(status, { courierId: COURIER_ID })

  let service: DeliveryEventService
  // The repository methods this service calls, each a jest mock the tests can steer.
  type MockOf<K extends string> = { [Key in K]: jest.Mock }
  let deliveryRepository: MockOf<
    | 'findByIdOrThrow'
    | 'findById'
    | 'update'
    | 'updateIfMatches'
    | 'findIdsWaitingForCourierOldestFirst'
    | 'findOpenOffersForCourier'
  >
  let deliveryEventRepository: MockOf<'create' | 'findLatestJobStepOccurredAt' | 'findLatestOfTypes'>
  let courierSocket: Partial<SocketWithAuth> & { emit: jest.Mock }
  const logSpies: jest.SpyInstance[] = []

  beforeEach(() => {
    // Every Nest Logger instance (the service's, the dispatcher's, SocketIOService's) and the console.
    for (const method of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      logSpies.push(jest.spyOn(Logger.prototype, method).mockImplementation(() => undefined))
    }
    for (const method of ['log', 'warn', 'error', 'info', 'debug'] as const) {
      logSpies.push(jest.spyOn(console, method).mockImplementation(() => undefined))
    }

    // The real socket path: the dispatcher publishes through SocketIOService to the rider's socket.
    const socketIOService = new SocketIOService()
    courierSocket = {
      id: 'socket-r95',
      userId: COURIER_USER_ID,
      channelNames: [`COURIER:${COURIER_USER_ID}`],
      emit: jest.fn(),
      disconnect: jest.fn(),
    }
    socketIOService.handleConnection(courierSocket as unknown as SocketWithAuth)
    const dispatcher = new SocketIODispatcher(socketIOService)

    deliveryRepository = {
      findByIdOrThrow: jest.fn(),
      findById: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      updateIfMatches: jest.fn().mockResolvedValue(true),
      findIdsWaitingForCourierOldestFirst: jest.fn().mockResolvedValue([]),
      findOpenOffersForCourier: jest.fn().mockResolvedValue([]),
    }
    deliveryEventRepository = {
      create: jest.fn().mockResolvedValue({ id: 'evt-r95' }),
      findLatestJobStepOccurredAt: jest.fn().mockResolvedValue(null),
      findLatestOfTypes: jest.fn().mockResolvedValue(null),
    }
    const courier = { id: COURIER_ID, userId: COURIER_USER_ID, status: EnumCourierStatus.ONLINE }

    service = new DeliveryEventService(
      { get: jest.fn() } as unknown as ConfigService,
      dispatcher,
      {
        findByIdOrThrow: jest.fn().mockResolvedValue(courier),
        findById: jest.fn().mockResolvedValue(courier),
        updateById: jest.fn().mockResolvedValue(courier),
        hasActiveSos: jest.fn().mockResolvedValue(false),
      } as unknown as CourierRepository,
      deliveryRepository as unknown as DeliveryRepository,
      deliveryEventRepository as unknown as DeliveryEventRepository,
      { scheduleTask: jest.fn().mockResolvedValue(undefined) } as unknown as TaskBusScheduler,
      { registerTaskHandler: jest.fn() } as unknown as TaskBusService,
      { sendDeliveryUpdatePartnerWebhook: jest.fn().mockResolvedValue(undefined) } as unknown as PartnerWebhookService,
      { findCourierForDelivery: jest.fn().mockResolvedValue({ courier }) } as unknown as DeliveryMatchingService,
      {
        calculateDeliveryAmountsForMatchedCourier: jest
          .fn()
          .mockResolvedValue({ totalCost: 5, totalCompensation: 4, fee: 1, feePercentage: 20 }),
      } as unknown as DeliveryCalculationService,
      {
        addJob: jest.fn().mockResolvedValue(undefined),
        removeDelayedJobsWithIdPrefix: jest.fn().mockResolvedValue(undefined),
      } as unknown as BullMQService,
      {
        instanceConfig: {
          getOfferExpiryEnabled: jest.fn().mockResolvedValue(true),
          getOfferExpirySeconds: jest.fn().mockResolvedValue(60),
          getNoCourierRetrySeconds: jest.fn().mockResolvedValue(30),
          getHandBackSeconds: jest.fn().mockResolvedValue(0),
          getCancellationPayoutPolicy: jest.fn().mockResolvedValue(null),
        },
      } as unknown as ConfigDomainService,
      { getOrDefault: jest.fn().mockResolvedValue([]), save: jest.fn() } as unknown as CacheService,
      { newOffer: jest.fn(), offerEnded: jest.fn(), jobCancelled: jest.fn() } as unknown as OfferPushService,
      { findOn: jest.fn().mockResolvedValue(null) } as unknown as DispatchStopRepository,
      {} as any,
      {} as any
    )
  })

  afterEach(() => {
    while (logSpies.length) logSpies.pop()!.mockRestore()
  })

  // Every argument of every logger and console call, as text. inspect also shows an object's or an
  // error's own fields, so a delivery or event passed whole (not only interpolated) is caught too.
  function allLogs(): string {
    return logSpies
      .flatMap((spy) => spy.mock.calls)
      .flat()
      .map((arg) =>
        typeof arg === 'string'
          ? arg
          : inspect(arg, { depth: 10, breakLength: Infinity, maxArrayLength: Infinity, maxStringLength: Infinity })
      )
      .join('\n')
  }

  function expectNoDetailsLogged(details: string[] = ALL_DETAILS) {
    const logs = allLogs()
    for (const detail of details) {
      expect(logs).not.toContain(detail)
    }
    // The check is not vacuous: the event really was logged, by its delivery id.
    expect(logs).toContain('Processing order event')
    expect(logs).toContain(DELIVERY_ID)
  }

  function event(type: EnumDeliveryEventType, extra: Record<string, unknown> = {}): DeliveryEvent {
    return {
      deliveryId: DELIVERY_ID,
      type,
      actor: EnumEventActor.ADMIN,
      source: EnumDeliveryEventSource.OPENCOURIER,
      message: PII_MESSAGE,
      ...extra,
    } as DeliveryEvent
  }

  // Did the event go all the way through (no failed transition in the catch block)?
  function expectNoFailedTransition() {
    const errors = logSpies.flatMap((spy) => spy.mock.calls).flat().filter((a) => typeof a === 'string')
    expect(errors.some((line) => line.startsWith('Delivery status transition failed'))).toBe(false)
  }

  function emitted(name: NotificationEventType): any[] {
    return courierSocket.emit.mock.calls.filter(([messageName]) => messageName === name).map(([, data]) => data)
  }

  // Row 101: the five fields that follow the phone's rule (holdsDelivery), and their fixture values.
  const HELD_ONLY = {
    dropoffName: DROPOFF_NAME,
    orderItems: [{ name: ORDER_ITEM, quantity: 1 }],
    customerNotes: [CUSTOMER_NOTE],
    dropoffNotes: DROPOFF_NOTES,
    dropoffSellerNotes: SELLER_NOTES,
  }
  const HELD_ONLY_TEXT = [DROPOFF_NAME, ORDER_ITEM, CUSTOMER_NOTE, DROPOFF_NOTES, SELLER_NOTES]

  // What reached the rider's socket carries none of the five: not as a key, not as text.
  function expectNoHeldOnlyDetails(delivery: Record<string, unknown>) {
    const json = JSON.stringify(delivery)
    for (const field of Object.keys(HELD_ONLY)) {
      expect(delivery[field]).toBeUndefined()
      expect(json).not.toContain(`"${field}"`)
    }
    for (const text of HELD_ONLY_TEXT) expect(json).not.toContain(text)
  }

  function expectAllHeldOnlyDetails(delivery: Record<string, unknown>) {
    const parsed = JSON.parse(JSON.stringify(delivery))
    expect(parsed).toMatchObject(HELD_ONLY)
  }

  test("creation and the offer to a rider log no contact details; the rider's offer carries the restaurant and addresses, not the customer's name, items or notes", async () => {
    deliveryRepository.findByIdOrThrow
      .mockResolvedValueOnce(deliveryAt(EnumDeliveryStatus.CREATED))
      .mockResolvedValueOnce(deliveryAt(EnumDeliveryStatus.ASSIGNING_COURIER))
      .mockResolvedValue(
        deliveryAt(EnumDeliveryStatus.ASSIGNING_COURIER, { matchedCourierId: COURIER_ID, offeredAt: new Date() })
      )

    await service.processDeliveryEvent(event(EnumDeliveryEventType.CREATED, { actor: EnumEventActor.PARTNER }))

    expectNoFailedTransition()
    // The offer reached the rider's socket, with the restaurant's details and both addresses.
    const offers = emitted(NotificationEventType.NEW_DELIVERY_OFFER)
    expect(offers).toHaveLength(1)
    expect(offers[0].delivery).toMatchObject({
      id: DELIVERY_ID,
      pickupName: PICKUP_NAME,
      pickupPhoneNumber: PICKUP_PHONE,
      pickupNotes: PICKUP_NOTES,
    })
    expect(offers[0].delivery.dropoffLocationFormattedAddress).toContain(DROPOFF_STREET)
    expect(offers[0].delivery.pickupLocationFormattedAddress).toContain(PICKUP_STREET)
    // Row 101: but not the customer's name, items or notes (nor, row 33, the phone, floor or doorbell).
    expectNoHeldOnlyDetails(offers[0].delivery)
    for (const field of ['dropoffPhoneNumber', 'dropoffFloor', 'dropoffDoorbell']) {
      expect(field in JSON.parse(JSON.stringify(offers[0].delivery))).toBe(false)
    }

    expectNoDetailsLogged()
  })

  test("a rider's accept logs no contact details; the rider still receives the customer's phone, floor and doorbell", async () => {
    deliveryRepository.findByIdOrThrow
      .mockResolvedValueOnce(deliveryAt(EnumDeliveryStatus.ASSIGNING_COURIER, { matchedCourierId: COURIER_ID }))
      .mockResolvedValue(ongoing(EnumDeliveryStatus.ACCEPTED))

    await service.processDeliveryEvent(
      event(EnumDeliveryEventType.ACCEPTED, { actor: EnumEventActor.COURIER, courierId: COURIER_ID })
    )

    expectNoFailedTransition()
    const updates = emitted(NotificationEventType.DELIVERY_STATUS_UPDATED)
    expect(updates).toHaveLength(1)
    expect(updates[0].delivery).toMatchObject({
      dropoffName: DROPOFF_NAME,
      dropoffPhoneNumber: DROPOFF_PHONE,
      dropoffFloor: FLOOR,
      dropoffDoorbell: DOORBELL,
    })
    // Row 101: once accepted, the same rider gets the name, items and notes too.
    expectAllHeldOnlyDetails(updates[0].delivery)
    expectNoDetailsLogged()
  })

  test.each([
    [EnumDeliveryStatus.ACCEPTED, EnumDeliveryEventType.DISPATCHED, EnumDeliveryStatus.DISPATCHED],
    [
      EnumDeliveryStatus.DISPATCHED,
      EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
      EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
    ],
    [EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION, EnumDeliveryEventType.PICKED_UP, EnumDeliveryStatus.PICKED_UP],
    [EnumDeliveryStatus.PICKED_UP, EnumDeliveryEventType.ON_THE_WAY, EnumDeliveryStatus.ON_THE_WAY],
    [
      EnumDeliveryStatus.ON_THE_WAY,
      EnumDeliveryEventType.ARRIVED_AT_DROPOFF_LOCATION,
      EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
    ],
    [EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION, EnumDeliveryEventType.DROPPED_OFF, EnumDeliveryStatus.DROPPED_OFF],
  ])('job step %s --%s--> %s logs no contact details; the rider is still sent the delivery, with the customer details while held', async (from, type, to) => {
    deliveryRepository.findByIdOrThrow.mockResolvedValueOnce(ongoing(from)).mockResolvedValue(ongoing(to))

    await service.processDeliveryEvent(event(type, { actor: EnumEventActor.COURIER, occurredAt: new Date() }))

    expectNoFailedTransition()
    const updates = emitted(NotificationEventType.DELIVERY_STATUS_UPDATED)
    expect(updates).toHaveLength(1)
    expect(updates[0].newStatus).toBe(to)
    expect(updates[0].delivery.id).toBe(DELIVERY_ID)
    if (to === EnumDeliveryStatus.DROPPED_OFF) {
      // Row 101: once dropped off the rider no longer holds the delivery, so the name, items and
      // notes go, as the phone (row 33) does.
      expectNoHeldOnlyDetails(updates[0].delivery)
      expect('dropoffPhoneNumber' in JSON.parse(JSON.stringify(updates[0].delivery))).toBe(false)
    } else {
      expectAllHeldOnlyDetails(updates[0].delivery)
      expect(updates[0].delivery.dropoffPhoneNumber).toBe(DROPOFF_PHONE)
    }
    expectNoDetailsLogged()
  })

  test("a rider's decline logs no contact details", async () => {
    deliveryRepository.findByIdOrThrow
      .mockResolvedValueOnce(deliveryAt(EnumDeliveryStatus.ASSIGNING_COURIER))
      .mockResolvedValue(deliveryAt(EnumDeliveryStatus.ASSIGNING_COURIER))

    await service.processDeliveryEvent(
      event(EnumDeliveryEventType.REJECTED, { actor: EnumEventActor.COURIER, courierId: COURIER_ID })
    )

    expectNoFailedTransition()
    expectNoDetailsLogged()
  })

  test('a cancellation of an open offer logs no contact details', async () => {
    deliveryRepository.findByIdOrThrow.mockResolvedValue(
      deliveryAt(EnumDeliveryStatus.ASSIGNING_COURIER, { matchedCourierId: COURIER_ID })
    )

    await service.processDeliveryEvent(event(EnumDeliveryEventType.CANCELED))

    expectNoFailedTransition()
    // The open offer was ended on the rider's socket (so the cancel path really ran to its end).
    expect(emitted(NotificationEventType.OFFER_ENDED)).toHaveLength(1)
    expectNoDetailsLogged()
  })

  test('a cancellation of a job in progress logs no contact details', async () => {
    deliveryRepository.findByIdOrThrow
      .mockResolvedValueOnce(ongoing(EnumDeliveryStatus.PICKED_UP))
      .mockResolvedValue(ongoing(EnumDeliveryStatus.CANCELED))

    await service.processDeliveryEvent(event(EnumDeliveryEventType.CANCELED))

    expectNoFailedTransition()
    expect(emitted(NotificationEventType.DELIVERY_STATUS_UPDATED)).toHaveLength(1)
    expectNoDetailsLogged()
  })

  test('an event with no legal transition logs no contact details', async () => {
    deliveryRepository.findByIdOrThrow.mockResolvedValue(ongoing(EnumDeliveryStatus.DROPPED_OFF))

    await service.processDeliveryEvent(
      event(EnumDeliveryEventType.PICKED_UP, { actor: EnumEventActor.COURIER, occurredAt: new Date() })
    )

    // The tapped step was kept as a failed row (spec 0009), so this path really ran.
    expect(deliveryEventRepository.create).toHaveBeenCalledWith(expect.objectContaining({ transitionSuccessful: false }))
    expectNoDetailsLogged()
  })

  test('the unsupported event warning names the event by ids, not its message', async () => {
    // No real transition reaches the switch's default, so one is added for this test and removed after.
    const transitions = STATE_MACHINE[EnumDeliveryStatus.CREATED].on as Record<string, string>
    transitions[EnumDeliveryEventType.CONFIRMED] = 'NOT_A_REAL_STATUS'
    try {
      deliveryRepository.findByIdOrThrow.mockResolvedValue(deliveryAt(EnumDeliveryStatus.CREATED))

      await service.processDeliveryEvent(event(EnumDeliveryEventType.CONFIRMED, { courierId: COURIER_ID }))
    } finally {
      delete transitions[EnumDeliveryEventType.CONFIRMED]
    }

    expectNoDetailsLogged()
    const warnings = (Logger.prototype.warn as unknown as jest.Mock).mock.calls.flat().join('\n')
    expect(warnings).toContain('unsupported order status event')
    expect(warnings).not.toContain('[object Object]')
    expect(warnings).toContain(`delivery=${DELIVERY_ID}`)
    expect(warnings).toContain(`type=${EnumDeliveryEventType.CONFIRMED}`)
    expect(warnings).toContain(`courier=${COURIER_ID}`)
  })

  // Every status a delivery can be in, against every event type there is: whatever path an event
  // takes (a transition, a refusal, the failure catch), the delivery's own contact details never
  // reach the log. The message here carries no detail, so this sweep checks the delivery alone.
  describe('every status against every event type', () => {
    const pairs = Object.values(EnumDeliveryStatus).flatMap((status) =>
      Object.values(EnumDeliveryEventType).map((type) => [status, type] as const)
    )

    test.each(pairs)('%s + %s logs none of the delivery contact details', async (status, type) => {
      const courierHeld = status !== EnumDeliveryStatus.CREATED && status !== EnumDeliveryStatus.ASSIGNING_COURIER
      deliveryRepository.findByIdOrThrow.mockResolvedValue(courierHeld ? ongoing(status) : deliveryAt(status))

      await service.processDeliveryEvent(
        event(type, { message: 'no detail here', courierId: COURIER_ID, occurredAt: new Date() })
      )

      expectNoDetailsLogged(DELIVERY_DETAILS)
    })
  })

  // Known leaks the row's change did not close (flagged to the operator, not fixed by the tests).
  // `test.failing` passes while the leak is there and fails once it is fixed: then make it a plain test.
  // (Jest 29 has test.failing; the installed @types/jest is 26 and does not know it, hence the cast.)
  describe('known leaks of the event message (flagged)', () => {
    test('a FAILED event logs its reason (the message) in "has failed with reason"', async () => {
      deliveryRepository.findByIdOrThrow.mockResolvedValue(ongoing(EnumDeliveryStatus.PICKED_UP))

      await service.processDeliveryEvent(event(EnumDeliveryEventType.FAILED))

      expectNoFailedTransition()
      expectNoDetailsLogged()
    })

    test('a failed transition logs the whole event, message included, in the catch block', async () => {
      // The cancel's conditional write misses (another step got there first), so the catch block runs.
      deliveryRepository.findByIdOrThrow.mockResolvedValue(ongoing(EnumDeliveryStatus.PICKED_UP))
      deliveryRepository.updateIfMatches.mockResolvedValue(false)

      await service.processDeliveryEvent(event(EnumDeliveryEventType.CANCELED))

      expect(deliveryEventRepository.create).toHaveBeenCalledWith(expect.objectContaining({ transitionSuccessful: false }))
      expectNoDetailsLogged()
    })
  })
})
