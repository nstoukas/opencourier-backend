import { EnumDeliveryEventSource, EnumDeliveryEventType, EnumEventActor } from '@prisma/types'
import { eventLogLine } from './event-log-line'

// Row 95: how a delivery event is named in the log. Ids, type, actor and source only; the event's
// free text message (a name, a phone, an address someone typed) must never reach the log.
describe('eventLogLine (row 95)', () => {
  // The parameter type of eventLogLine, so the test objects are checked against what it accepts.
  type LogLineInput = Parameters<typeof eventLogLine>[0]

  const NAME = 'Zacharoula Ksipolytou'
  const PHONE = '+306944123987'
  const ADDRESS = 'Odos Kartali 77, Volos'

  test('holds the delivery id, type, actor, source and courier id', () => {
    const event: LogLineInput = {
      deliveryId: 'del-r95-1',
      type: EnumDeliveryEventType.ACCEPTED,
      actor: EnumEventActor.COURIER,
      source: EnumDeliveryEventSource.OPENCOURIER,
      courierId: 'courier-r95-9',
    } as LogLineInput

    const line = eventLogLine(event)

    expect(line).toContain('del-r95-1')
    expect(line).toContain(EnumDeliveryEventType.ACCEPTED)
    expect(line).toContain(EnumEventActor.COURIER)
    expect(line).toContain(EnumDeliveryEventSource.OPENCOURIER)
    expect(line).toContain('courier-r95-9')
  })

  test('leaves the courier out when the event has none', () => {
    const event = {
      deliveryId: 'del-r95-2',
      type: EnumDeliveryEventType.CREATED,
      actor: EnumEventActor.PARTNER,
      source: EnumDeliveryEventSource.OPENCOURIER,
    } as LogLineInput

    const line = eventLogLine(event)

    expect(line).toContain('del-r95-2')
    expect(line).toContain(EnumDeliveryEventType.CREATED)
    expect(line).not.toContain('courier=')
    expect(line).not.toContain('undefined')
  })

  test('never holds the message, even one carrying a name, a phone and an address', () => {
    const event = {
      deliveryId: 'del-r95-3',
      type: EnumDeliveryEventType.CANCELED,
      actor: EnumEventActor.ADMIN,
      source: EnumDeliveryEventSource.OPENCOURIER,
      courierId: 'courier-r95-9',
      message: `Customer ${NAME} at ${ADDRESS} did not answer ${PHONE}`,
    } as LogLineInput

    const line = eventLogLine(event)

    expect(line).toContain('del-r95-3')
    expect(line).not.toContain(NAME)
    expect(line).not.toContain(PHONE)
    expect(line).not.toContain(ADDRESS)
    expect(line).not.toContain('did not answer')
    expect(line).not.toContain('message')
  })

  test('ignores any extra field on the object', () => {
    // As if a whole delivery had been spread into the event: none of it may reach the line.
    const event = {
      deliveryId: 'del-r95-4',
      type: EnumDeliveryEventType.PICKED_UP,
      actor: EnumEventActor.COURIER,
      source: EnumDeliveryEventSource.OPENCOURIER,
      dropoffName: NAME,
      dropoffPhoneNumber: PHONE,
      dropoffNotes: ADDRESS,
      pickupName: 'Kyriakos Pickupidis',
      pickupPhoneNumber: '+302421099111',
      dropoffFloor: '7th floor rear',
      dropoffDoorbell: 'Doorbell-Xanthopoulou',
      occurredAt: new Date('2026-11-03T05:00:00.000Z'),
    } as unknown as LogLineInput

    const line = eventLogLine(event)

    expect(line).toBe(
      `delivery=del-r95-4 type=${EnumDeliveryEventType.PICKED_UP} actor=${EnumEventActor.COURIER} source=${EnumDeliveryEventSource.OPENCOURIER}`
    )
    for (const detail of [NAME, PHONE, ADDRESS, 'Kyriakos Pickupidis', '+302421099111', '7th floor rear', 'Doorbell-Xanthopoulou']) {
      expect(line).not.toContain(detail)
    }
  })
})
