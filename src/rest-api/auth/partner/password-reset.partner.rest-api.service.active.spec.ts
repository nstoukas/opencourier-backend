import { Logger, ServiceUnavailableException } from '@nestjs/common'
import { EnumUserRole } from '@prisma/types'
import { PasswordService } from 'src/domains/auth/password.service'
import {
  PasswordResetService,
  RESET_BY_EMAIL_OFF_MESSAGE,
  RESET_CODE_REFUSED_MESSAGE,
} from 'src/domains/auth/password-reset.service'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import { UserDomainService } from 'src/domains/user/user.domain.service'
import * as errors from 'src/errors'
import { PasswordResetPartnerRestApiService } from './password-reset.partner.rest-api.service'

describe('PasswordResetPartnerRestApiService (Row 153, spec 0039 AC-7, AC-10, AC-12, AC-13)', () => {
  let service: PasswordResetPartnerRestApiService
  let mockPasswordResetService: {
    isAvailable: jest.Mock
    sendCodeIfRestaurant: jest.Mock
    claimRestaurantCode: jest.Mock
  }
  let mockPasswordService: {
    hash: jest.Mock
  }
  let mockUserDomainService: {
    setPasswordAndRemoveApiKey: jest.Mock
  }
  let loggerSpies: {
    log: jest.SpyInstance
    error: jest.SpyInstance
    warn: jest.SpyInstance
  }

  const mockPartnerUser = new UserEntity({
    id: 'user-partner-1',
    email: 'taverna@volos.gr',
    password: 'old-hashed-password',
    role: [EnumUserRole.PARTNER],
    username: 'tavernavolos',
    apiKeyHash: 'existing-api-key-hash',
    apiKeyCreatedAt: new Date('2026-07-01T10:00:00Z'),
    credentialsChangedAt: null,
    language: 'el',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  })

  beforeEach(() => {
    mockPasswordResetService = {
      isAvailable: jest.fn().mockReturnValue(true),
      sendCodeIfRestaurant: jest.fn().mockResolvedValue(undefined),
      claimRestaurantCode: jest.fn().mockResolvedValue({
        user: mockPartnerUser,
        partnerId: 'partner-99',
      }),
    }
    mockPasswordService = {
      hash: jest.fn().mockResolvedValue('new-hashed-password'),
    }
    mockUserDomainService = {
      setPasswordAndRemoveApiKey: jest.fn().mockResolvedValue({ apiKeyRemoved: true }),
    }

    service = new PasswordResetPartnerRestApiService(
      mockPasswordResetService as unknown as PasswordResetService,
      mockPasswordService as unknown as PasswordService,
      mockUserDomainService as unknown as UserDomainService
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

  describe('forgotPassword (Clause 1: AC-7, AC-12)', () => {
    test('throws 503 before any lookup when mail/reset is not available (AC-12)', () => {
      mockPasswordResetService.isAvailable.mockReturnValue(false)

      expect(() => service.forgotPassword('taverna@volos.gr')).toThrow(
        new ServiceUnavailableException(RESET_BY_EMAIL_OFF_MESSAGE)
      )

      expect(mockPasswordResetService.sendCodeIfRestaurant).not.toHaveBeenCalled()
    })

    test('answers synchronously without awaiting sendCodeIfRestaurant (a promise that never resolves does not block)', () => {
      // Create a promise that never resolves
      const neverResolvingPromise = new Promise<void>(() => {})
      mockPasswordResetService.sendCodeIfRestaurant.mockReturnValue(neverResolvingPromise)

      let returned = false
      const result: any = service.forgotPassword('taverna@volos.gr')
      returned = true

      expect(returned).toBe(true)
      expect(result).toBeUndefined()
      expect(mockPasswordResetService.sendCodeIfRestaurant).toHaveBeenCalledWith('taverna@volos.gr')
    })

    test('catches background error in sendCodeIfRestaurant and logs describeError without email (AC-13)', async () => {
      let rejectPromise!: (reason?: any) => void
      const backgroundPromise = new Promise<void>((_, reject) => {
        rejectPromise = reject
      })
      mockPasswordResetService.sendCodeIfRestaurant.mockReturnValue(backgroundPromise)

      service.forgotPassword('taverna@volos.gr')

      const dbError = new Error('Database connection failed for taverna@volos.gr')
      ;(dbError as any).code = 'P1001'
      rejectPromise(dbError)

      // Allow microtask queue to process the .catch handler
      await new Promise((resolve) => setImmediate(resolve))

      expect(loggerSpies.error).toHaveBeenCalledWith(
        'Password reset request failed before a restaurant was found: Error P1001'
      )
      const logged = loggerSpies.error.mock.calls.map((c) => c.join(' ')).join(' ')
      expect(logged).not.toContain('taverna@volos.gr')
      expect(logged).not.toContain('Database connection failed')
    })
  })

  describe('resetPassword (Clause 2, Clause 4: AC-10, AC-11, AC-13, Decisions 153.1 & 153.2)', () => {
    test('successful reset: claims code, hashes password, saves password and removes API key, logs partnerId, and issues no session', async () => {
      const beforeTime = new Date()
      const result = await service.resetPassword('taverna@volos.gr', '004219', 'newPassword123')
      const afterTime = new Date()

      // 1. claimRestaurantCode was called
      expect(mockPasswordResetService.claimRestaurantCode).toHaveBeenCalledWith('taverna@volos.gr', '004219')

      // 2. Password hashed
      expect(mockPasswordService.hash).toHaveBeenCalledWith('newPassword123')

      // 3. setPasswordAndRemoveApiKey called in one update with credentialsChangedAt
      expect(mockUserDomainService.setPasswordAndRemoveApiKey).toHaveBeenCalledWith(
        'user-partner-1',
        'new-hashed-password',
        expect.any(Date)
      )
      const callArgs = mockUserDomainService.setPasswordAndRemoveApiKey.mock.calls[0]
      const credentialsChangedAt = callArgs[2]
      expect(credentialsChangedAt).toBeInstanceOf(Date)
      expect(credentialsChangedAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime())
      expect(credentialsChangedAt.getTime()).toBeLessThanOrEqual(afterTime.getTime())

      // 4. Logged with partner id and API key removal notice (Decision 153.1)
      expect(loggerSpies.log).toHaveBeenCalledWith(
        'Partner partner-99 reset its password by email and lost its API key'
      )

      // 5. Returns { apiKeyRemoved: true } and NO session/tokens (Decision 153.2)
      expect(result).toEqual({ apiKeyRemoved: true })
      expect((result as any).session).toBeUndefined()
      expect((result as any).accessToken).toBeUndefined()

      // 6. Order of operations: claim -> hash -> setPasswordAndRemoveApiKey
      const claimOrder = mockPasswordResetService.claimRestaurantCode.mock.invocationCallOrder[0]
      const hashOrder = mockPasswordService.hash.mock.invocationCallOrder[0]
      const updateOrder = mockUserDomainService.setPasswordAndRemoveApiKey.mock.invocationCallOrder[0]

      expect(claimOrder).toBeDefined()
      expect(hashOrder).toBeDefined()
      expect(updateOrder).toBeDefined()

      expect(claimOrder!).toBeLessThan(hashOrder!)
      expect(hashOrder!).toBeLessThan(updateOrder!)
    })

    test('successful reset without existing API key: logs without "and lost its API key", answers apiKeyRemoved: false', async () => {
      mockUserDomainService.setPasswordAndRemoveApiKey.mockResolvedValue({ apiKeyRemoved: false })

      const result = await service.resetPassword('taverna@volos.gr', '004219', 'newPassword123')

      expect(loggerSpies.log).toHaveBeenCalledWith('Partner partner-99 reset its password by email')
      expect(result).toEqual({ apiKeyRemoved: false })
    })

    test('when claimRestaurantCode fails, nothing is hashed, user is not updated, and no log is emitted', async () => {
      mockPasswordResetService.claimRestaurantCode.mockRejectedValue(
        new errors.BadRequestException(RESET_CODE_REFUSED_MESSAGE)
      )

      await expect(service.resetPassword('taverna@volos.gr', 'wrong-code', 'newPassword123')).rejects.toThrow(
        new errors.BadRequestException(RESET_CODE_REFUSED_MESSAGE)
      )

      expect(mockPasswordService.hash).not.toHaveBeenCalled()
      expect(mockUserDomainService.setPasswordAndRemoveApiKey).not.toHaveBeenCalled()
      expect(loggerSpies.log).not.toHaveBeenCalled()
    })

    test('across tests, no logger call receives email, code, or password (AC-13, Clause 4)', async () => {
      await service.resetPassword('taverna@volos.gr', '004219', 'secretPassword999')

      const allLogged = [
        ...loggerSpies.log.mock.calls.map((c) => c.join(' ')),
        ...loggerSpies.error.mock.calls.map((c) => c.join(' ')),
        ...loggerSpies.warn.mock.calls.map((c) => c.join(' ')),
      ].join(' ')

      expect(allLogged).not.toContain('taverna@volos.gr')
      expect(allLogged).not.toContain('004219')
      expect(allLogged).not.toContain('secretPassword999')
      expect(allLogged).not.toContain('new-hashed-password')
    })
  })
})
