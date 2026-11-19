import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { EnumCourierDeliverySetting, EnumCourierStatus, EnumStripeAccountStatus, EnumUserRole } from '@prisma/types'
import * as crypto from 'crypto'
import { JWT_SECRET_KEY } from 'src/constants'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { CourierDomainService } from 'src/domains/courier/courier.domain.service'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import { UserDomainService } from 'src/domains/user/user.domain.service'
import * as errors from 'src/errors'
import { CacheService } from 'src/services/cache/cache.service'
import { MailService } from 'src/services/mail/mail.service'
import {
  buildResetEmail,
  describeError,
  PasswordResetService,
  RESET_BY_EMAIL_OFF_MESSAGE,
  RESET_CODE_REFUSED_MESSAGE,
  RESET_CODE_TTL_SECONDS,
  RESET_CODES_PER_HOUR,
  RESET_RESEND_WAIT_SECONDS,
  RESET_TRIES_PER_CODE,
  resetKeys,
} from './password-reset.service'

jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto')
  return {
    ...actual,
    randomInt: jest.fn(),
  }
})

describe('PasswordResetService (Spec 0039 AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13)', () => {
  let service: PasswordResetService
  let mockCacheService: {
    increment: jest.Mock
    take: jest.Mock
    setIfAbsent: jest.Mock
    save: jest.Mock
    get: jest.Mock
    delete: jest.Mock
  }
  let mockMailService: {
    isConfigured: jest.Mock
    send: jest.Mock
  }
  let mockUserDomainService: {
    findUserWithEmail: jest.Mock
  }
  let mockCourierDomainService: {
    getByUserId: jest.Mock
  }
  let mockConfigDomainService: {
    instanceConfig: {
      getDetails: jest.Mock
    }
  }
  let mockConfigService: {
    get: jest.Mock
  }
  let loggerSpies: {
    log: jest.SpyInstance
    error: jest.SpyInstance
    warn: jest.SpyInstance
  }

  const testSecretKey = 'super-test-jwt-secret-key-12345'

  const mockCourierUser = new UserEntity({
    id: 'user-courier-1',
    email: 'rider@volos.coop',
    password: 'hashed-old-password',
    role: [EnumUserRole.COURIER],
    username: null,
    apiKeyHash: null,
    apiKeyCreatedAt: null,
    credentialsChangedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  })

  const mockCourierEntity = new CourierEntity({
    id: 'courier-1',
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
    ;(crypto.randomInt as jest.Mock).mockImplementation((min: number, max?: number) => {
      if (max === undefined) return Math.floor(Math.random() * min)
      return Math.floor(Math.random() * (max - min)) + min
    })

    mockCacheService = {
      increment: jest.fn(),
      take: jest.fn(),
      setIfAbsent: jest.fn(),
      save: jest.fn(),
      get: jest.fn(),
      delete: jest.fn(),
    }
    mockMailService = {
      isConfigured: jest.fn().mockReturnValue(true),
      send: jest.fn().mockResolvedValue(undefined),
    }
    mockUserDomainService = {
      findUserWithEmail: jest.fn(),
    }
    mockCourierDomainService = {
      getByUserId: jest.fn(),
    }
    mockConfigDomainService = {
      instanceConfig: {
        getDetails: jest.fn().mockResolvedValue({ name: 'Volos Couriers Co-op' }),
      },
    }
    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === JWT_SECRET_KEY) return testSecretKey
        return undefined
      }),
    }

    service = new PasswordResetService(
      mockCacheService as unknown as CacheService,
      mockMailService as unknown as MailService,
      mockUserDomainService as unknown as UserDomainService,
      mockCourierDomainService as unknown as CourierDomainService,
      mockConfigDomainService as unknown as ConfigDomainService,
      mockConfigService as unknown as ConfigService
    )

    const logger = (service as any).logger as Logger
    loggerSpies = {
      log: jest.spyOn(logger, 'log').mockImplementation(() => {}),
      error: jest.spyOn(logger, 'error').mockImplementation(() => {}),
      warn: jest.spyOn(logger, 'warn').mockImplementation(() => {}),
    }

    service.onModuleInit()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('Clause 6: Availability and init (AC-12)', () => {
    test('isAvailable returns true when mail is configured and JWT_SECRET_KEY is present', () => {
      expect(service.isAvailable()).toBe(true)
    })

    test('isAvailable returns false when mailService.isConfigured is false', () => {
      mockMailService.isConfigured.mockReturnValue(false)
      expect(service.isAvailable()).toBe(false)
    })

    test('when JWT_SECRET_KEY is empty, logs "Mail is off: JWT_SECRET_KEY is empty..." and isAvailable is false', () => {
      mockConfigService.get.mockReturnValue('')
      const unkeyedService = new PasswordResetService(
        mockCacheService as unknown as CacheService,
        mockMailService as unknown as MailService,
        mockUserDomainService as unknown as UserDomainService,
        mockCourierDomainService as unknown as CourierDomainService,
        mockConfigDomainService as unknown as ConfigDomainService,
        mockConfigService as unknown as ConfigService
      )
      const logger = (unkeyedService as any).logger as Logger
      const logSpy = jest.spyOn(logger, 'log').mockImplementation(() => {})

      unkeyedService.onModuleInit()

      expect(unkeyedService.isAvailable()).toBe(false)
      expect(logSpy).toHaveBeenCalledWith(`Mail is off: ${JWT_SECRET_KEY} is empty, so reset codes cannot be made`)
    })
  })

  describe('Clause 1: findRider (AC-7)', () => {
    test('matches email exactly as typed', async () => {
      mockUserDomainService.findUserWithEmail.mockImplementation(async (email: string) => {
        if (email === 'Rider@Volos.Coop') return mockCourierUser
        return null
      })
      mockCourierDomainService.getByUserId.mockResolvedValue(mockCourierEntity)

      const result = await service.findRider('Rider@Volos.Coop')

      expect(result).not.toBeNull()
      expect(result?.user.id).toBe('user-courier-1')
      expect(mockUserDomainService.findUserWithEmail).toHaveBeenCalledWith('Rider@Volos.Coop')
    })

    test('matches trimmed and lower-cased email if exact typed does not match', async () => {
      mockUserDomainService.findUserWithEmail.mockImplementation(async (email: string) => {
        if (email === 'rider@volos.coop') return mockCourierUser
        return null
      })
      mockCourierDomainService.getByUserId.mockResolvedValue(mockCourierEntity)

      const result = await service.findRider('  Rider@Volos.Coop  ')

      expect(result).not.toBeNull()
      expect(result?.user.id).toBe('user-courier-1')
      expect(mockUserDomainService.findUserWithEmail).toHaveBeenNthCalledWith(1, '  Rider@Volos.Coop  ')
      expect(mockUserDomainService.findUserWithEmail).toHaveBeenNthCalledWith(2, 'rider@volos.coop')
    })

    test('returns null when user does not exist', async () => {
      mockUserDomainService.findUserWithEmail.mockResolvedValue(null)

      const result = await service.findRider('unknown@volos.coop')

      expect(result).toBeNull()
      expect(mockCourierDomainService.getByUserId).not.toHaveBeenCalled()
    })

    test('returns null when user has no email', async () => {
      const userWithoutEmail = new UserEntity({
        ...mockCourierUser,
        email: null,
      })
      mockUserDomainService.findUserWithEmail.mockResolvedValue(userWithoutEmail)

      const result = await service.findRider('noemail@volos.coop')

      expect(result).toBeNull()
    })

    test('returns null for restaurant/partner user (no COURIER role)', async () => {
      const restaurantUser = new UserEntity({
        ...mockCourierUser,
        role: [EnumUserRole.PARTNER],
      })
      mockUserDomainService.findUserWithEmail.mockResolvedValue(restaurantUser)

      const result = await service.findRider('restaurant@volos.coop')

      expect(result).toBeNull()
      expect(mockCourierDomainService.getByUserId).not.toHaveBeenCalled()
    })

    test('returns null for admin user even if they also have COURIER role', async () => {
      const adminCourierUser = new UserEntity({
        ...mockCourierUser,
        role: [EnumUserRole.COURIER, EnumUserRole.ADMIN],
      })
      mockUserDomainService.findUserWithEmail.mockResolvedValue(adminCourierUser)

      const result = await service.findRider('adminrider@volos.coop')

      expect(result).toBeNull()
      expect(mockCourierDomainService.getByUserId).not.toHaveBeenCalled()
    })

    test('returns null when user has COURIER role but no Courier row in database', async () => {
      mockUserDomainService.findUserWithEmail.mockResolvedValue(mockCourierUser)
      const notFoundError = new Error('Courier record not found')
      notFoundError.name = 'NotFoundError'
      mockCourierDomainService.getByUserId.mockRejectedValue(notFoundError)

      const result = await service.findRider('nocourier@volos.coop')

      expect(result).toBeNull()
    })
  })

  describe('Clause 2 & 3: sendCodeIfRider, code rules and email (AC-7, AC-8, AC-9, AC-13)', () => {
    beforeEach(() => {
      mockUserDomainService.findUserWithEmail.mockResolvedValue(mockCourierUser)
      mockCourierDomainService.getByUserId.mockResolvedValue(mockCourierEntity)
      mockCacheService.setIfAbsent.mockResolvedValue(true) // 60s wait passed
      mockCacheService.increment.mockResolvedValue(1) // hourly count = 1
      mockCacheService.save.mockResolvedValue(undefined)
      mockCacheService.delete.mockResolvedValue(undefined)
    })

    test('silently returns and creates no code or mail when rider is null', async () => {
      mockUserDomainService.findUserWithEmail.mockResolvedValue(null)

      await service.sendCodeIfRider('unknown@volos.coop')

      expect(mockCacheService.setIfAbsent).not.toHaveBeenCalled()
      expect(mockCacheService.save).not.toHaveBeenCalled()
      expect(mockMailService.send).not.toHaveBeenCalled()
    })

    test('keeps leading zeros (4219 -> "004219"), stores HMAC SHA-256 and deletes tries', async () => {
      ;(crypto.randomInt as jest.Mock).mockReturnValue(4219)

      await service.sendCodeIfRider('rider@volos.coop')

      const keys = resetKeys('user-courier-1')
      // 1. Wait key set for 60s
      expect(mockCacheService.setIfAbsent).toHaveBeenCalledWith(keys.wait, 1, RESET_RESEND_WAIT_SECONDS)
      // 2. Count incremented for 3600s
      expect(mockCacheService.increment).toHaveBeenCalledWith(keys.count, 3600)

      // 3. Code hashed with HMAC SHA-256 of "<userId>:<code>" keyed with JWT_SECRET_KEY
      const expectedHash = crypto.createHmac('sha256', testSecretKey).update('user-courier-1:004219').digest('hex')

      expect(mockCacheService.save).toHaveBeenCalledWith(keys.code, { codeHash: expectedHash }, RESET_CODE_TTL_SECONDS)
      // Never stores the raw code
      const savedPayload = mockCacheService.save.mock.calls[0]?.[1]
      expect(JSON.stringify(savedPayload)).not.toContain('004219')

      // 4. Tries key deleted to reset attempts for the new code
      expect(mockCacheService.delete).toHaveBeenCalledWith(keys.tries)

      // 5. Mail sent with 6-digit code to the stored user.email
      expect(mockMailService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'rider@volos.coop',
          text: expect.stringContaining('004219'),
          html: expect.stringContaining('004219'),
        })
      )

      // 6. Log line with userId
      expect(loggerSpies.log).toHaveBeenCalledWith('Password reset code sent to user user-courier-1')
    })

    test('sends mail to stored user.email, not the typed email (AC-9)', async () => {
      // Typed email has uppercase and extra spaces
      const typedEmail = '  RIDER@VOLOS.COOP  '
      mockUserDomainService.findUserWithEmail.mockImplementation(async (e: string) => {
        if (e === 'rider@volos.coop') return mockCourierUser
        return null
      })

      await service.sendCodeIfRider(typedEmail)

      expect(mockMailService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'rider@volos.coop',
        })
      )
    })

    test('refuses to make a code when 60s wait key already exists (setIfAbsent returns false)', async () => {
      mockCacheService.setIfAbsent.mockResolvedValue(false)

      await service.sendCodeIfRider('rider@volos.coop')

      expect(mockCacheService.increment).not.toHaveBeenCalled()
      expect(mockCacheService.save).not.toHaveBeenCalled()
      expect(mockMailService.send).not.toHaveBeenCalled()
    })

    test('allows up to 5 codes per hour: 5th code is created, 6th is refused (AC-8)', async () => {
      // 5th attempt: increment returns 5 -> allowed
      mockCacheService.increment.mockResolvedValue(5)
      await service.sendCodeIfRider('rider@volos.coop')
      expect(mockCacheService.save).toHaveBeenCalledTimes(1)
      expect(mockMailService.send).toHaveBeenCalledTimes(1)

      mockCacheService.save.mockClear()
      mockMailService.send.mockClear()

      // 6th attempt: increment returns 6 -> refused
      mockCacheService.increment.mockResolvedValue(6)
      await service.sendCodeIfRider('rider@volos.coop')
      expect(mockCacheService.save).not.toHaveBeenCalled()
      expect(mockMailService.send).not.toHaveBeenCalled()
    })

    test('when mail sending fails, logs error with userId and describeError, never the email (AC-12, AC-13)', async () => {
      const mailError = new Error('SMTP connection refused to rider@volos.coop')
      ;(mailError as any).code = 'ECONNREFUSED'
      ;(mailError as any).responseCode = 550
      mockMailService.send.mockRejectedValue(mailError)

      await service.sendCodeIfRider('rider@volos.coop')

      expect(loggerSpies.error).toHaveBeenCalledWith(
        'Could not send a password reset code to user user-courier-1: Error ECONNREFUSED 550'
      )
      const loggedText = loggerSpies.error.mock.calls.map((c) => c.join(' ')).join(' ')
      expect(loggedText).not.toContain('rider@volos.coop')
      expect(loggedText).not.toContain('SMTP connection refused')
    })

    test('when cacheService fails, catches and logs error with userId and describeError, never email', async () => {
      mockCacheService.setIfAbsent.mockRejectedValue(new Error('Redis connection lost searching for rider@volos.coop'))

      await service.sendCodeIfRider('rider@volos.coop')

      expect(loggerSpies.error).toHaveBeenCalledWith('Password reset for user user-courier-1 failed: Error')
      const loggedText = loggerSpies.error.mock.calls.map((c) => c.join(' ')).join(' ')
      expect(loggedText).not.toContain('rider@volos.coop')
    })
  })

  describe('Clause 3: buildResetEmail (AC-9)', () => {
    test('subject includes instance name and never the code', () => {
      const email = buildResetEmail('004219', 'Volos Couriers Co-op')

      expect(email.subject).toBe(
        'Κωδικός επαναφοράς για Volos Couriers Co-op / Password reset code for Volos Couriers Co-op'
      )
      expect(email.subject).not.toContain('004219')
    })

    test('uses fallback names when instance name is empty', () => {
      const email = buildResetEmail('004219', '')

      expect(email.subject).toBe('Κωδικός επαναφοράς για τον συνεταιρισμό / Password reset code for the co-op')
      expect(email.subject).not.toContain('004219')
    })

    test('both plain text and html bodies contain the code and Greek and English sentences', () => {
      const email = buildResetEmail('004219', 'Volos Couriers')

      const greekSentence =
        'Πληκτρολόγησε αυτόν τον κωδικό στην εφαρμογή για να ορίσεις νέο κωδικό πρόσβασης. Ισχύει για 15 λεπτά. Αν δεν το ζήτησες εσύ, αγνόησε αυτό το μήνυμα.'
      const englishSentence =
        "Type this code in the app to set a new password. It works for 15 minutes. If you didn't ask for it, ignore this email."

      // Text body
      expect(email.text).toContain('004219')
      expect(email.text).toContain(greekSentence)
      expect(email.text).toContain(englishSentence)

      // HTML body (HTML escaped)
      expect(email.html).toContain('004219')
      expect(email.html).toContain(greekSentence)
      expect(email.html).toContain('Type this code in the app')
      expect(email.html).toContain('didn&#39;t')
    })
  })

  describe('Clause 4: claimCode (AC-10, AC-11)', () => {
    const validCode = '004219'
    let validHash: string

    beforeEach(() => {
      validHash = crypto.createHmac('sha256', testSecretKey).update(`user-courier-1:${validCode}`).digest('hex')

      mockUserDomainService.findUserWithEmail.mockResolvedValue(mockCourierUser)
      mockCourierDomainService.getByUserId.mockResolvedValue(mockCourierEntity)
      mockCacheService.increment.mockResolvedValue(1) // tries = 1
      mockCacheService.get.mockResolvedValue({ codeHash: validHash })
      mockCacheService.take.mockResolvedValue({ codeHash: validHash })
      mockCacheService.delete.mockResolvedValue(undefined)
    })

    test('successfully claims code with take (GETDEL), deletes tries, and returns rider', async () => {
      const rider = await service.claimCode('rider@volos.coop', validCode)

      expect(rider.user.id).toBe('user-courier-1')
      expect(rider.courier.id).toBe('courier-1')

      const keys = resetKeys('user-courier-1')
      // Tries incremented first
      expect(mockCacheService.increment).toHaveBeenCalledWith(keys.tries, RESET_CODE_TTL_SECONDS)
      // Code read and verified
      expect(mockCacheService.get).toHaveBeenCalledWith(keys.code)
      // Code claimed atomically with take
      expect(mockCacheService.take).toHaveBeenCalledWith(keys.code)
      // Tries key deleted after claim
      expect(mockCacheService.delete).toHaveBeenCalledWith(keys.tries)
    })

    test('throws 400 when rider is not found', async () => {
      mockUserDomainService.findUserWithEmail.mockResolvedValue(null)

      await expect(service.claimCode('unknown@volos.coop', validCode)).rejects.toThrow(
        new errors.BadRequestException(RESET_CODE_REFUSED_MESSAGE)
      )
      expect(mockCacheService.increment).not.toHaveBeenCalled()
    })

    test('increments tries before comparing; above 5 deletes code and refuses without comparing (AC-11)', async () => {
      // 6th try: increment returns 6 (> 5)
      mockCacheService.increment.mockResolvedValue(6)

      const keys = resetKeys('user-courier-1')

      await expect(service.claimCode('rider@volos.coop', validCode)).rejects.toThrow(
        new errors.BadRequestException(RESET_CODE_REFUSED_MESSAGE)
      )

      // Code deleted
      expect(mockCacheService.delete).toHaveBeenCalledWith(keys.code)
      // Never compared: get and take were not called
      expect(mockCacheService.get).not.toHaveBeenCalled()
      expect(mockCacheService.take).not.toHaveBeenCalled()
    })

    test('throws 400 when no pending code exists in cache (null)', async () => {
      mockCacheService.get.mockResolvedValue(null)

      await expect(service.claimCode('rider@volos.coop', validCode)).rejects.toThrow(
        new errors.BadRequestException(RESET_CODE_REFUSED_MESSAGE)
      )
      expect(mockCacheService.take).not.toHaveBeenCalled()
    })

    test('throws 400 when code hash does not match', async () => {
      const wrongCode = '999999'

      await expect(service.claimCode('rider@volos.coop', wrongCode)).rejects.toThrow(
        new errors.BadRequestException(RESET_CODE_REFUSED_MESSAGE)
      )
      expect(mockCacheService.take).not.toHaveBeenCalled()
    })

    test('single use: throws 400 when take returns null (already claimed or concurrent claim)', async () => {
      // get sees it, but take returns null (someone else claimed it)
      mockCacheService.take.mockResolvedValue(null)

      await expect(service.claimCode('rider@volos.coop', validCode)).rejects.toThrow(
        new errors.BadRequestException(RESET_CODE_REFUSED_MESSAGE)
      )
    })

    test('throws 400 when take returns a different hash (replaced code during race)', async () => {
      mockCacheService.take.mockResolvedValue({ codeHash: 'newly-generated-hash-during-race' })

      await expect(service.claimCode('rider@volos.coop', validCode)).rejects.toThrow(
        new errors.BadRequestException(RESET_CODE_REFUSED_MESSAGE)
      )
    })
  })

  describe('describeError helper', () => {
    test('extracts name, code, responseCode; drops message', () => {
      const err = new Error('Secret address: user@coop.gr was rejected')
      ;(err as any).code = 'EAUTH'
      ;(err as any).responseCode = 535

      const desc = describeError(err)
      expect(desc).toBe('Error EAUTH 535')
      expect(desc).not.toContain('user@coop.gr')
      expect(desc).not.toContain('Secret address')
    })

    test('handles non-object errors gracefully', () => {
      expect(describeError('some string')).toBe('Error')
      expect(describeError(null)).toBe('Error')
      expect(describeError(undefined)).toBe('Error')
    })
  })
})
