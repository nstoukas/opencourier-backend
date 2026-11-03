import { Logger } from '@nestjs/common'
import { SocketIODispatcher } from 'src/services/socketio/socketio.dispatcher'
import { AblyDispatcher } from 'src/integrations/ably/ably.dispatcher'
import { NotificationEventType } from 'src/shared-types/notification'

// Spec 0023, AC-6: both live connection implementations send JOB_READY_UPDATED on the rider's own
// channel, and log the delivery id only (the message carries a business name and times).
describe('sendJobReadyUpdated on both dispatchers (spec 0023, AC-6)', () => {
  const message = {
    deliveryId: 'del-ready-1',
    restaurantName: 'R73 Kitchen',
    readyAt: '2026-11-03T12:18:00.000Z',
    foodReadyAt: '2026-11-03T12:10:00.000Z',
    delayMinutes: 10,
  }

  // Every line any Nest logger writes while a test runs.
  let logged: string[]

  beforeEach(() => {
    logged = []
    for (const method of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '))
      })
    }
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  const expectIdOnlyLogged = () => {
    const all = logged.join('\n')
    expect(all).toContain('del-ready-1')
    expect(all).not.toContain('R73 Kitchen')
    expect(all).not.toContain('2026-11-03T12:18')
    expect(all).not.toContain('2026-11-03T12:10')
  }

  test('Socket.IO publishes JOB_READY_UPDATED with the message on COURIER:<userId>, logging the delivery id only', async () => {
    const socketIOService = { publishMessage: jest.fn().mockResolvedValue(undefined) }
    const dispatcher = new SocketIODispatcher(socketIOService as any)

    await dispatcher.sendJobReadyUpdated('user-courier-1', message)

    expect(socketIOService.publishMessage).toHaveBeenCalledTimes(1)
    expect(socketIOService.publishMessage).toHaveBeenCalledWith(
      'COURIER:user-courier-1',
      NotificationEventType.JOB_READY_UPDATED,
      message
    )
    expect(NotificationEventType.JOB_READY_UPDATED).toBe('JOB_READY_UPDATED')
    expectIdOnlyLogged()
  })

  test('Ably publishes JOB_READY_UPDATED with the message on COURIER:<userId>, logging the delivery id only', async () => {
    const publish = jest.fn().mockResolvedValue(undefined)
    const ablyService = { getChannel: jest.fn().mockReturnValue({ publish }) }
    const dispatcher = new AblyDispatcher(ablyService as any)

    await dispatcher.sendJobReadyUpdated('user-courier-1', message)

    expect(ablyService.getChannel).toHaveBeenCalledWith('COURIER:user-courier-1')
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith(NotificationEventType.JOB_READY_UPDATED, message)
    expectIdOnlyLogged()
  })
})
