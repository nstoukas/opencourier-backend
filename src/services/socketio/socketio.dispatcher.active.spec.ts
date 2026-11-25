import { SocketIODispatcher } from './socketio.dispatcher'
import { SocketIOService } from './socketio.service'
import { AdminSocketGateway } from './admin-socket.gateway'
import { SocketWithAuth } from './types/socket-with-auth.type'
import { describeErrorForLog, errorSummaryForLog } from 'src/utils/errorForLog'
import { NotificationEventType, JobEditedMessage, courierNotificationChannel } from 'src/shared-types/index'

describe('SocketIODispatcher (Spec 0013 / Spec 0034 review fix / Row 139)', () => {
  let dispatcher: SocketIODispatcher
  let socketIOService: SocketIOService
  let adminSocketGateway: AdminSocketGateway
  let loggerErrorSpy: jest.SpyInstance

  beforeEach(() => {
    socketIOService = new SocketIOService()
    adminSocketGateway = new AdminSocketGateway()
    dispatcher = new SocketIODispatcher(socketIOService, adminSocketGateway)
    loggerErrorSpy = jest.spyOn((dispatcher as any).logger, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('disconnectUser calls both socketIOService.disconnectUser and adminSocketGateway.disconnectUser', () => {
    const socketIOSpy = jest.spyOn(socketIOService, 'disconnectUser').mockReturnValue(1)
    const adminGatewaySpy = jest.spyOn(adminSocketGateway, 'disconnectUser').mockReturnValue(1)

    dispatcher.disconnectUser('user-123')

    expect(socketIOSpy).toHaveBeenCalledWith('user-123')
    expect(adminGatewaySpy).toHaveBeenCalledWith('user-123')
  })

  test('publishMessage error logs summary and stack frames only, never Error object', async () => {
    const error = new Error('SocketIO channel emit failed')
    jest.spyOn(socketIOService, 'publishMessage').mockImplementation(() => {
      throw error
    })

    await (dispatcher as any).publishMessage('chat:user-1', 'chat-message', { text: 'hello' })

    expect(loggerErrorSpy).toHaveBeenCalledTimes(1)
    const [msg, stack] = loggerErrorSpy.mock.calls[0]!

    expect(msg).toBe(
      `There was a problem trying to publish a message to socketio channel chat:user-1: ${errorSummaryForLog(error)}`
    )
    expect(msg).toContain('Error: SocketIO channel emit failed')

    expect(stack).toBe(describeErrorForLog(error).stack)
    expect(stack).not.toBeInstanceOf(Error)
    expect(typeof stack).toBe('string')
    const lines = stack.split('\n')
    expect(lines.length).toBeGreaterThan(0)
    lines.forEach((l: string) => expect(l).toMatch(/^\s+at\s/))
  })

  test('sendJobEdited emits JOB_EDITED on courierNotificationChannel and logs delivery id only (Row 164)', async () => {
    const loggerLogSpy = jest.spyOn((dispatcher as any).logger, 'log').mockImplementation(() => {})
    const publishSpy = jest.spyOn(dispatcher as any, 'publishMessage').mockResolvedValue(undefined)

    const message: JobEditedMessage = {
      deliveryId: 'del-164',
      restaurantName: 'Secret Business Name',
      changed: ['NOTES', 'TIMES'],
      editedAt: '2026-11-25T14:00:00.000Z',
    }

    await dispatcher.sendJobEdited('courier-user-1', message)

    expect(publishSpy).toHaveBeenCalledWith(
      courierNotificationChannel('courier-user-1'),
      NotificationEventType.JOB_EDITED,
      message
    )

    expect(loggerLogSpy).toHaveBeenCalledWith('emitting JOB_EDITED for delivery del-164')
    const logged = loggerLogSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(logged).toContain('del-164')
    expect(logged).not.toContain('Secret Business Name')
  })
})

describe('AdminSocketGateway.disconnectUser (Spec 0013 / Spec 0034 review fix)', () => {
  let gateway: AdminSocketGateway

  beforeEach(() => {
    gateway = new AdminSocketGateway()
  })

  test('disconnects only that user sockets on the admins namespace and leaves other users sockets connected', () => {
    const targetSocket1 = {
      id: 'sock-1',
      userId: 'user-admin-1',
      disconnect: jest.fn(),
    } as unknown as SocketWithAuth

    const targetSocket2 = {
      id: 'sock-2',
      userId: 'user-admin-1',
      disconnect: jest.fn(),
    } as unknown as SocketWithAuth

    const otherUserSocket = {
      id: 'sock-3',
      userId: 'user-admin-2',
      disconnect: jest.fn(),
    } as unknown as SocketWithAuth

    const socketsMap = new Map<string, SocketWithAuth>([
      ['sock-1', targetSocket1],
      ['sock-2', targetSocket2],
      ['sock-3', otherUserSocket],
    ])

    // Mock the private namespace on gateway
    ;(gateway as any).namespace = {
      sockets: socketsMap,
    }

    const closed = gateway.disconnectUser('user-admin-1')

    expect(closed).toBe(2)
    expect(targetSocket1.disconnect).toHaveBeenCalledWith(true)
    expect(targetSocket2.disconnect).toHaveBeenCalledWith(true)
    expect(otherUserSocket.disconnect).not.toHaveBeenCalled()
  })

  test('returns 0 when namespace is not initialized', () => {
    ;(gateway as any).namespace = undefined
    expect(gateway.disconnectUser('user-1')).toBe(0)
  })
})
