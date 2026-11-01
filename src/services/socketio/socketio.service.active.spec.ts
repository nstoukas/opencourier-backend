import { SocketIOService } from './socketio.service'
import { SocketWithAuth } from './types/socket-with-auth.type'

describe('SocketIOService (Spec 0013 AC-5: disconnectUser)', () => {
  let service: SocketIOService

  beforeEach(() => {
    service = new SocketIOService()
  })

  test('disconnects only the sockets belonging to the target userId', () => {
    const socketRiderPhone: Partial<SocketWithAuth> = {
      id: 'socket-rider-phone',
      userId: 'rider-user-1',
      channelNames: ['COURIER:rider-user-1'],
      disconnect: jest.fn(),
    }
    const socketRiderTablet: Partial<SocketWithAuth> = {
      id: 'socket-rider-tablet',
      userId: 'rider-user-1',
      channelNames: ['COURIER:rider-user-1'],
      disconnect: jest.fn(),
    }
    const socketOtherUser: Partial<SocketWithAuth> = {
      id: 'socket-other-phone',
      userId: 'other-user-2',
      channelNames: ['COURIER:other-user-2'],
      disconnect: jest.fn(),
    }

    service.handleConnection(socketRiderPhone as SocketWithAuth)
    service.handleConnection(socketRiderTablet as SocketWithAuth)
    service.handleConnection(socketOtherUser as SocketWithAuth)

    const closedCount = service.disconnectUser('rider-user-1')

    expect(closedCount).toBe(2)
    expect(socketRiderPhone.disconnect).toHaveBeenCalledWith(true)
    expect(socketRiderTablet.disconnect).toHaveBeenCalledWith(true)
    expect(socketOtherUser.disconnect).not.toHaveBeenCalled()
  })

  test('returns 0 when target user has no open connections', () => {
    const socketOther: Partial<SocketWithAuth> = {
      id: 'socket-1',
      userId: 'user-active',
      channelNames: [],
      disconnect: jest.fn(),
    }
    service.handleConnection(socketOther as SocketWithAuth)

    const closedCount = service.disconnectUser('unknown-user')

    expect(closedCount).toBe(0)
    expect(socketOther.disconnect).not.toHaveBeenCalled()
  })
})
