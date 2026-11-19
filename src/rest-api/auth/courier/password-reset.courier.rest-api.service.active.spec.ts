import { Logger, ServiceUnavailableException } from '@nestjs/common'
import { EnumCourierDeliverySetting, EnumCourierStatus, EnumStripeAccountStatus, EnumUserRole } from '@prisma/types'
import { AuthDomainService } from 'src/domains/auth/auth.domain.service'
import { PasswordService } from 'src/domains/auth/password.service'
import {
  PasswordResetService,
  RESET_BY_EMAIL_OFF_MESSAGE,
  RESET_CODE_REFUSED_MESSAGE,
} from 'src/domains/auth/password-reset.service'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import { UserDomainService } from 'src/domains/user/user.domain.service'
import * as errors from 'src/errors'
import { CourierCutOffService } from 'src/services/courier-cut-off/courier-cut-off.service'
import { PasswordResetCourierRestApiService } from './password-reset.courier.rest-api.service'

describe('PasswordResetCourierRestApiService (Spec 0039 AC-7, AC-10, AC-12, AC-13)', () => {
  let service: PasswordResetCourierRestApiService
  let mockPasswordResetService: {
    isAvailable: jest.Mock
    sendCodeIfRider: jest.Mock
    claimCode: jest.Mock
  }
  let mockPasswordService: {
    hash: jest.Mock
  }
  let mockUserDomainService: {
    update: jest.Mock
  }
  let mockAuthDomainService: {
    createSessionForUser: jest.Mock
  }
  let mockCourierCutOffService: {
    cutOff: jest.Mock
  }
  let loggerSpies: {
    log: jest.SpyInstance
    error: jest.SpyInstance
    warn: jest.SpyInstance
  }

  const mockCourierUser = new UserEntity({
    id: 'user-courier-1',
    email: 'rider@volos.coop',
    password: 'old-hashed-password',
    role: [EnumUserRole.COURIER],
    username: null,
    apiKeyHash: null,
    apiKeyCreatedAt: null,
    credentialsChangedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  })

  const mockCourierEntity = new CourierEntity({
    id: 'courier-42',
    node_uri: null,
    firstName: 'Kostas',
    lastName: 'Karyotakis',
    phoneNumber: '+306912345678',
    status: EnumCourierStatus.ONLINE,
    deliverySetting: EnumCourierDeliverySetting.MANUAL,
    rejectedOffers: [],
    stripeAccountId: null,
    stripeAccountStatus: EnumStripeAccountStatus.PENDING,
    userId: 'user-courier-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  })

  beforeEach(() => {
    mockPasswordResetService = {
      isAvailable: jest.fn().mockReturnValue(true),
      sendCodeIfRider: jest.fn().mockResolvedValue(undefined),
      claimCode: jest.fn().mockResolvedValue({
        user: mockCourierUser,
        courier: mockCourierEntity,
      }),
    }
    mockPasswordService = {
      hash: jest.fn().mockResolvedValue('new-hashed-password'),
    }
    mockUserDomainService = {
      update: jest.fn().mockResolvedValue(mockCourierUser),
    }
    mockAuthDomainService = {
      createSessionForUser: jest.fn().mockResolvedValue({
        session: {
          accessToken: 'new-jwt-token',
          refreshToken: 'new-refresh-token',
          tokenType: 'Bearer',
          expiresIn: 3600,
          refreshExpiresIn: 7200,
        },
        user: mockCourierUser,
      }),
    }
    mockCourierCutOffService = {
      cutOff: jest.fn().mockResolvedValue(undefined),
    }

    service = new PasswordResetCourierRestApiService(
      mockPasswordResetService as unknown as PasswordResetService,
      mockPasswordService as unknown as PasswordService,
      mockUserDomainService as unknown as UserDomainService,
      mockAuthDomainService as unknown as AuthDomainService,
      mockCourierCutOffService as unknown as CourierCutOffService
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

  describe('forgotPassword (Clause 1, Clause 6: AC-7, AC-12)', () => {
    test('throws 503 before any lookup when mail/reset is not available (AC-12)', () => {
      mockPasswordResetService.isAvailable.mockReturnValue(false)

      expect(() => service.forgotPassword('rider@volos.coop')).toThrow(
        new ServiceUnavailableException(RESET_BY_EMAIL_OFF_MESSAGE)
      )

      expect(mockPasswordResetService.sendCodeIfRider).not.toHaveBeenCalled()
    })

    test('answers synchronously without awaiting sendCodeIfRider (a promise that never resolves does not block)', () => {
      // Create a promise that never resolves
      const neverResolvingPromise = new Promise<void>(() => {})
      mockPasswordResetService.sendCodeIfRider.mockReturnValue(neverResolvingPromise)

      let returned = false
      const result: any = service.forgotPassword('rider@volos.coop')
      returned = true

      expect(returned).toBe(true)
      expect(result).toBeUndefined()
      expect(mockPasswordResetService.sendCodeIfRider).toHaveBeenCalledWith('rider@volos.coop')
    })

    test('catches background error in sendCodeIfRider and logs describeError without email', async () => {
      let rejectPromise!: (reason?: any) => void
      const backgroundPromise = new Promise<void>((_, reject) => {
        rejectPromise = reject
      })
      mockPasswordResetService.sendCodeIfRider.mockReturnValue(backgroundPromise)

      service.forgotPassword('rider@volos.coop')

      const dbError = new Error('Database connection failed for rider@volos.coop')
      ;(dbError as any).code = 'P1001'
      rejectPromise(dbError)

      // Allow microtask queue to process the .catch handler
      await new Promise((resolve) => setImmediate(resolve))

      expect(loggerSpies.error).toHaveBeenCalledWith(
        'Password reset request failed before a rider was found: Error P1001'
      )
      const logged = loggerSpies.error.mock.calls.map((c) => c.join(' ')).join(' ')
      expect(logged).not.toContain('rider@volos.coop')
      expect(logged).not.toContain('Database connection failed')
    })
  })

  describe('resetPassword (Clause 4, Clause 7: AC-10, AC-11, AC-13)', () => {
    test('successful reset: claims code, hashes password, updates user + credentialsChangedAt, cuts off old phone, logs, and returns session', async () => {
      const beforeTime = new Date()
      const result = await service.resetPassword('rider@volos.coop', '004219', 'newPassword123')
      const afterTime = new Date()

      // 1. claimCode was called
      expect(mockPasswordResetService.claimCode).toHaveBeenCalledWith('rider@volos.coop', '004219')

      // 2. Password hashed
      expect(mockPasswordService.hash).toHaveBeenCalledWith('newPassword123')

      // 3. User updated with new hash and credentialsChangedAt in one update
      expect(mockUserDomainService.update).toHaveBeenCalledWith('user-courier-1', {
        password: 'new-hashed-password',
        credentialsChangedAt: expect.any(Date),
      })
      const updatePayload = mockUserDomainService.update.mock.calls[0]?.[1]
      expect(updatePayload.credentialsChangedAt).toBeInstanceOf(Date)
      expect(updatePayload.credentialsChangedAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime())
      expect(updatePayload.credentialsChangedAt.getTime()).toBeLessThanOrEqual(afterTime.getTime())

      // 4. Cut off called for the courier
      expect(mockCourierCutOffService.cutOff).toHaveBeenCalledWith(mockCourierEntity)

      // 5. Logged with courier id (AC-13)
      expect(loggerSpies.log).toHaveBeenCalledWith('Courier courier-42 reset their password by email')

      // 6. Session created for user
      expect(mockAuthDomainService.createSessionForUser).toHaveBeenCalledWith(mockCourierUser)

      // 7. Returns login-shaped DTO
      expect(result.id).toBe('user-courier-1')
      expect(result.session?.accessToken).toBe('new-jwt-token')

      // 8. Order of operations (AC-10): claimCode -> update -> cutOff -> createSessionForUser
      const claimOrder = mockPasswordResetService.claimCode.mock.invocationCallOrder[0]
      const updateOrder = mockUserDomainService.update.mock.invocationCallOrder[0]
      const cutOffOrder = mockCourierCutOffService.cutOff.mock.invocationCallOrder[0]
      const sessionOrder = mockAuthDomainService.createSessionForUser.mock.invocationCallOrder[0]

      expect(claimOrder).toBeDefined()
      expect(updateOrder).toBeDefined()
      expect(cutOffOrder).toBeDefined()
      expect(sessionOrder).toBeDefined()

      expect(claimOrder!).toBeLessThan(updateOrder!)
      expect(updateOrder!).toBeLessThan(cutOffOrder!)
      expect(cutOffOrder!).toBeLessThan(sessionOrder!)
    })

    test('when claimCode fails, nothing is updated and cut off is not called', async () => {
      mockPasswordResetService.claimCode.mockRejectedValue(new errors.BadRequestException(RESET_CODE_REFUSED_MESSAGE))

      await expect(service.resetPassword('rider@volos.coop', 'wrong-code', 'newPassword123')).rejects.toThrow(
        new errors.BadRequestException(RESET_CODE_REFUSED_MESSAGE)
      )

      expect(mockPasswordService.hash).not.toHaveBeenCalled()
      expect(mockUserDomainService.update).not.toHaveBeenCalled()
      expect(mockCourierCutOffService.cutOff).not.toHaveBeenCalled()
      expect(mockAuthDomainService.createSessionForUser).not.toHaveBeenCalled()
      expect(loggerSpies.log).not.toHaveBeenCalled()
    })

    test('across tests, no logger call receives email, code, or password (AC-13)', async () => {
      await service.resetPassword('rider@volos.coop', '004219', 'secretPassword999')

      const allLogged = [
        ...loggerSpies.log.mock.calls.map((c) => c.join(' ')),
        ...loggerSpies.error.mock.calls.map((c) => c.join(' ')),
        ...loggerSpies.warn.mock.calls.map((c) => c.join(' ')),
      ].join(' ')

      expect(allLogged).not.toContain('rider@volos.coop')
      expect(allLogged).not.toContain('004219')
      expect(allLogged).not.toContain('secretPassword999')
      expect(allLogged).not.toContain('new-hashed-password')
    })
  })
})
