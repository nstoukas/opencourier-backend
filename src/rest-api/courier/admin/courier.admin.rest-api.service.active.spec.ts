import { Logger } from '@nestjs/common'
import {
  EnumCourierDeliverySetting,
  EnumCourierStatus,
  EnumStripeAccountStatus,
  EnumUserRole,
} from '@prisma/types'
import { CourierAdminRestApiService } from './courier.admin.rest-api.service'
import { CourierCreateAdminInput } from './queries/courier-create.admin.input'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import * as errors from 'src/errors'

describe('CourierAdminRestApiService (Spec 0013 AC-1, AC-3, AC-4, AC-5, AC-10)', () => {
  let service: CourierAdminRestApiService
  let mockUserDomainService: any
  let mockPasswordService: any
  let mockCourierRepository: any
  let mockCourierDeviceRepository: any
  let mockCourierDomainService: any
  let mockDeliveryEventService: any
  let mockWebsocketDispatcher: any
  let loggerSpies: {
    log: jest.SpyInstance
    error: jest.SpyInstance
    warn: jest.SpyInstance
  }

  const mockCourier = new CourierEntity({
    id: 'courier-rider-1',
    node_uri: null,
    firstName: 'Kostas',
    lastName: 'Karyotakis',
    phoneNumber: '+306900000001',
    status: EnumCourierStatus.ONLINE,
    deliverySetting: EnumCourierDeliverySetting.MANUAL,
    rejectedOffers: [],
    stripeAccountId: null,
    stripeAccountStatus: EnumStripeAccountStatus.PENDING,
    userId: 'user-rider-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  })

  const mockUser = new UserEntity({
    id: 'user-rider-1',
    email: 'kostas@coop.gr',
    password: 'hashed-old-password',
    role: [EnumUserRole.COURIER],
    username: null,
    apiKey: null,
    credentialsChangedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  })

  beforeEach(() => {
    mockUserDomainService = {
      findUserWithEmailIgnoringCase: jest.fn().mockResolvedValue(null),
      findById: jest.fn().mockResolvedValue(mockUser),
      update: jest.fn().mockResolvedValue(mockUser),
    }

    mockPasswordService = {
      hash: jest.fn().mockResolvedValue('hashed!secure!pw'),
    }

    mockCourierRepository = {
      findByPhoneNumber: jest.fn().mockResolvedValue(null),
      findById: jest.fn().mockResolvedValue(mockCourier),
      createWithLogin: jest.fn().mockResolvedValue(mockCourier),
    }

    mockCourierDeviceRepository = {
      deleteAllForCourier: jest.fn().mockResolvedValue(2),
    }

    mockCourierDomainService = {
      update: jest.fn().mockResolvedValue(mockCourier),
    }

    mockDeliveryEventService = {
      handleCourierStatusChanged: jest.fn().mockResolvedValue(undefined),
    }

    mockWebsocketDispatcher = {
      disconnectUser: jest.fn().mockResolvedValue(undefined),
    }

    service = new CourierAdminRestApiService(
      mockUserDomainService,
      mockPasswordService,
      mockCourierRepository,
      mockCourierDeviceRepository,
      mockCourierDomainService,
      mockDeliveryEventService,
      mockWebsocketDispatcher
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

  describe('createCourier (AC-1, AC-3, AC-10)', () => {
    const validInput: CourierCreateAdminInput = {
      firstName: 'Kostas',
      lastName: 'Karyotakis',
      phoneNumber: '+306900000001',
      email: '  Kostas.Karyotakis@Coop.GR  ',
      password: 'plainSecretPassword888',
    }

    test('stores email trimmed and lower cased, hashes password, and creates rider with nested login', async () => {
      const result = await service.createCourier(validInput, 'admin-user-99')

      expect(mockUserDomainService.findUserWithEmailIgnoringCase).toHaveBeenCalledWith('kostas.karyotakis@coop.gr')
      expect(mockCourierRepository.findByPhoneNumber).toHaveBeenCalledWith('+306900000001')
      expect(mockPasswordService.hash).toHaveBeenCalledWith('plainSecretPassword888')

      expect(mockCourierRepository.createWithLogin).toHaveBeenCalledWith({
        firstName: 'Kostas',
        lastName: 'Karyotakis',
        phoneNumber: '+306900000001',
        login: {
          email: 'kostas.karyotakis@coop.gr',
          hashedPassword: 'hashed!secure!pw',
        },
      })

      expect(result).toBe(mockCourier)

      // AC-10: logs admin ID and courier ID only; never email, phone or password
      expect(loggerSpies.log).toHaveBeenCalledWith('Admin admin-user-99 created courier courier-rider-1')
      const loggedText = loggerSpies.log.mock.calls.map((c) => c.join(' ')).join(' ')
      expect(loggedText).not.toContain('plainSecretPassword888')
      expect(loggedText).not.toContain('hashed!secure!pw')
      expect(loggedText).not.toContain(validInput.email)
      expect(loggedText).not.toContain(validInput.phoneNumber)
    })

    test('cleans whitespace from names and phone directly in service and uses cleaned phone for duplicate check (AC-1, AC-3)', async () => {
      // Direct call without the HTTP ValidationPipe
      const rawInput: CourierCreateAdminInput = {
        firstName: ' Nikos ',
        lastName: '  Pap ',
        phoneNumber: '+30 690 000 0000',
        email: '  nikos.pap@coop.gr  ',
        password: 'plainSecretPassword888',
      }

      const result = await service.createCourier(rawInput, 'admin-user-99')

      // Pre-check for phone duplicate uses cleaned phone
      expect(mockCourierRepository.findByPhoneNumber).toHaveBeenCalledWith('+306900000000')

      // Repository createWithLogin receives trimmed names and cleaned phone
      expect(mockCourierRepository.createWithLogin).toHaveBeenCalledWith({
        firstName: 'Nikos',
        lastName: 'Pap',
        phoneNumber: '+306900000000',
        login: {
          email: 'nikos.pap@coop.gr',
          hashedPassword: 'hashed!secure!pw',
        },
      })

      expect(result).toBe(mockCourier)
    })

    test('phone duplicate check uses cleaned phone when raw input has spaces (AC-3)', async () => {
      mockCourierRepository.findByPhoneNumber.mockImplementation(async (phone: string) => {
        if (phone === '+306900000000') return mockCourier
        return null
      })

      const rawInput: CourierCreateAdminInput = {
        firstName: ' Nikos ',
        lastName: '  Pap ',
        phoneNumber: '+30 690 000 0000',
        email: 'nikos.pap@coop.gr',
        password: 'plainSecretPassword888',
      }

      await expect(service.createCourier(rawInput, 'admin-user-99')).rejects.toThrow(
        errors.CourierPhoneTakenException,
      )
      expect(mockCourierRepository.findByPhoneNumber).toHaveBeenCalledWith('+306900000000')
      expect(mockCourierRepository.createWithLogin).not.toHaveBeenCalled()
    })

    test('throws CourierEmailTakenException (409) and creates nothing when email is already taken in any case', async () => {
      mockUserDomainService.findUserWithEmailIgnoringCase.mockResolvedValue(mockUser)

      await expect(service.createCourier(validInput, 'admin-user-99')).rejects.toThrow(
        errors.CourierEmailTakenException
      )

      expect(mockCourierRepository.createWithLogin).not.toHaveBeenCalled()
      expect(mockPasswordService.hash).not.toHaveBeenCalled()
    })

    test('throws CourierPhoneTakenException (409) and creates nothing when phone is already taken', async () => {
      mockCourierRepository.findByPhoneNumber.mockResolvedValue(mockCourier)

      await expect(service.createCourier(validInput, 'admin-user-99')).rejects.toThrow(
        errors.CourierPhoneTakenException
      )

      expect(mockCourierRepository.createWithLogin).not.toHaveBeenCalled()
      expect(mockPasswordService.hash).not.toHaveBeenCalled()
    })

    test('maps unique constraint error with meta.target naming phoneNumber to CourierPhoneTakenException (409)', async () => {
      const p2002Err: any = new Error('Unique constraint failed')
      p2002Err.name = 'PrismaClientKnownRequestError'
      p2002Err.code = 'P2002'
      p2002Err.meta = { target: ['phoneNumber'] }

      mockCourierRepository.createWithLogin.mockRejectedValue(p2002Err)

      await expect(service.createCourier(validInput, 'admin-user-99')).rejects.toThrow(
        errors.CourierPhoneTakenException
      )
    })

    test('maps unique constraint error with meta.target naming email (or other) to CourierEmailTakenException (409)', async () => {
      const p2002Err: any = new Error('Unique constraint failed')
      p2002Err.name = 'PrismaClientKnownRequestError'
      p2002Err.code = 'P2002'
      p2002Err.meta = { target: ['email'] }

      mockCourierRepository.createWithLogin.mockRejectedValue(p2002Err)

      await expect(service.createCourier(validInput, 'admin-user-99')).rejects.toThrow(
        errors.CourierEmailTakenException
      )
    })
  })

  describe('rotatePassword (AC-4, AC-5, AC-10)', () => {
    test('throws 404 NotFoundException when courier does not exist', async () => {
      mockCourierRepository.findById.mockResolvedValue(null)

      await expect(service.rotatePassword('non-existent-id', 'newPassword888', 'admin-1')).rejects.toThrow(
        errors.NotFoundException
      )
      expect(mockUserDomainService.update).not.toHaveBeenCalled()
    })

    test('throws 404 NotFoundException "This rider has no login." when user has no email', async () => {
      const userWithoutEmail = new UserEntity({
        ...mockUser,
        email: null,
      })
      mockUserDomainService.findById.mockResolvedValue(userWithoutEmail)

      const call = service.rotatePassword(mockCourier.id, 'newPassword888', 'admin-1')
      await expect(call).rejects.toThrow(errors.NotFoundException)
      await expect(call).rejects.toThrow('This rider has no login.')
      expect(mockUserDomainService.update).not.toHaveBeenCalled()
    })

    test('throws 403 ForbiddenException "This login also belongs to an admin." when user role includes ADMIN and changes nothing', async () => {
      // AC-10: rotate-password routes never change an admin's login or sign them out
      const adminRiderUser = new UserEntity({
        ...mockUser,
        role: [EnumUserRole.COURIER, EnumUserRole.ADMIN],
        credentialsChangedAt: null,
      })
      mockUserDomainService.findById.mockResolvedValue(adminRiderUser)

      const call = service.rotatePassword(mockCourier.id, 'newPassword888', 'admin-user-1')
      await expect(call).rejects.toThrow(errors.ForbiddenException)
      await expect(call).rejects.toThrow('This login also belongs to an admin.')

      // Nothing is updated
      expect(mockPasswordService.hash).not.toHaveBeenCalled()
      expect(mockUserDomainService.update).not.toHaveBeenCalled()

      // Nothing is disconnected
      expect(mockWebsocketDispatcher.disconnectUser).not.toHaveBeenCalled()

      // Nothing is deleted
      expect(mockCourierDeviceRepository.deleteAllForCourier).not.toHaveBeenCalled()

      // Nothing is set Offline
      expect(mockCourierDomainService.update).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.handleCourierStatusChanged).not.toHaveBeenCalled()

      // No log written for password rotation
      expect(loggerSpies.log).not.toHaveBeenCalled()
    })

    test('updates password with hash and credentialsChangedAt, then performs cut off and logs ids only', async () => {
      const before = new Date()
      await service.rotatePassword(mockCourier.id, 'newSuperPassword99', 'admin-user-77')
      const after = new Date()

      expect(mockPasswordService.hash).toHaveBeenCalledWith('newSuperPassword99')

      // Verifies one update with hashedPassword and credentialsChangedAt as Date
      expect(mockUserDomainService.update).toHaveBeenCalledWith(mockUser.id, {
        password: 'hashed!secure!pw',
        credentialsChangedAt: expect.any(Date),
      })
      const updateData = mockUserDomainService.update.mock.calls[0]?.[1]
      expect(updateData?.credentialsChangedAt).toBeInstanceOf(Date)
      expect((updateData?.credentialsChangedAt as Date).getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect((updateData?.credentialsChangedAt as Date).getTime()).toBeLessThanOrEqual(after.getTime())

      // Verifies cut off steps
      expect(mockWebsocketDispatcher.disconnectUser).toHaveBeenCalledWith(mockCourier.userId)
      expect(mockCourierDeviceRepository.deleteAllForCourier).toHaveBeenCalledWith(mockCourier.id)
      expect(mockCourierDomainService.update).toHaveBeenCalledWith(mockCourier.id, {
        status: EnumCourierStatus.OFFLINE,
      })
      expect(mockDeliveryEventService.handleCourierStatusChanged).toHaveBeenCalledWith(
        mockCourier.id,
        EnumCourierStatus.OFFLINE
      )

      // AC-10: logs admin and courier id only
      expect(loggerSpies.log).toHaveBeenCalledWith(
        `Admin admin-user-77 set a new password for courier ${mockCourier.id}`
      )
      const logged = loggerSpies.log.mock.calls.map((c) => c.join(' ')).join(' ')
      expect(logged).not.toContain('newSuperPassword99')
      expect(logged).not.toContain('hashed!secure!pw')
      expect(logged).not.toContain(mockUser.email)
    })

    test('continues cut off when websocket disconnectUser fails, logs error, and keeps password updated', async () => {
      mockWebsocketDispatcher.disconnectUser.mockRejectedValue(new Error('Ably / socket network error'))

      await service.rotatePassword(mockCourier.id, 'newSuperPassword99', 'admin-user-77')

      // Password was still updated
      expect(mockUserDomainService.update).toHaveBeenCalledTimes(1)
      // Error was logged
      expect(loggerSpies.error).toHaveBeenCalledWith(
        `Could not close the connections of courier ${mockCourier.id}`,
        expect.any(Error)
      )
      // Remaining cut off steps still ran
      expect(mockCourierDeviceRepository.deleteAllForCourier).toHaveBeenCalledWith(mockCourier.id)
      expect(mockCourierDomainService.update).toHaveBeenCalledWith(mockCourier.id, {
        status: EnumCourierStatus.OFFLINE,
      })
      expect(mockDeliveryEventService.handleCourierStatusChanged).toHaveBeenCalledWith(
        mockCourier.id,
        EnumCourierStatus.OFFLINE
      )
    })

    test('continues cut off when deleteAllForCourier fails, logs error, and keeps password updated', async () => {
      mockCourierDeviceRepository.deleteAllForCourier.mockRejectedValue(new Error('DB device error'))

      await service.rotatePassword(mockCourier.id, 'newSuperPassword99', 'admin-user-77')

      expect(mockUserDomainService.update).toHaveBeenCalledTimes(1)
      expect(loggerSpies.error).toHaveBeenCalledWith(
        `Could not remove the devices of courier ${mockCourier.id}`,
        expect.any(Error)
      )
      expect(mockCourierDomainService.update).toHaveBeenCalledWith(mockCourier.id, {
        status: EnumCourierStatus.OFFLINE,
      })
      expect(mockDeliveryEventService.handleCourierStatusChanged).toHaveBeenCalledWith(
        mockCourier.id,
        EnumCourierStatus.OFFLINE
      )
    })

    test('continues when setting Offline fails, logs error, and keeps password updated', async () => {
      mockCourierDomainService.update.mockRejectedValue(new Error('State transition error'))

      await service.rotatePassword(mockCourier.id, 'newSuperPassword99', 'admin-user-77')

      expect(mockUserDomainService.update).toHaveBeenCalledTimes(1)
      expect(loggerSpies.error).toHaveBeenCalledWith(
        `Could not set courier ${mockCourier.id} Offline`,
        expect.any(Error)
      )
    })
  })
})
