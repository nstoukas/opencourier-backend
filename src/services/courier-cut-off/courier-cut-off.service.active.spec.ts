import { Logger } from '@nestjs/common'
import {
  EnumCourierDeliverySetting,
  EnumCourierStatus,
  EnumCourierStatusChangeCause,
  EnumStripeAccountStatus,
} from '@prisma/types'
import { CourierCutOffService } from './courier-cut-off.service'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'

describe('CourierCutOffService (Clause 9, spec 0039 AC-10, spec 0013 AC-5)', () => {
  let service: CourierCutOffService
  let mockWebsocketDispatcher: { disconnectUser: jest.Mock }
  let mockCourierDeviceRepository: { deleteAllForCourier: jest.Mock }
  let mockCourierDomainService: { update: jest.Mock; changeStatus: jest.Mock }
  let mockDeliveryEventService: { handleCourierStatusChanged: jest.Mock }
  let loggerSpies: {
    log: jest.SpyInstance
    error: jest.SpyInstance
    warn: jest.SpyInstance
  }

  const mockCourier = new CourierEntity({
    id: 'courier-123',
    node_uri: null,
    firstName: 'Nikos',
    lastName: 'Kazantzakis',
    phoneNumber: '+306912345678',
    status: EnumCourierStatus.ONLINE,
    deliverySetting: EnumCourierDeliverySetting.MANUAL,
    rejectedOffers: [],
    stripeAccountId: null,
    stripeAccountStatus: EnumStripeAccountStatus.PENDING,
    userId: 'user-456',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  })

  beforeEach(() => {
    mockWebsocketDispatcher = {
      disconnectUser: jest.fn().mockResolvedValue(undefined),
    }
    mockCourierDeviceRepository = {
      deleteAllForCourier: jest.fn().mockResolvedValue(1),
    }
    mockCourierDomainService = {
      update: jest.fn().mockResolvedValue(mockCourier),
      changeStatus: jest.fn().mockResolvedValue(mockCourier),
    }
    mockDeliveryEventService = {
      handleCourierStatusChanged: jest.fn().mockResolvedValue(undefined),
    }

    service = new CourierCutOffService(
      mockWebsocketDispatcher as any,
      mockCourierDeviceRepository as any,
      mockCourierDomainService as any,
      mockDeliveryEventService as any
    )

    const logger = (service as any).logger as Logger
    loggerSpies = {
      log: jest.spyOn(logger, 'log').mockImplementation(() => {}),
      error: jest.spyOn(logger, 'error').mockImplementation(() => {}),
      warn: jest.spyOn(logger, 'warn').mockImplementation(() => {}),
    }
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('successfully executes all cut off steps: disconnects sockets, deletes devices, sets OFFLINE', async () => {
    await service.cutOff(mockCourier)

    // 1. Sockets closed
    expect(mockWebsocketDispatcher.disconnectUser).toHaveBeenCalledWith('user-456')

    // 2. Devices removed
    expect(mockCourierDeviceRepository.deleteAllForCourier).toHaveBeenCalledWith('courier-123')

    // 3. Status set to OFFLINE via domain service
    expect(mockCourierDomainService.changeStatus).toHaveBeenCalledWith(
      'courier-123',
      EnumCourierStatus.OFFLINE,
      EnumCourierStatusChangeCause.CUT_OFF,
      undefined
    )

    // 4. Delivery event service handles status change (ends open offers)
    expect(mockDeliveryEventService.handleCourierStatusChanged).toHaveBeenCalledWith(
      'courier-123',
      EnumCourierStatus.OFFLINE
    )

    // No errors logged
    expect(loggerSpies.error).not.toHaveBeenCalled()
  })

  test('continues cut off when websocket disconnectUser throws, logging error with courier id', async () => {
    mockWebsocketDispatcher.disconnectUser.mockRejectedValue(new Error('Connection failure'))

    await expect(service.cutOff(mockCourier)).resolves.toBeUndefined()

    expect(loggerSpies.error).toHaveBeenCalledWith(
      'Could not close the connections of courier courier-123',
      expect.any(Error)
    )
    expect(mockCourierDeviceRepository.deleteAllForCourier).toHaveBeenCalledWith('courier-123')
    expect(mockCourierDomainService.changeStatus).toHaveBeenCalledWith(
      'courier-123',
      EnumCourierStatus.OFFLINE,
      EnumCourierStatusChangeCause.CUT_OFF,
      undefined
    )
    expect(mockDeliveryEventService.handleCourierStatusChanged).toHaveBeenCalledWith(
      'courier-123',
      EnumCourierStatus.OFFLINE
    )
  })

  test('continues cut off when deleteAllForCourier throws, logging error with courier id', async () => {
    mockCourierDeviceRepository.deleteAllForCourier.mockRejectedValue(new Error('DB failure'))

    await expect(service.cutOff(mockCourier)).resolves.toBeUndefined()

    expect(loggerSpies.error).toHaveBeenCalledWith(
      'Could not remove the devices of courier courier-123',
      expect.any(Error)
    )
    expect(mockWebsocketDispatcher.disconnectUser).toHaveBeenCalledWith('user-456')
    expect(mockCourierDomainService.changeStatus).toHaveBeenCalledWith(
      'courier-123',
      EnumCourierStatus.OFFLINE,
      EnumCourierStatusChangeCause.CUT_OFF,
      undefined
    )
    expect(mockDeliveryEventService.handleCourierStatusChanged).toHaveBeenCalledWith(
      'courier-123',
      EnumCourierStatus.OFFLINE
    )
  })

  test('continues when setting Offline throws, logging error with courier id', async () => {
    mockCourierDomainService.changeStatus.mockRejectedValue(new Error('Update status failure'))

    await expect(service.cutOff(mockCourier)).resolves.toBeUndefined()

    expect(loggerSpies.error).toHaveBeenCalledWith('Could not set courier courier-123 Offline', expect.any(Error))
    expect(mockWebsocketDispatcher.disconnectUser).toHaveBeenCalledWith('user-456')
    expect(mockCourierDeviceRepository.deleteAllForCourier).toHaveBeenCalledWith('courier-123')
  })

  test('never leaks sensitive data (passwords, emails, tokens) in cut off log lines', async () => {
    mockWebsocketDispatcher.disconnectUser.mockRejectedValue(new Error('socket err'))
    await service.cutOff(mockCourier)

    const allLogged = [
      ...loggerSpies.log.mock.calls.map((c) => c.join(' ')),
      ...loggerSpies.error.mock.calls.map((c) => c.join(' ')),
      ...loggerSpies.warn.mock.calls.map((c) => c.join(' ')),
    ].join(' ')

    expect(allLogged).not.toContain('password')
    expect(allLogged).not.toContain('email')
    expect(allLogged).not.toContain('token')
  })
})
