import { SocketIODispatcher } from './socketio.dispatcher'
import { SocketIOService } from './socketio.service'
import { AdminSocketGateway } from './admin-socket.gateway'
import { SocketWithAuth } from './types/socket-with-auth.type'

describe('SocketIODispatcher (Spec 0013 / Spec 0034 review fix)', () => {
  let dispatcher: SocketIODispatcher
  let socketIOService: SocketIOService
  let adminSocketGateway: AdminSocketGateway

  beforeEach(() => {
    socketIOService = new SocketIOService()
    adminSocketGateway = new AdminSocketGateway()
    dispatcher = new SocketIODispatcher(socketIOService, adminSocketGateway)
  })

  test('disconnectUser calls both socketIOService.disconnectUser and adminSocketGateway.disconnectUser', () => {
    const socketIOSpy = jest.spyOn(socketIOService, 'disconnectUser').mockReturnValue(1)
    const adminGatewaySpy = jest.spyOn(adminSocketGateway, 'disconnectUser').mockReturnValue(1)

    dispatcher.disconnectUser('user-123')

    expect(socketIOSpy).toHaveBeenCalledWith('user-123')
    expect(adminGatewaySpy).toHaveBeenCalledWith('user-123')
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
