import { inspect } from 'util'
import { Logger } from '@nestjs/common'
import { EnumDeliveryStatus } from '@prisma/types'
import { SocketIODispatcher } from '../socketio/socketio.dispatcher'
import { SocketIOService } from '../socketio/socketio.service'
import { SocketWithAuth } from '../socketio/types/socket-with-auth.type'
import { AblyDispatcher } from 'src/integrations/ably/ably.dispatcher'
import { AblyService } from 'src/integrations/ably/ably.service'
import { DeliveryCourierDto } from 'src/rest-api/delivery/courier/dtos/delivery.courier.dto'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { NotificationEventType } from 'src/shared-types'

// Row 95 (and rows 31 and 33 before it): the socket dispatchers log ids and statuses only, never the
// DeliveryCourierDto, which carries the customer's and the restaurant contact's name, phone, notes,
// floor, doorbell and address. The rider still receives the whole DTO.
describe('Websocket dispatchers log no contact details (row 95)', () => {
  const USER_ID = 'user-r95-d'
  const CHANNEL = `COURIER:${USER_ID}`

  const DETAILS = {
    dropoffName: 'Euthymia Recipientopoulou',
    dropoffPhoneNumber: '+306977000951',
    pickupName: 'Pantelis Pickupakis',
    pickupPhoneNumber: '+302421000952',
    dropoffNotes: 'Gate code 4471 behind the bakery',
    pickupNotes: 'Ask for Stamatis at the till',
    dropoffSellerNotes: 'Leave by the blue door',
    dropoffFloor: 'Floor 5 flat 5B',
    dropoffDoorbell: 'Bell Karamanlidou',
  }
  const DROPOFF_STREET = 'Iasonos 123'
  const PICKUP_STREET = 'Kartali 77'
  const ALL_DETAILS = [...Object.values(DETAILS), DROPOFF_STREET, PICKUP_STREET]

  // A delivery the rider holds (ACCEPTED, no hand back window), so the DTO carries every detail.
  function heldDeliveryDto(): DeliveryCourierDto {
    return new DeliveryCourierDto({
      id: 'del-r95-d',
      status: EnumDeliveryStatus.ACCEPTED,
      handBackUntil: null,
      createdAt: new Date('2026-11-03T05:00:00.000Z'),
      ...DETAILS,
      pickupLocation: { street: PICKUP_STREET, city: 'Volos', state: null },
      dropoffLocation: { street: DROPOFF_STREET, city: 'Volos', state: null },
    } as unknown as DeliveryEntity)
  }

  // Row 101 (decision 101.1): an offer (not yet accepted) built through the real DTO, with every
  // customer detail on the delivery row. The DTO must leave out the name, items and notes.
  const ORDER_ITEM = 'Spetsofai Pilioritiko'
  const CUSTOMER_NOTE = 'Knock twice, baby asleep'
  const HELD_ONLY_FIELDS = ['dropoffName', 'orderItems', 'customerNotes', 'dropoffNotes', 'dropoffSellerNotes']
  const HELD_ONLY_TEXT = [DETAILS.dropoffName, ORDER_ITEM, CUSTOMER_NOTE, DETAILS.dropoffNotes, DETAILS.dropoffSellerNotes]

  function offerDeliveryDto(): DeliveryCourierDto {
    return new DeliveryCourierDto({
      id: 'del-r95-d',
      status: EnumDeliveryStatus.ASSIGNING_COURIER,
      matchedCourierId: 'courier-r101',
      courierId: null,
      handBackUntil: null,
      createdAt: new Date('2026-11-03T05:00:00.000Z'),
      ...DETAILS,
      orderItems: [{ name: ORDER_ITEM, quantity: 1 }],
      customerNotes: [CUSTOMER_NOTE],
      pickupLocation: { street: PICKUP_STREET, city: 'Volos', state: null },
      dropoffLocation: { street: DROPOFF_STREET, city: 'Volos', state: null },
    } as unknown as DeliveryEntity)
  }

  function expectNoHeldOnlyDetails(delivery: Record<string, unknown>) {
    const json = JSON.stringify(delivery)
    for (const field of HELD_ONLY_FIELDS) {
      expect(delivery[field]).toBeUndefined()
      expect(json).not.toContain(`"${field}"`)
    }
    for (const text of HELD_ONLY_TEXT) expect(json).not.toContain(text)
    // Not vacuous: it is the offer, with the restaurant and the address.
    expect(delivery.id).toBe('del-r95-d')
    expect(delivery.pickupName).toBe(DETAILS.pickupName)
    expect(delivery.dropoffLocationFormattedAddress).toContain(DROPOFF_STREET)
  }

  const logSpies: jest.SpyInstance[] = []

  beforeEach(() => {
    for (const method of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      logSpies.push(jest.spyOn(Logger.prototype, method).mockImplementation(() => undefined))
    }
    for (const method of ['log', 'warn', 'error', 'info', 'debug'] as const) {
      logSpies.push(jest.spyOn(console, method).mockImplementation(() => undefined))
    }
  })

  afterEach(() => {
    while (logSpies.length) logSpies.pop()!.mockRestore()
  })

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

  function expectNoDetailsLogged() {
    const logs = allLogs()
    // Not vacuous: the send was logged, by the delivery's id.
    expect(logs).toContain('del-r95-d')
    for (const detail of ALL_DETAILS) {
      expect(logs).not.toContain(detail)
    }
  }

  // The DTO a rider received still holds every detail (the address as the formatted line).
  function expectFullDelivery(delivery: DeliveryCourierDto) {
    expect(delivery).toMatchObject(DETAILS)
    expect(delivery.dropoffLocationFormattedAddress).toContain(DROPOFF_STREET)
    expect(delivery.pickupLocationFormattedAddress).toContain(PICKUP_STREET)
  }

  describe('SocketIODispatcher (through the real SocketIOService)', () => {
    let dispatcher: SocketIODispatcher
    let riderSocket: Partial<SocketWithAuth> & { emit: jest.Mock }

    beforeEach(() => {
      const socketIOService = new SocketIOService()
      riderSocket = {
        id: 'socket-r95-d',
        userId: USER_ID,
        channelNames: [CHANNEL],
        emit: jest.fn(),
        disconnect: jest.fn(),
      }
      socketIOService.handleConnection(riderSocket as unknown as SocketWithAuth)
      dispatcher = new SocketIODispatcher(socketIOService)
    })

    test('an offer logs no contact details, and the rider receives the whole delivery', async () => {
      await dispatcher.sendOfferToCourier(USER_ID, heldDeliveryDto())

      expect(riderSocket.emit).toHaveBeenCalledTimes(1)
      const [name, data] = riderSocket.emit.mock.calls[0]!
      expect(name).toBe(NotificationEventType.NEW_DELIVERY_OFFER)
      expectFullDelivery(data.delivery)
      expectNoDetailsLogged()
    })

    test("row 101: an offer not yet accepted reaches the rider's socket with no customer name, items or notes", async () => {
      await dispatcher.sendOfferToCourier(USER_ID, offerDeliveryDto())

      expect(riderSocket.emit).toHaveBeenCalledTimes(1)
      const [name, data] = riderSocket.emit.mock.calls[0]!
      expect(name).toBe(NotificationEventType.NEW_DELIVERY_OFFER)
      expectNoHeldOnlyDetails(data.delivery)
      expectNoDetailsLogged()
    })

    test('a status update logs no contact details, and the rider receives the whole delivery', async () => {
      await dispatcher.dispatchDeliveryStatusUpdated(
        USER_ID,
        EnumDeliveryStatus.ASSIGNING_COURIER,
        EnumDeliveryStatus.ACCEPTED,
        heldDeliveryDto()
      )

      expect(riderSocket.emit).toHaveBeenCalledTimes(1)
      const [name, data] = riderSocket.emit.mock.calls[0]!
      expect(name).toBe(NotificationEventType.DELIVERY_STATUS_UPDATED)
      expect(data.oldStatus).toBe(EnumDeliveryStatus.ASSIGNING_COURIER)
      expect(data.newStatus).toBe(EnumDeliveryStatus.ACCEPTED)
      expectFullDelivery(data.delivery)
      expectNoDetailsLogged()
      // The statuses are what the line is for.
      expect(allLogs()).toContain(`${EnumDeliveryStatus.ASSIGNING_COURIER} -> ${EnumDeliveryStatus.ACCEPTED}`)
    })
  })

  describe('AblyDispatcher', () => {
    let dispatcher: AblyDispatcher
    let publish: jest.Mock
    let getChannel: jest.Mock

    beforeEach(() => {
      publish = jest.fn().mockResolvedValue(undefined)
      getChannel = jest.fn().mockReturnValue({ publish })
      dispatcher = new AblyDispatcher({ getChannel } as unknown as AblyService)
    })

    test('an offer logs no contact details, and the rider receives the whole delivery', async () => {
      await dispatcher.sendOfferToCourier(USER_ID, heldDeliveryDto())

      expect(getChannel).toHaveBeenCalledWith(CHANNEL)
      expect(publish).toHaveBeenCalledTimes(1)
      const [name, delivery] = publish.mock.calls[0]!
      expect(name).toBe(NotificationEventType.NEW_DELIVERY_OFFER)
      // Ably's offer is the DTO itself, not wrapped.
      expectFullDelivery(delivery)
      expectNoDetailsLogged()
    })

    test('row 101: an offer not yet accepted is published with no customer name, items or notes', async () => {
      await dispatcher.sendOfferToCourier(USER_ID, offerDeliveryDto())

      expect(publish).toHaveBeenCalledTimes(1)
      const [name, delivery] = publish.mock.calls[0]!
      expect(name).toBe(NotificationEventType.NEW_DELIVERY_OFFER)
      expectNoHeldOnlyDetails(delivery)
      expectNoDetailsLogged()
    })

    test('a status update logs no contact details, and the rider receives the whole delivery', async () => {
      await dispatcher.dispatchDeliveryStatusUpdated(
        USER_ID,
        EnumDeliveryStatus.ACCEPTED,
        EnumDeliveryStatus.PICKED_UP,
        heldDeliveryDto()
      )

      expect(publish).toHaveBeenCalledTimes(1)
      const [name, data] = publish.mock.calls[0]!
      expect(name).toBe(NotificationEventType.DELIVERY_STATUS_UPDATED)
      expect(data.newStatus).toBe(EnumDeliveryStatus.PICKED_UP)
      expectFullDelivery(data.delivery)
      expectNoDetailsLogged()
    })
  })
})
