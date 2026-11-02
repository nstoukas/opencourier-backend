import { Logger } from '@nestjs/common'
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

describe('SocketIOService (Spec 0016 AC-12, Decision 31.18: publishMessage logs ids only)', () => {
  let service: SocketIOService
  let loggerLogSpy: jest.SpyInstance
  let loggerErrorSpy: jest.SpyInstance
  let mockSocket: Partial<SocketWithAuth>

  beforeEach(() => {
    // Intercept Nest Logger to verify log lines contain ids only and no personal customer data
    loggerLogSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {})
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {})

    service = new SocketIOService()

    // Register an active socket client listening on channel 'PARTNER:partner-1'
    mockSocket = {
      id: 'socket-client-1',
      userId: 'partner-user-1',
      channelNames: ['PARTNER:partner-1'],
      emit: jest.fn(),
      disconnect: jest.fn(),
    }
    service.handleConnection(mockSocket as SocketWithAuth)
  })

  afterEach(() => {
    loggerLogSpy.mockRestore()
    loggerErrorSpy.mockRestore()
  })

  function getAllLogs(): string {
    return [...loggerLogSpy.mock.calls, ...loggerErrorSpy.mock.calls]
      .flat()
      .map((arg) => (typeof arg === 'object' && arg !== null ? JSON.stringify(arg) : String(arg)))
      .join('\n')
  }

  test('emits message whole and logs delivery id from { delivery: { id } } without personal data', () => {
    const message = {
      event: 'DELIVERY_STATUS_CHANGED',
      delivery: {
        id: 'del-101',
        dropoffPhoneNumber: '+306912345678',
        dropoffFloor: '2nd Floor',
        dropoffDoorbell: 'Karyotakis',
        dropoffName: 'Kostas',
      },
    }

    service.publishMessage('PARTNER:partner-1', 'DELIVERY_UPDATE', message)

    // Message is still emitted whole on the channel
    expect(mockSocket.emit).toHaveBeenCalledWith('DELIVERY_UPDATE', message)

    // Log line contains channel, message name, and delivery id
    expect(loggerLogSpy).toHaveBeenCalledWith(
      'Publishing message to channel PARTNER:partner-1: DELIVERY_UPDATE, delivery del-101'
    )

    // Never logs customer phone, floor, doorbell or name
    const allLogs = getAllLogs()
    expect(allLogs).not.toContain('+306912345678')
    expect(allLogs).not.toContain('2nd Floor')
    expect(allLogs).not.toContain('Karyotakis')
    expect(allLogs).not.toContain('Kostas')
  })

  test('emits message whole and logs delivery id from { deliveryId } without personal data', () => {
    const message = {
      deliveryId: 'del-202',
      customerPhone: '+306987654321',
      floor: '4th Floor',
      doorbell: 'Seferis',
      customerName: 'Giorgos',
    }

    service.publishMessage('PARTNER:partner-1', 'OFFER_AVAILABLE', message)

    // Message is still emitted whole on the channel
    expect(mockSocket.emit).toHaveBeenCalledWith('OFFER_AVAILABLE', message)

    // Log line contains channel, message name, and delivery id read from deliveryId
    expect(loggerLogSpy).toHaveBeenCalledWith(
      'Publishing message to channel PARTNER:partner-1: OFFER_AVAILABLE, delivery del-202'
    )

    // Never logs customer phone, floor, doorbell or name
    const allLogs = getAllLogs()
    expect(allLogs).not.toContain('+306987654321')
    expect(allLogs).not.toContain('4th Floor')
    expect(allLogs).not.toContain('Seferis')
    expect(allLogs).not.toContain('Giorgos')
  })

  test('logs "-" for delivery id when message has neither delivery nor deliveryId', () => {
    const message = { type: 'PING', timestamp: 1234567890 }

    service.publishMessage('PARTNER:partner-1', 'PING_EVENT', message)

    expect(mockSocket.emit).toHaveBeenCalledWith('PING_EVENT', message)
    expect(loggerLogSpy).toHaveBeenCalledWith(
      'Publishing message to channel PARTNER:partner-1: PING_EVENT, delivery -'
    )
  })

  test('logs "-" for delivery id when message is null or non-object primitive', () => {
    // 1. null message
    service.publishMessage('PARTNER:partner-1', 'NULL_EVENT', null)
    expect(mockSocket.emit).toHaveBeenCalledWith('NULL_EVENT', null)
    expect(loggerLogSpy).toHaveBeenCalledWith(
      'Publishing message to channel PARTNER:partner-1: NULL_EVENT, delivery -'
    )

    // 2. string message
    service.publishMessage('PARTNER:partner-1', 'STRING_EVENT', 'just a string')
    expect(mockSocket.emit).toHaveBeenCalledWith('STRING_EVENT', 'just a string')
    expect(loggerLogSpy).toHaveBeenCalledWith(
      'Publishing message to channel PARTNER:partner-1: STRING_EVENT, delivery -'
    )

    // 3. number message
    service.publishMessage('PARTNER:partner-1', 'NUM_EVENT', 42)
    expect(mockSocket.emit).toHaveBeenCalledWith('NUM_EVENT', 42)
    expect(loggerLogSpy).toHaveBeenCalledWith(
      'Publishing message to channel PARTNER:partner-1: NUM_EVENT, delivery -'
    )
  })

  test('logs error and skips emit when channel is not found', () => {
    const message = { deliveryId: 'del-303' }

    service.publishMessage('NON_EXISTENT_CHANNEL', 'SOME_EVENT', message)

    expect(loggerErrorSpy).toHaveBeenCalledWith('Channel NON_EXISTENT_CHANNEL not found')
    expect(mockSocket.emit).not.toHaveBeenCalled()
  })
})
