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
