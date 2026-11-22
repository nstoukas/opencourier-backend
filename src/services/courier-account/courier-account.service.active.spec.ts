import { BadRequestException, ConflictException, Logger } from '@nestjs/common'
import {
  EnumCourierAccountChangeKind,
  EnumCourierDeliverySetting,
  EnumCourierStatus,
  EnumCourierStatusChangeCause,
  EnumStripeAccountStatus,
  EnumUserRole,
} from '@prisma/types'
import * as errors from 'src/errors'
import { resetKeys } from 'src/domains/auth/password-reset.service'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { CourierAccountService } from './courier-account.service'

// Spec 0051 (row 108): rider account upkeep. Written from the spec's acceptance criteria and its cross
// check, not from the code: what an admin's deactivate, reactivate and edit do, what a rider's own password
// change does, and the record each leaves (AC-5).
describe('CourierAccountService (spec 0051: AC-1, AC-3, AC-4, AC-5, AC-8, cross checks 1 to 13)', () => {
  const COURIER_ID = 'courier-volos-1'
  const USER_ID = 'user-volos-1'
  const ADMIN_ID = 'admin-user-1'

  const courierEntity = (overrides: Partial<{ status: EnumCourierStatus; deactivatedAt: Date | null }> = {}) =>
    new CourierEntity({
      id: COURIER_ID,
      node_uri: null,
      firstName: 'Nikos',
      lastName: 'Rider',
      phoneNumber: '+306900000000',
      status: EnumCourierStatus.OFFLINE,
      deliverySetting: EnumCourierDeliverySetting.MANUAL,
      rejectedOffers: [],
      stripeAccountId: null,
      stripeAccountStatus: EnumStripeAccountStatus.PENDING,
      userId: USER_ID,
      createdAt: new Date('2026-01-01T10:00:00Z'),
      updatedAt: new Date('2026-01-01T10:00:00Z'),
      deactivatedAt: null,
      ...overrides,
    })

  // The rider's row as the edit reads it, with the login email.
  const storedRow = (overrides: Record<string, unknown> = {}) => ({
    id: COURIER_ID,
    node_uri: null,
    firstName: 'Nikos',
    lastName: 'Rider',
    phoneNumber: '+306900000000',
    status: EnumCourierStatus.OFFLINE,
    deliverySetting: EnumCourierDeliverySetting.MANUAL,
    stripeAccountId: null,
    stripeAccountStatus: EnumStripeAccountStatus.PENDING,
    deactivatedAt: null,
    deactivatedByUserId: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    userId: USER_ID,
    // The login's roles are read too: an admin's email is never changed here (row 108 review).
    user: { id: USER_ID, email: 'nikos@coop.gr', role: [EnumUserRole.COURIER] },
    ...overrides,
  })

  const storedUser = (overrides: Record<string, unknown> = {}) => ({
    id: USER_ID,
    email: 'nikos@coop.gr',
    password: 'hash-of-current',
    role: [EnumUserRole.COURIER],
    ...overrides,
  })

  let accounts: { deactivate: jest.Mock; reactivate: jest.Mock; record: jest.Mock; listFor: jest.Mock }
  let courierRepository: { findByPhoneNumber: jest.Mock }
  let courierDomainService: { getByIdOrThrow: jest.Mock; changeStatus: jest.Mock; update: jest.Mock }
  let userDomainService: { findById: jest.Mock; findUserWithEmailIgnoringCase: jest.Mock; update: jest.Mock }
  let passwordService: { compare: jest.Mock; hash: jest.Mock }
  let authDomainService: { createSessionForUser: jest.Mock }
  let courierCutOffService: { cutOff: jest.Mock }
  let deliveryEventService: { handleCourierStatusChanged: jest.Mock }
  let courierDeviceRepository: { findTokensForCourier: jest.Mock; deleteByTokens: jest.Mock; deleteAllForCourier: jest.Mock }
  let websocketDispatcher: { disconnectUser: jest.Mock }
  let cacheService: { get: jest.Mock; increment: jest.Mock; delete: jest.Mock }
  let mailService: { isConfigured: jest.Mock; send: jest.Mock }
  let configDomainService: { instanceConfig: { getDetails: jest.Mock } }
  let tx: { courier: { update: jest.Mock }; user: { update: jest.Mock } }
  let prisma: {
    $transaction: jest.Mock
    courier: { findUnique: jest.Mock; update: jest.Mock }
    user?: { findUnique: jest.Mock }
  }
  let service: CourierAccountService
  let order: string[]
  let logged: string[]

  // Every FIELD_EDITED (or other) row handed to the record, across calls.
  const recordedRows = () => accounts.record.mock.calls.flatMap((call) => call[0] as Array<Record<string, unknown>>)

  beforeEach(() => {
    order = []
    logged = []
    const noting = (name: string, result: unknown = undefined) =>
      jest.fn().mockImplementation(async () => {
        order.push(name)
        return result
      })

    accounts = {
      deactivate: noting('accounts.deactivate', { outcome: 'DONE', userId: USER_ID, droppedBookings: 2 }),
      reactivate: noting('accounts.reactivate', { outcome: 'DONE', userId: USER_ID }),
      record: noting('accounts.record'),
      listFor: jest.fn().mockResolvedValue([]),
    }
    courierRepository = { findByPhoneNumber: jest.fn().mockResolvedValue(null) }
    courierDomainService = {
      getByIdOrThrow: jest.fn().mockResolvedValue(courierEntity()),
      changeStatus: noting('changeStatus', { changed: true, fromStatus: EnumCourierStatus.ONLINE }),
      update: noting('courierDomainService.update'),
    }
    userDomainService = {
      findById: jest.fn().mockResolvedValue(storedUser()),
      findUserWithEmailIgnoringCase: jest.fn().mockResolvedValue(null),
      update: noting('userDomainService.update'),
    }
    passwordService = {
      // The current password is "current-password"; anything else does not match the stored hash.
      compare: jest.fn().mockImplementation(async (plain: string) => plain === 'current-password'),
      hash: jest.fn().mockResolvedValue('hash-of-new'),
    }
    authDomainService = {
      createSessionForUser: jest.fn().mockImplementation(async (user: unknown) => ({
        user,
        session: { accessToken: 'fresh-access', refreshToken: 'fresh-refresh' },
      })),
    }
    courierCutOffService = { cutOff: noting('cutOff') }
    deliveryEventService = { handleCourierStatusChanged: noting('handleCourierStatusChanged') }
    courierDeviceRepository = {
      findTokensForCourier: jest.fn().mockResolvedValue(['token-this-phone', 'token-old-phone', 'token-tablet']),
      deleteByTokens: jest.fn().mockResolvedValue(2),
      deleteAllForCourier: jest.fn().mockResolvedValue(3),
    }
    websocketDispatcher = { disconnectUser: jest.fn().mockResolvedValue(undefined) }
    cacheService = {
      get: jest.fn().mockResolvedValue(null),
      increment: jest.fn().mockResolvedValue(1),
      delete: noting('cache.delete'),
    }
    mailService = { isConfigured: jest.fn().mockReturnValue(true), send: noting('mail.send') }
    configDomainService = { instanceConfig: { getDetails: jest.fn().mockResolvedValue({ name: 'Volos Riders Co-op' }) } }
    tx = { courier: { update: noting('tx.courier.update') }, user: { update: noting('tx.user.update') } }
    prisma = {
      $transaction: jest.fn().mockImplementation((work: (client: typeof tx) => unknown) => work(tx)),
      courier: { findUnique: jest.fn().mockResolvedValue(storedRow()), update: noting('prisma.courier.update') },
      user: { findUnique: jest.fn().mockResolvedValue({ id: USER_ID, language: 'en' }) },
    }

    service = new CourierAccountService(
      accounts as any,
      courierRepository as any,
      courierDomainService as any,
      userDomainService as any,
      passwordService as any,
      authDomainService as any,
      courierCutOffService as any,
      deliveryEventService as any,
      courierDeviceRepository as any,
      websocketDispatcher as any,
      cacheService as any,
      mailService as any,
      configDomainService as any,
      prisma as any
    )

    const logger = (service as any).logger as Logger
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
      jest.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' '))
      })
    }
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('deactivate (AC-1, cross checks 1, 2, 4, 5, 8)', () => {
    const refusals: Array<[string, number, string]> = [
      ['ALREADY', 409, "This rider's account is already deactivated."],
      ['IS_ADMIN', 409, 'This login is also an admin. Take the admin role away first.'],
      ['IN_SOS', 409, 'This rider has an open SOS. Close it first.'],
      ['HOLDS_JOB', 409, 'This rider holds a job. Move it first.'],
    ]

    test.each(refusals)('%s answers %i with "%s", and the rider is not cut off', async (outcome, status, sentence) => {
      accounts.deactivate.mockResolvedValue({ outcome })

      const call = service.deactivate(COURIER_ID, ADMIN_ID, 'Left the co-op')
      await expect(call).rejects.toBeInstanceOf(ConflictException)
      await expect(call).rejects.toMatchObject({ status, message: sentence })

      expect(courierCutOffService.cutOff).not.toHaveBeenCalled()
      expect(cacheService.delete).not.toHaveBeenCalled()
    })

    test('MISSING answers 404, and nobody is cut off', async () => {
      accounts.deactivate.mockResolvedValue({ outcome: 'MISSING' })

      const call = service.deactivate('no-such-rider', ADMIN_ID, 'Left the co-op')
      await expect(call).rejects.toBeInstanceOf(errors.NotFoundException)
      await expect(call).rejects.toMatchObject({ statusCode: 404 })

      expect(courierCutOffService.cutOff).not.toHaveBeenCalled()
      expect(cacheService.delete).not.toHaveBeenCalled()
    })

    test('hands the rider, the admin, the reason and one moment to the locked transaction', async () => {
      await service.deactivate(COURIER_ID, ADMIN_ID, 'Left the co-op in November')

      expect(accounts.deactivate).toHaveBeenCalledTimes(1)
      expect(accounts.deactivate).toHaveBeenCalledWith(COURIER_ID, ADMIN_ID, 'Left the co-op in November', expect.any(Date))
    })

    test('DONE: after the transaction, the rider is cut off with cause DEACTIVATED and the admin id (cross check 4)', async () => {
      const rider = courierEntity({ status: EnumCourierStatus.ONLINE })
      courierDomainService.getByIdOrThrow.mockResolvedValue(rider)

      await service.deactivate(COURIER_ID, ADMIN_ID, 'Left the co-op')

      expect(courierCutOffService.cutOff).toHaveBeenCalledTimes(1)
      expect(courierCutOffService.cutOff).toHaveBeenCalledWith(rider, ADMIN_ID, EnumCourierStatusChangeCause.DEACTIVATED)
      expect(order.indexOf('accounts.deactivate')).toBeLessThan(order.indexOf('cutOff'))
    })

    test("DONE: every password reset key of the rider's user is dropped (cross check 2)", async () => {
      await service.deactivate(COURIER_ID, ADMIN_ID, 'Left the co-op')

      const dropped = cacheService.delete.mock.calls.map((call) => call[0] as string)
      // The pending code itself, by its literal name, and every guard beside it.
      expect(dropped).toContain(`password-reset:${USER_ID}`)
      expect([...dropped].sort()).toEqual(Object.values(resetKeys(USER_ID)).sort())
      for (const key of dropped) expect(key.startsWith('password-reset')).toBe(true)
    })

    test('DONE: a reset key that cannot be dropped does not undo the deactivation', async () => {
      cacheService.delete.mockRejectedValue(new Error('redis down'))

      await expect(service.deactivate(COURIER_ID, ADMIN_ID, 'Left the co-op')).resolves.toBeInstanceOf(CourierEntity)
      expect(courierCutOffService.cutOff).toHaveBeenCalledTimes(1)
    })

    test('DONE: answers the rider as it is after the cut off', async () => {
      const before = courierEntity({ status: EnumCourierStatus.ONLINE })
      const after = courierEntity({ status: EnumCourierStatus.OFFLINE, deactivatedAt: new Date('2026-11-21T10:00:00Z') })
      courierDomainService.getByIdOrThrow.mockResolvedValueOnce(before).mockResolvedValueOnce(after)

      await expect(service.deactivate(COURIER_ID, ADMIN_ID, 'Left the co-op')).resolves.toBe(after)
    })

    test('the reason never reaches a log line (it can name a person)', async () => {
      await service.deactivate(COURIER_ID, ADMIN_ID, 'Argument with Maria Papadopoulou')

      expect(logged.length).toBeGreaterThan(0)
      expect(logged.join('\n')).not.toContain('Maria')
      expect(logged.join('\n')).not.toContain('Argument')
    })
  })

  describe('reactivate (AC-3, cross check 9)', () => {
    test('hands the rider, the admin and the optional reason to the locked transaction and answers the rider', async () => {
      const rider = courierEntity()
      courierDomainService.getByIdOrThrow.mockResolvedValue(rider)

      await expect(service.reactivate(COURIER_ID, ADMIN_ID, 'Came back')).resolves.toBe(rider)
      expect(accounts.reactivate).toHaveBeenCalledWith(COURIER_ID, ADMIN_ID, 'Came back', expect.any(Date))
    })

    test('a reason is optional', async () => {
      await service.reactivate(COURIER_ID, ADMIN_ID, null)
      expect(accounts.reactivate).toHaveBeenCalledWith(COURIER_ID, ADMIN_ID, null, expect.any(Date))
    })

    test('a rider who is not deactivated answers 409 with the sentence', async () => {
      accounts.reactivate.mockResolvedValue({ outcome: 'NOT_DEACTIVATED' })

      const call = service.reactivate(COURIER_ID, ADMIN_ID, null)
      await expect(call).rejects.toBeInstanceOf(ConflictException)
      await expect(call).rejects.toMatchObject({ status: 409, message: "This rider's account is not deactivated." })
    })

    test('an unknown rider answers 404', async () => {
      accounts.reactivate.mockResolvedValue({ outcome: 'MISSING' })

      const call = service.reactivate('no-such-rider', ADMIN_ID, null)
      await expect(call).rejects.toBeInstanceOf(errors.NotFoundException)
      await expect(call).rejects.toMatchObject({ statusCode: 404 })
    })

    test('restores no devices and does not cut the rider off again', async () => {
      await service.reactivate(COURIER_ID, ADMIN_ID, null)

      expect(courierCutOffService.cutOff).not.toHaveBeenCalled()
      expect(courierDeviceRepository.deleteAllForCourier).not.toHaveBeenCalled()
      expect(courierDeviceRepository.deleteByTokens).not.toHaveBeenCalled()
      expect(websocketDispatcher.disconnectUser).not.toHaveBeenCalled()
    })

    // Row 108 review (ruling: "Deactivated and Online"): a swallowed cut off failure or a status change in
    // flight can leave a deactivated rider Online, so reactivate puts them Offline itself (cross check 9).
    describe('sets the rider Offline (cross check 9, row 108 review)', () => {
      test('Offline with cause ADMIN and the admin id, once, after the account is reactivated', async () => {
        await service.reactivate(COURIER_ID, ADMIN_ID, 'Came back')

        expect(courierDomainService.changeStatus).toHaveBeenCalledTimes(1)
        expect(courierDomainService.changeStatus).toHaveBeenCalledWith(
          COURIER_ID,
          EnumCourierStatus.OFFLINE,
          EnumCourierStatusChangeCause.ADMIN,
          ADMIN_ID
        )
        expect(order.indexOf('accounts.reactivate')).toBeGreaterThanOrEqual(0)
        expect(order.indexOf('accounts.reactivate')).toBeLessThan(order.indexOf('changeStatus'))
      })

      test("ends the rider's open offers, as any change to Offline does", async () => {
        await service.reactivate(COURIER_ID, ADMIN_ID, null)

        expect(deliveryEventService.handleCourierStatusChanged).toHaveBeenCalledTimes(1)
        expect(deliveryEventService.handleCourierStatusChanged).toHaveBeenCalledWith(
          COURIER_ID,
          EnumCourierStatus.OFFLINE
        )
        expect(order.indexOf('changeStatus')).toBeLessThan(order.indexOf('handleCourierStatusChanged'))
      })

      test('answers the rider as read after the status change', async () => {
        const after = courierEntity({ status: EnumCourierStatus.OFFLINE })
        courierDomainService.getByIdOrThrow.mockImplementation(async () => {
          order.push('getByIdOrThrow')
          return after
        })

        await expect(service.reactivate(COURIER_ID, ADMIN_ID, null)).resolves.toBe(after)
        expect(order.indexOf('changeStatus')).toBeLessThan(order.lastIndexOf('getByIdOrThrow'))
      })

      test.each(['NOT_DEACTIVATED', 'MISSING'])(
        '%s: a refused reactivation changes no status and ends no offer',
        async (outcome) => {
          accounts.reactivate.mockResolvedValue({ outcome })

          await expect(service.reactivate(COURIER_ID, ADMIN_ID, null)).rejects.toBeDefined()

          expect(courierDomainService.changeStatus).not.toHaveBeenCalled()
          expect(deliveryEventService.handleCourierStatusChanged).not.toHaveBeenCalled()
        }
      )

      test('a status change that fails is logged, not thrown: the rider is reactivated and answered', async () => {
        const rider = courierEntity()
        courierDomainService.getByIdOrThrow.mockResolvedValue(rider)
        courierDomainService.changeStatus.mockRejectedValue(new Error('status write failed'))

        await expect(service.reactivate(COURIER_ID, ADMIN_ID, null)).resolves.toBe(rider)

        expect(accounts.reactivate).toHaveBeenCalledTimes(1)
        const errorLines = ((service as any).logger.error as jest.Mock).mock.calls
        expect(errorLines).toHaveLength(1)
        expect(String(errorLines[0][0])).toContain(COURIER_ID)
      })

      test('ending the offers that fails is logged, not thrown', async () => {
        const rider = courierEntity()
        courierDomainService.getByIdOrThrow.mockResolvedValue(rider)
        deliveryEventService.handleCourierStatusChanged.mockRejectedValue(new Error('redis down'))

        await expect(service.reactivate(COURIER_ID, ADMIN_ID, null)).resolves.toBe(rider)

        expect(courierDomainService.changeStatus).toHaveBeenCalledTimes(1)
        expect((service as any).logger.error as jest.Mock).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('editByAdmin: only the named fields (AC-4, cross check 11, decision 108.3)', () => {
    test('an unknown rider answers 404 and writes nothing', async () => {
      prisma.courier.findUnique.mockResolvedValue(null)

      const call = service.editByAdmin('no-such-rider', { firstName: 'Anna' }, ADMIN_ID)
      await expect(call).rejects.toBeInstanceOf(errors.NotFoundException)
      expect(prisma.$transaction).not.toHaveBeenCalled()
      expect(accounts.record).not.toHaveBeenCalled()
    })

    test('`deactivatedAt`, `node_uri` and the Stripe fields in the input change nothing and leave no row', async () => {
      const smuggled = {
        deactivatedAt: new Date('2020-01-01T00:00:00Z'),
        deactivatedByUserId: 'someone',
        node_uri: 'https://elsewhere.example/rider',
        stripeAccountId: 'acct_smuggled',
        stripeAccountStatus: EnumStripeAccountStatus.COMPLETE,
        userId: 'another-user',
        id: 'another-id',
      }

      await service.editByAdmin(COURIER_ID, smuggled as any, ADMIN_ID)

      expect(prisma.$transaction).not.toHaveBeenCalled()
      expect(tx.courier.update).not.toHaveBeenCalled()
      expect(tx.user.update).not.toHaveBeenCalled()
      expect(courierDomainService.update).not.toHaveBeenCalled()
      expect(prisma.courier.update).not.toHaveBeenCalled()
      expect(recordedRows()).toEqual([])
    })

    test('beside a real change, the smuggled keys still never reach the write', async () => {
      await service.editByAdmin(
        COURIER_ID,
        { firstName: 'Nikolaos', deactivatedAt: new Date(), node_uri: 'x', stripeAccountId: 'acct_x' } as any,
        ADMIN_ID
      )

      expect(tx.courier.update).toHaveBeenCalledTimes(1)
      expect(tx.courier.update).toHaveBeenCalledWith({ where: { id: COURIER_ID }, data: { firstName: 'Nikolaos' } })
      expect(recordedRows().map((row) => row.field)).toEqual(['firstName'])
    })
  })

  describe('editByAdmin: one FIELD_EDITED row per changed field, none when unchanged (AC-5, AC-11, cross check 10)', () => {
    test('a save with the stored values writes nothing and records nothing', async () => {
      const rider = courierEntity()
      courierDomainService.getByIdOrThrow.mockResolvedValue(rider)

      const result = await service.editByAdmin(
        COURIER_ID,
        {
          firstName: 'Nikos',
          lastName: 'Rider',
          phoneNumber: '+306900000000',
          email: 'nikos@coop.gr',
          emergencyContactName: '',
          emergencyContactPhone: null,
          deliverySetting: EnumCourierDeliverySetting.MANUAL,
        },
        ADMIN_ID
      )

      expect(result).toBe(rider)
      expect(prisma.$transaction).not.toHaveBeenCalled()
      expect(tx.courier.update).not.toHaveBeenCalled()
      expect(tx.user.update).not.toHaveBeenCalled()
      expect(accounts.record).not.toHaveBeenCalled()
      expect(mailService.send).not.toHaveBeenCalled()
    })

    test('an empty edit writes nothing and records nothing', async () => {
      await service.editByAdmin(COURIER_ID, {}, ADMIN_ID)

      expect(prisma.$transaction).not.toHaveBeenCalled()
      expect(accounts.record).not.toHaveBeenCalled()
    })

    test('one changed field leaves exactly one row: the admin, FIELD_EDITED, the field, old and new value', async () => {
      await service.editByAdmin(COURIER_ID, { lastName: 'Papadopoulos' }, ADMIN_ID)

      expect(recordedRows()).toEqual([
        {
          courierId: COURIER_ID,
          actorUserId: ADMIN_ID,
          actorIsRider: false,
          kind: EnumCourierAccountChangeKind.FIELD_EDITED,
          field: 'lastName',
          oldValue: 'Rider',
          newValue: 'Papadopoulos',
        },
      ])
    })

    test('several changed fields leave one row each, and unchanged ones beside them leave none', async () => {
      await service.editByAdmin(
        COURIER_ID,
        {
          firstName: 'Nikolaos',
          lastName: 'Rider', // unchanged
          phoneNumber: '+306911111111',
          emergencyContactName: 'Maria Rider',
          emergencyContactPhone: '+306922222222',
          deliverySetting: EnumCourierDeliverySetting.AUTO_ACCEPT,
        },
        ADMIN_ID
      )

      const rows = recordedRows()
      expect(rows.map((row) => row.field).sort()).toEqual(
        ['deliverySetting', 'emergencyContactName', 'emergencyContactPhone', 'firstName', 'phoneNumber'].sort()
      )
      for (const row of rows) {
        expect(row).toMatchObject({
          courierId: COURIER_ID,
          actorUserId: ADMIN_ID,
          actorIsRider: false,
          kind: EnumCourierAccountChangeKind.FIELD_EDITED,
        })
      }
      // The phone in full, old and new (AC-5).
      expect(rows.find((row) => row.field === 'phoneNumber')).toMatchObject({
        oldValue: '+306900000000',
        newValue: '+306911111111',
      })
      expect(rows.find((row) => row.field === 'deliverySetting')).toMatchObject({
        oldValue: EnumCourierDeliverySetting.MANUAL,
        newValue: EnumCourierDeliverySetting.AUTO_ACCEPT,
      })
      expect(tx.courier.update).toHaveBeenCalledWith({
        where: { id: COURIER_ID },
        data: {
          firstName: 'Nikolaos',
          phoneNumber: '+306911111111',
          emergencyContactName: 'Maria Rider',
          emergencyContactPhone: '+306922222222',
          deliverySetting: EnumCourierDeliverySetting.AUTO_ACCEPT,
        },
      })
    })

    test('the rows are written in the same transaction as the fields', async () => {
      await service.editByAdmin(COURIER_ID, { firstName: 'Nikolaos' }, ADMIN_ID)

      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(accounts.record).toHaveBeenCalledTimes(1)
      // The record is handed the transaction's client, not left to write on its own.
      expect(accounts.record.mock.calls[0][1]).toBe(tx)
    })

    test('a name that differs only by spaces around it is unchanged', async () => {
      await service.editByAdmin(COURIER_ID, { firstName: '  Nikos  ' }, ADMIN_ID)

      expect(prisma.$transaction).not.toHaveBeenCalled()
      expect(accounts.record).not.toHaveBeenCalled()
    })

    test('clearing the emergency contact stores null and records the old value', async () => {
      prisma.courier.findUnique.mockResolvedValue(
        storedRow({ emergencyContactName: 'Maria Rider', emergencyContactPhone: '+306922222222' })
      )

      await service.editByAdmin(COURIER_ID, { emergencyContactName: '   ', emergencyContactPhone: null }, ADMIN_ID)

      expect(tx.courier.update).toHaveBeenCalledWith({
        where: { id: COURIER_ID },
        data: { emergencyContactName: null, emergencyContactPhone: null },
      })
      expect(recordedRows()).toEqual([
        expect.objectContaining({ field: 'emergencyContactName', oldValue: 'Maria Rider', newValue: null }),
        expect.objectContaining({ field: 'emergencyContactPhone', oldValue: '+306922222222', newValue: null }),
      ])
    })

    test('no value an admin typed reaches a log line', async () => {
      await service.editByAdmin(
        COURIER_ID,
        { firstName: 'Nikolaos', phoneNumber: '+306911111111', email: 'new.address@coop.gr' },
        ADMIN_ID
      )

      const all = logged.join('\n')
      expect(all).not.toContain('Nikolaos')
      expect(all).not.toContain('+306911111111')
      expect(all).not.toContain('new.address@coop.gr')
      expect(all).not.toContain('nikos@coop.gr')
    })
  })

  describe('editByAdmin: the phone is unique (AC-4)', () => {
    test("another rider's phone is refused, and nothing is written or recorded", async () => {
      courierRepository.findByPhoneNumber.mockResolvedValue({ id: 'courier-other' })

      const call = service.editByAdmin(COURIER_ID, { phoneNumber: '+306911111111' }, ADMIN_ID)
      await expect(call).rejects.toBeInstanceOf(errors.CourierPhoneTakenException)
      await expect(call).rejects.toThrow('That phone is already used by another rider.')

      expect(courierRepository.findByPhoneNumber).toHaveBeenCalledWith('+306911111111')
      expect(prisma.$transaction).not.toHaveBeenCalled()
      expect(accounts.record).not.toHaveBeenCalled()
    })

    test("two admins saving the same phone at once: the unique index's refusal reads as the same sentence", async () => {
      const clash = Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target: ['phoneNumber'] } })
      clash.name = 'PrismaClientKnownRequestError'
      prisma.$transaction.mockRejectedValue(clash)

      await expect(service.editByAdmin(COURIER_ID, { phoneNumber: '+306911111111' }, ADMIN_ID)).rejects.toBeInstanceOf(
        errors.CourierPhoneTakenException
      )
    })
  })

  describe('editByAdmin: the login email (AC-4, cross check 11)', () => {
    test('is trimmed and lower cased before it is compared, looked up and saved', async () => {
      await service.editByAdmin(COURIER_ID, { email: '  Nikos.NEW@Coop.GR ' }, ADMIN_ID)

      expect(userDomainService.findUserWithEmailIgnoringCase).toHaveBeenCalledWith('nikos.new@coop.gr')
      expect(tx.user.update).toHaveBeenCalledTimes(1)
      expect(tx.user.update.mock.calls[0][0].where).toEqual({ id: USER_ID })
      expect(tx.user.update.mock.calls[0][0].data.email).toBe('nikos.new@coop.gr')
      expect(recordedRows()).toEqual([
        {
          courierId: COURIER_ID,
          actorUserId: ADMIN_ID,
          actorIsRider: false,
          kind: EnumCourierAccountChangeKind.FIELD_EDITED,
          field: 'email',
          // In full, old and new (AC-5).
          oldValue: 'nikos@coop.gr',
          newValue: 'nikos.new@coop.gr',
        },
      ])
    })

    test("the rider's own email in other capitals is not a change: nothing written, no row, no mail", async () => {
      await service.editByAdmin(COURIER_ID, { email: ' NIKOS@Coop.gr ' }, ADMIN_ID)

      expect(prisma.$transaction).not.toHaveBeenCalled()
      expect(accounts.record).not.toHaveBeenCalled()
      expect(mailService.send).not.toHaveBeenCalled()
      expect(cacheService.delete).not.toHaveBeenCalled()
    })

    // Row 108 review (ruling: "An unchanged form rewriting the email"): logins made before the lower casing
    // are stored with capitals. Saving the form unchanged sent the same address back, the server lower cased
    // it, saw a "change", and signed the rider out. The two are compared ignoring case.
    describe('a stored email with capitals (row 108 review)', () => {
      beforeEach(() => {
        prisma.courier.findUnique.mockResolvedValue(
          storedRow({ user: { id: USER_ID, email: 'Nikos.Rider@Coop.GR', role: [EnumUserRole.COURIER] } })
        )
      })

      const unchanged = ['Nikos.Rider@Coop.GR', 'nikos.rider@coop.gr', '  NIKOS.RIDER@COOP.GR ']

      test.each(unchanged)('"%s" sent back is no change: no write, no row, no session end, no mail', async (email) => {
        const rider = courierEntity()
        courierDomainService.getByIdOrThrow.mockResolvedValue(rider)

        await expect(service.editByAdmin(COURIER_ID, { email }, ADMIN_ID)).resolves.toBe(rider)

        expect(prisma.$transaction).not.toHaveBeenCalled()
        // No row.
        expect(accounts.record).not.toHaveBeenCalled()
        // No session end: credentialsChangedAt is only ever set by this write.
        expect(tx.user.update).not.toHaveBeenCalled()
        expect(userDomainService.update).not.toHaveBeenCalled()
        expect(websocketDispatcher.disconnectUser).not.toHaveBeenCalled()
        // No mail, no reset code dropped, and no lookup for a clash with itself.
        expect(mailService.send).not.toHaveBeenCalled()
        expect(cacheService.delete).not.toHaveBeenCalled()
        expect(userDomainService.findUserWithEmailIgnoringCase).not.toHaveBeenCalled()
      })

      test('beside a real change, the unchanged email is left out: one row, no session end, no mail', async () => {
        await service.editByAdmin(COURIER_ID, { email: 'nikos.rider@coop.gr', firstName: 'Nikolaos' }, ADMIN_ID)

        expect(recordedRows().map((row) => row.field)).toEqual(['firstName'])
        expect(tx.user.update).not.toHaveBeenCalled()
        expect(mailService.send).not.toHaveBeenCalled()
        expect(cacheService.delete).not.toHaveBeenCalled()
      })

      test('a really different email is still a change, recorded with the old value as it was stored', async () => {
        await service.editByAdmin(COURIER_ID, { email: 'Nikos.New@coop.gr' }, ADMIN_ID)

        expect(tx.user.update).toHaveBeenCalledTimes(1)
        expect(tx.user.update.mock.calls[0][0].data.email).toBe('nikos.new@coop.gr')
        expect(recordedRows()).toEqual([
          expect.objectContaining({ field: 'email', oldValue: 'Nikos.Rider@Coop.GR', newValue: 'nikos.new@coop.gr' }),
        ])
        expect(mailService.send).toHaveBeenCalledTimes(1)
        expect(mailService.send.mock.calls[0][0].to).toBe('Nikos.Rider@Coop.GR')
      })
    })

    // Row 108 review (ruling: "Input edges answering 500"): `email: null` reads as not sent.
    describe('`email: null` (row 108 review)', () => {
      test('alone, it is not an error and changes nothing', async () => {
        const rider = courierEntity()
        courierDomainService.getByIdOrThrow.mockResolvedValue(rider)

        await expect(service.editByAdmin(COURIER_ID, { email: null } as any, ADMIN_ID)).resolves.toBe(rider)

        expect(prisma.$transaction).not.toHaveBeenCalled()
        expect(tx.user.update).not.toHaveBeenCalled()
        expect(accounts.record).not.toHaveBeenCalled()
        expect(mailService.send).not.toHaveBeenCalled()
        expect(cacheService.delete).not.toHaveBeenCalled()
        expect(userDomainService.findUserWithEmailIgnoringCase).not.toHaveBeenCalled()
      })

      test('beside another field, that field is saved and the email is left alone', async () => {
        await service.editByAdmin(COURIER_ID, { email: null, firstName: 'Nikolaos' } as any, ADMIN_ID)

        expect(tx.courier.update).toHaveBeenCalledWith({ where: { id: COURIER_ID }, data: { firstName: 'Nikolaos' } })
        expect(tx.user.update).not.toHaveBeenCalled()
        expect(recordedRows().map((row) => row.field)).toEqual(['firstName'])
        expect(mailService.send).not.toHaveBeenCalled()
      })

      test('an empty or blank email is not sent either (the login keeps its email)', async () => {
        await service.editByAdmin(COURIER_ID, { email: '   ' }, ADMIN_ID)

        expect(prisma.$transaction).not.toHaveBeenCalled()
        expect(accounts.record).not.toHaveBeenCalled()
      })
    })

    // Row 108 review (ruling: "Changing the email of a login that is also an admin"): refused, as the set
    // password route refuses it, because a changed email ends every session of that login.
    describe('a login that is also an admin (row 108 review)', () => {
      beforeEach(() => {
        prisma.courier.findUnique.mockResolvedValue(
          storedRow({ user: { id: USER_ID, email: 'nikos@coop.gr', role: [EnumUserRole.COURIER, EnumUserRole.ADMIN] } })
        )
      })

      test("the rider's roles are read with the row", async () => {
        await service.editByAdmin(COURIER_ID, { firstName: 'Nikolaos' }, ADMIN_ID)

        const query = prisma.courier.findUnique.mock.calls[0][0]
        expect(query.where).toEqual({ id: COURIER_ID })
        expect(query.include.user.select).toMatchObject({ id: true, email: true, role: true })
      })

      test('a changed email answers 409 with the sentence, and nothing is written, recorded, dropped or mailed', async () => {
        const call = service.editByAdmin(COURIER_ID, { email: 'nikos.new@coop.gr', firstName: 'Nikolaos' }, ADMIN_ID)
        await expect(call).rejects.toBeInstanceOf(ConflictException)
        await expect(call).rejects.toMatchObject({
          status: 409,
          message: 'This login is also an admin. Take the admin role away first.',
        })

        expect(prisma.$transaction).not.toHaveBeenCalled()
        expect(tx.user.update).not.toHaveBeenCalled()
        expect(tx.courier.update).not.toHaveBeenCalled()
        expect(accounts.record).not.toHaveBeenCalled()
        expect(cacheService.delete).not.toHaveBeenCalled()
        expect(mailService.send).not.toHaveBeenCalled()
      })

      test('refused before the address is looked up, so a taken address is not what the admin is told', async () => {
        userDomainService.findUserWithEmailIgnoringCase.mockResolvedValue({ id: 'user-other', email: 'taken@coop.gr' })

        await expect(service.editByAdmin(COURIER_ID, { email: 'taken@coop.gr' }, ADMIN_ID)).rejects.toMatchObject({
          status: 409,
          message: 'This login is also an admin. Take the admin role away first.',
        })
      })

      test('its other fields can still be edited, and its own email sent back unchanged is fine', async () => {
        await expect(
          service.editByAdmin(COURIER_ID, { email: 'NIKOS@coop.gr', phoneNumber: '+306911111111' }, ADMIN_ID)
        ).resolves.toBeInstanceOf(CourierEntity)

        expect(tx.courier.update).toHaveBeenCalledWith({
          where: { id: COURIER_ID },
          data: { phoneNumber: '+306911111111' },
        })
        expect(tx.user.update).not.toHaveBeenCalled()
        expect(recordedRows().map((row) => row.field)).toEqual(['phoneNumber'])
      })
    })

    test("another account's email, in any capitals, is refused, and nothing is written, recorded or mailed", async () => {
      userDomainService.findUserWithEmailIgnoringCase.mockResolvedValue({ id: 'user-other', email: 'Taken@Coop.gr' })

      const call = service.editByAdmin(COURIER_ID, { email: 'TAKEN@coop.gr', firstName: 'Nikolaos' }, ADMIN_ID)
      await expect(call).rejects.toBeInstanceOf(errors.CourierEmailTakenException)
      await expect(call).rejects.toThrow('That email is already used by another account.')

      expect(userDomainService.findUserWithEmailIgnoringCase).toHaveBeenCalledWith('taken@coop.gr')
      expect(prisma.$transaction).not.toHaveBeenCalled()
      expect(accounts.record).not.toHaveBeenCalled()
      expect(mailService.send).not.toHaveBeenCalled()
    })

    test('a changed email sets credentialsChangedAt (ending the sessions) and keeps the password', async () => {
      const before = Date.now()
      await service.editByAdmin(COURIER_ID, { email: 'nikos.new@coop.gr' }, ADMIN_ID)

      const data = tx.user.update.mock.calls[0][0].data
      expect(data.credentialsChangedAt).toBeInstanceOf(Date)
      expect(data.credentialsChangedAt.getTime()).toBeGreaterThanOrEqual(before)
      expect(data).not.toHaveProperty('password')
      expect(Object.keys(data).sort()).toEqual(['credentialsChangedAt', 'email'])
    })

    test('the email and the other fields are saved in one transaction with their rows', async () => {
      await service.editByAdmin(COURIER_ID, { email: 'nikos.new@coop.gr', firstName: 'Nikolaos' }, ADMIN_ID)

      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(tx.courier.update).toHaveBeenCalledWith({ where: { id: COURIER_ID }, data: { firstName: 'Nikolaos' } })
      expect(tx.user.update).toHaveBeenCalledTimes(1)
      expect(recordedRows().map((row) => row.field).sort()).toEqual(['email', 'firstName'])
      // The email never goes into the Courier row.
      expect(tx.courier.update.mock.calls[0][0].data).not.toHaveProperty('email')
    })

    test('a changed email drops every password reset key of the user', async () => {
      await service.editByAdmin(COURIER_ID, { email: 'nikos.new@coop.gr' }, ADMIN_ID)

      const dropped = cacheService.delete.mock.calls.map((call) => call[0] as string)
      expect(dropped).toContain(`password-reset:${USER_ID}`)
      expect([...dropped].sort()).toEqual(Object.values(resetKeys(USER_ID)).sort())
    })

    test('a changed email mails the OLD address, naming the co-op and the new address', async () => {
      await service.editByAdmin(COURIER_ID, { email: 'nikos.new@coop.gr' }, ADMIN_ID)

      expect(mailService.send).toHaveBeenCalledTimes(1)
      const mail = mailService.send.mock.calls[0][0]
      expect(mail.to).toBe('nikos@coop.gr')
      expect(mail.to).not.toBe('nikos.new@coop.gr')
      expect(mail.text).toBe(
        'Your login email for Volos Riders Co-op was changed to nikos.new@coop.gr. If you did not expect this, contact the co-op.'
      )
      // Sent only once the change is saved.
      expect(order.indexOf('tx.user.update')).toBeLessThan(order.indexOf('mail.send'))
    })

    test('a changed email mails the notice in the rider user language (Greek when language is el)', async () => {
      prisma.user!.findUnique.mockResolvedValue({ id: USER_ID, language: 'el' })

      await service.editByAdmin(COURIER_ID, { email: 'nikos.new@coop.gr' }, ADMIN_ID)

      expect(mailService.send).toHaveBeenCalledTimes(1)
      const mail = mailService.send.mock.calls[0][0]
      expect(mail.text).toBe(
        'Το email σύνδεσής σας για Volos Riders Co-op άλλαξε σε nikos.new@coop.gr. Αν δεν το περιμένατε, επικοινωνήστε με τον συνεταιρισμό.'
      )
      expect(mail.subject).toBe('Το email σύνδεσής σας για Volos Riders Co-op άλλαξε')
    })

    test('with no co-op name stored, the notice says "the co-op"', async () => {
      configDomainService.instanceConfig.getDetails.mockResolvedValue({})

      await service.editByAdmin(COURIER_ID, { email: 'nikos.new@coop.gr' }, ADMIN_ID)

      expect(mailService.send.mock.calls[0][0].text).toBe(
        'Your login email for the co-op was changed to nikos.new@coop.gr. If you did not expect this, contact the co-op.'
      )
    })

    test('with mail off, the change is still saved and recorded, and no mail is tried', async () => {
      mailService.isConfigured.mockReturnValue(false)

      await service.editByAdmin(COURIER_ID, { email: 'nikos.new@coop.gr' }, ADMIN_ID)

      expect(tx.user.update).toHaveBeenCalledTimes(1)
      expect(recordedRows()).toHaveLength(1)
      expect(mailService.send).not.toHaveBeenCalled()
    })

    test('a mail that fails does not undo or fail the edit, and no address is logged', async () => {
      mailService.send.mockRejectedValue(new Error('SMTP refused nikos@coop.gr'))

      await expect(service.editByAdmin(COURIER_ID, { email: 'nikos.new@coop.gr' }, ADMIN_ID)).resolves.toBeInstanceOf(
        CourierEntity
      )
      expect(tx.user.update).toHaveBeenCalledTimes(1)
      expect(logged.join('\n')).not.toContain('nikos@coop.gr')
      expect(logged.join('\n')).not.toContain('nikos.new@coop.gr')
    })

    test('an edit that does not change the email mails nobody and ends no session', async () => {
      await service.editByAdmin(COURIER_ID, { firstName: 'Nikolaos' }, ADMIN_ID)

      expect(tx.user.update).not.toHaveBeenCalled()
      expect(mailService.send).not.toHaveBeenCalled()
      expect(cacheService.delete).not.toHaveBeenCalled()
    })
  })

  describe('editByAdmin: the status (spec 0040, spec 0002, cross check 7)', () => {
    test('goes first, through changeStatus with cause ADMIN and the admin id, then ends open offers, before the fields are saved', async () => {
      await service.editByAdmin(COURIER_ID, { status: EnumCourierStatus.OFFLINE, firstName: 'Nikolaos' }, ADMIN_ID)

      expect(courierDomainService.changeStatus).toHaveBeenCalledWith(
        COURIER_ID,
        EnumCourierStatus.OFFLINE,
        EnumCourierStatusChangeCause.ADMIN,
        ADMIN_ID
      )
      expect(deliveryEventService.handleCourierStatusChanged).toHaveBeenCalledWith(COURIER_ID, EnumCourierStatus.OFFLINE)
      expect(order.slice(0, 3)).toEqual(['changeStatus', 'handleCourierStatusChanged', 'tx.courier.update'])
      // The status is written only by changeStatus, never with the fields.
      expect(tx.courier.update.mock.calls[0][0].data).not.toHaveProperty('status')
    })

    test('with no status in the edit, the status is not touched', async () => {
      await service.editByAdmin(COURIER_ID, { firstName: 'Nikolaos' }, ADMIN_ID)

      expect(courierDomainService.changeStatus).not.toHaveBeenCalled()
      expect(deliveryEventService.handleCourierStatusChanged).not.toHaveBeenCalled()
    })

    test.each([EnumCourierStatus.ONLINE, EnumCourierStatus.LAST_CALL])(
      'a deactivated rider cannot be set %s: 409 with the sentence, and nothing is changed',
      async (status) => {
        prisma.courier.findUnique.mockResolvedValue(storedRow({ deactivatedAt: new Date('2026-11-21T09:00:00Z') }))

        const call = service.editByAdmin(COURIER_ID, { status, firstName: 'Nikolaos' }, ADMIN_ID)
        await expect(call).rejects.toBeInstanceOf(ConflictException)
        await expect(call).rejects.toMatchObject({ status: 409, message: "This rider's account is deactivated." })

        expect(courierDomainService.changeStatus).not.toHaveBeenCalled()
        expect(deliveryEventService.handleCourierStatusChanged).not.toHaveBeenCalled()
        expect(prisma.$transaction).not.toHaveBeenCalled()
        expect(accounts.record).not.toHaveBeenCalled()
      }
    )

    test('a deactivated rider can still be set Offline, and their details can still be edited', async () => {
      prisma.courier.findUnique.mockResolvedValue(storedRow({ deactivatedAt: new Date('2026-11-21T09:00:00Z') }))

      await service.editByAdmin(COURIER_ID, { status: EnumCourierStatus.OFFLINE, lastName: 'Papadopoulos' }, ADMIN_ID)

      expect(courierDomainService.changeStatus).toHaveBeenCalledWith(
        COURIER_ID,
        EnumCourierStatus.OFFLINE,
        EnumCourierStatusChangeCause.ADMIN,
        ADMIN_ID
      )
      expect(recordedRows().map((row) => row.field)).toEqual(['lastName'])
    })

    test('an active rider can be set Online', async () => {
      await service.editByAdmin(COURIER_ID, { status: EnumCourierStatus.ONLINE }, ADMIN_ID)

      expect(courierDomainService.changeStatus).toHaveBeenCalledWith(
        COURIER_ID,
        EnumCourierStatus.ONLINE,
        EnumCourierStatusChangeCause.ADMIN,
        ADMIN_ID
      )
    })
  })

  describe('changeOwnPassword (AC-8, cross check 13)', () => {
    const rider = courierEntity({ status: EnumCourierStatus.ONLINE })
    const TRIES_KEY = `password-change-tries:${USER_ID}`

    const expectNoPasswordWritten = () => {
      expect(passwordService.hash).not.toHaveBeenCalled()
      expect(prisma.$transaction).not.toHaveBeenCalled()
      expect(tx.user.update).not.toHaveBeenCalled()
      expect(userDomainService.update).not.toHaveBeenCalled()
      expect(accounts.record).not.toHaveBeenCalled()
      expect(authDomainService.createSessionForUser).not.toHaveBeenCalled()
      expect(courierDeviceRepository.deleteByTokens).not.toHaveBeenCalled()
    }

    test('a wrong current password answers 400 with the sentence, is counted for an hour, and changes nothing', async () => {
      const call = service.changeOwnPassword(rider, { currentPassword: 'not-it', newPassword: 'a-new-password' })
      await expect(call).rejects.toBeInstanceOf(BadRequestException)
      await expect(call).rejects.toMatchObject({ status: 400, message: 'Your current password is not right.' })

      expect(cacheService.increment).toHaveBeenCalledTimes(1)
      expect(cacheService.increment).toHaveBeenCalledWith(TRIES_KEY, 3600)
      expectNoPasswordWritten()
    })

    test('the count is per rider', async () => {
      userDomainService.findById.mockResolvedValue(storedUser({ id: 'user-other' }))

      await expect(
        service.changeOwnPassword(rider, { currentPassword: 'not-it', newPassword: 'a-new-password' })
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(cacheService.increment).toHaveBeenCalledWith('password-change-tries:user-other', 3600)
    })

    test('after 5 wrong tries in the hour: 400 "Too many wrong passwords", even with the right current password, and nothing is compared', async () => {
      cacheService.get.mockResolvedValue(5)

      const call = service.changeOwnPassword(rider, { currentPassword: 'current-password', newPassword: 'a-new-password' })
      await expect(call).rejects.toBeInstanceOf(BadRequestException)
      await expect(call).rejects.toMatchObject({ status: 400, message: 'Too many wrong passwords. Try again in an hour.' })

      expect(cacheService.get).toHaveBeenCalledWith(TRIES_KEY)
      expect(passwordService.compare).not.toHaveBeenCalled()
      expectNoPasswordWritten()
    })

    test('with 4 wrong tries so far, the fifth try is still heard: the right password changes it', async () => {
      cacheService.get.mockResolvedValue(4)

      await expect(
        service.changeOwnPassword(rider, { currentPassword: 'current-password', newPassword: 'a-new-password' })
      ).resolves.toBeDefined()
      expect(tx.user.update).toHaveBeenCalledTimes(1)
    })

    test('a new password equal to the current one answers 400 with the sentence, is not counted as a wrong try, and changes nothing', async () => {
      const call = service.changeOwnPassword(rider, {
        currentPassword: 'current-password',
        newPassword: 'current-password',
      })
      await expect(call).rejects.toBeInstanceOf(BadRequestException)
      await expect(call).rejects.toMatchObject({
        status: 400,
        message: 'Your new password must be different from the current one.',
      })

      expect(cacheService.increment).not.toHaveBeenCalled()
      expectNoPasswordWritten()
    })

    test('a rider whose password was cleared (after a reactivation) cannot use this door: 400, nothing changed', async () => {
      userDomainService.findById.mockResolvedValue(storedUser({ password: null }))

      const call = service.changeOwnPassword(rider, { currentPassword: '', newPassword: 'a-new-password' })
      await expect(call).rejects.toBeInstanceOf(BadRequestException)
      expectNoPasswordWritten()
    })

    test('success: stores the hash of the new password and sets credentialsChangedAt, in one transaction with the record', async () => {
      const before = Date.now()
      await service.changeOwnPassword(rider, { currentPassword: 'current-password', newPassword: 'a-new-password' })

      expect(passwordService.hash).toHaveBeenCalledWith('a-new-password')
      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(tx.user.update).toHaveBeenCalledTimes(1)
      const update = tx.user.update.mock.calls[0][0]
      expect(update.where).toEqual({ id: USER_ID })
      expect(update.data.password).toBe('hash-of-new')
      expect(update.data.credentialsChangedAt).toBeInstanceOf(Date)
      expect(update.data.credentialsChangedAt.getTime()).toBeGreaterThanOrEqual(before)
      expect(accounts.record.mock.calls[0][1]).toBe(tx)
    })

    test('success: records PASSWORD_CHANGED by the rider, with no admin and no password in the row (AC-5)', async () => {
      await service.changeOwnPassword(rider, { currentPassword: 'current-password', newPassword: 'a-new-password' })

      const rows = recordedRows()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        courierId: COURIER_ID,
        actorUserId: null,
        actorIsRider: true,
        kind: EnumCourierAccountChangeKind.PASSWORD_CHANGED,
      })
      const written = JSON.stringify(rows)
      expect(written).not.toContain('a-new-password')
      expect(written).not.toContain('current-password')
      expect(written).not.toContain('hash-of-new')
      expect(written).not.toContain('hash-of-current')
    })

    test("success: the other phones' devices are removed and this phone's (the pushToken's) is kept", async () => {
      await service.changeOwnPassword(rider, {
        currentPassword: 'current-password',
        newPassword: 'a-new-password',
        pushToken: 'token-this-phone',
      })

      expect(courierDeviceRepository.findTokensForCourier).toHaveBeenCalledWith(COURIER_ID)
      expect(courierDeviceRepository.deleteByTokens).toHaveBeenCalledTimes(1)
      const removed = courierDeviceRepository.deleteByTokens.mock.calls[0][0] as string[]
      expect([...removed].sort()).toEqual(['token-old-phone', 'token-tablet'])
      expect(removed).not.toContain('token-this-phone')
      expect(courierDeviceRepository.deleteAllForCourier).not.toHaveBeenCalled()
    })

    test('success with no pushToken sent: every stored device is another phone and is removed', async () => {
      await service.changeOwnPassword(rider, { currentPassword: 'current-password', newPassword: 'a-new-password' })

      const removed = courierDeviceRepository.deleteByTokens.mock.calls[0][0] as string[]
      expect([...removed].sort()).toEqual(['token-old-phone', 'token-tablet', 'token-this-phone'])
    })

    test('success: the rider is not set Offline and is not cut off', async () => {
      await service.changeOwnPassword(rider, {
        currentPassword: 'current-password',
        newPassword: 'a-new-password',
        pushToken: 'token-this-phone',
      })

      expect(courierCutOffService.cutOff).not.toHaveBeenCalled()
      expect(courierDomainService.changeStatus).not.toHaveBeenCalled()
      expect(deliveryEventService.handleCourierStatusChanged).not.toHaveBeenCalled()
    })

    test('success: returns a fresh session for this phone, made after the password was saved', async () => {
      const reloaded = storedUser({ password: 'hash-of-new' })
      userDomainService.findById.mockResolvedValueOnce(storedUser()).mockResolvedValue(reloaded)
      authDomainService.createSessionForUser.mockImplementation(async (user: unknown) => {
        order.push('createSessionForUser')
        return { user, session: { accessToken: 'fresh-access', refreshToken: 'fresh-refresh' } }
      })

      const result = await service.changeOwnPassword(rider, {
        currentPassword: 'current-password',
        newPassword: 'a-new-password',
      })

      expect(result).toEqual({ user: reloaded, session: { accessToken: 'fresh-access', refreshToken: 'fresh-refresh' } })
      expect(authDomainService.createSessionForUser).toHaveBeenCalledTimes(1)
      expect(order.indexOf('tx.user.update')).toBeGreaterThanOrEqual(0)
      expect(order.indexOf('tx.user.update')).toBeLessThan(order.indexOf('createSessionForUser'))
    })

    test('success: the count of wrong tries is cleared', async () => {
      await service.changeOwnPassword(rider, { currentPassword: 'current-password', newPassword: 'a-new-password' })
      expect(cacheService.delete).toHaveBeenCalledWith(TRIES_KEY)
    })

    test('success even when the other devices cannot be removed: the password is saved and the session returned', async () => {
      courierDeviceRepository.findTokensForCourier.mockRejectedValue(new Error('db down'))
      websocketDispatcher.disconnectUser.mockRejectedValue(new Error('socket down'))

      const result = await service.changeOwnPassword(rider, {
        currentPassword: 'current-password',
        newPassword: 'a-new-password',
      })

      expect(result.session).toEqual({ accessToken: 'fresh-access', refreshToken: 'fresh-refresh' })
      expect(tx.user.update).toHaveBeenCalledTimes(1)
    })

    test('no password, old or new, reaches a log line', async () => {
      await service.changeOwnPassword(rider, { currentPassword: 'current-password', newPassword: 'a-new-password' })
      await service
        .changeOwnPassword(rider, { currentPassword: 'wrong-guess-1', newPassword: 'a-new-password' })
        .catch(() => undefined)

      const all = logged.join('\n')
      expect(all).not.toContain('current-password')
      expect(all).not.toContain('a-new-password')
      expect(all).not.toContain('wrong-guess-1')
    })
  })

  describe('recordPasswordChange (AC-5, cross check 10)', () => {
    test("an admin's set password is recorded as PASSWORD_CHANGED by that admin", async () => {
      await service.recordPasswordChange(COURIER_ID, { adminUserId: ADMIN_ID })

      expect(recordedRows()).toEqual([
        expect.objectContaining({
          courierId: COURIER_ID,
          actorUserId: ADMIN_ID,
          actorIsRider: false,
          kind: EnumCourierAccountChangeKind.PASSWORD_CHANGED,
        }),
      ])
    })

    test("a rider's own change is recorded as PASSWORD_CHANGED by the rider, with no admin", async () => {
      await service.recordPasswordChange(COURIER_ID, 'rider')

      expect(recordedRows()).toEqual([
        expect.objectContaining({
          courierId: COURIER_ID,
          actorUserId: null,
          actorIsRider: true,
          kind: EnumCourierAccountChangeKind.PASSWORD_CHANGED,
        }),
      ])
    })

    // Row 108 review (ruling: "The set password route can answer 500 after doing everything"): the password
    // is already saved when the row is written, so a failed write is logged and never thrown.
    test.each<[string, { adminUserId: string } | 'rider']>([
      ["an admin's set password", { adminUserId: ADMIN_ID }],
      ["a rider's own change", 'rider'],
    ])('%s: a record that cannot be written is logged, never thrown', async (_name, actor) => {
      accounts.record.mockRejectedValue(new Error('database down'))

      await expect(service.recordPasswordChange(COURIER_ID, actor)).resolves.toBeUndefined()

      expect(accounts.record).toHaveBeenCalledTimes(1)
      const errorLines = ((service as any).logger.error as jest.Mock).mock.calls
      expect(errorLines).toHaveLength(1)
      expect(String(errorLines[0][0])).toContain(COURIER_ID)
    })

    test('a record that throws at once (not a rejected promise) is not thrown either', async () => {
      accounts.record.mockImplementation(() => {
        throw new Error('no connection')
      })

      await expect(service.recordPasswordChange(COURIER_ID, 'rider')).resolves.toBeUndefined()
    })

    test('a record that is written logs no error', async () => {
      await service.recordPasswordChange(COURIER_ID, { adminUserId: ADMIN_ID })

      expect((service as any).logger.error as jest.Mock).not.toHaveBeenCalled()
    })
  })

  describe('history (AC-5, AC-6, AC-7)', () => {
    test("answers this rider's record as the repository lists it (newest first)", async () => {
      const rows = [{ id: 'change-2' }, { id: 'change-1' }]
      accounts.listFor.mockResolvedValue(rows)

      await expect(service.history(COURIER_ID)).resolves.toBe(rows)
      expect(accounts.listFor).toHaveBeenCalledWith(COURIER_ID)
    })
  })

  describe("the rider's own emergency contact (cross checks 10 and 12)", () => {
    test('is saved on the server, trimmed', async () => {
      await service.setOwnEmergencyContact(COURIER_ID, '  Maria Rider ', ' +306922222222 ')

      expect(prisma.courier.update).toHaveBeenCalledWith({
        where: { id: COURIER_ID },
        data: { emergencyContactName: 'Maria Rider', emergencyContactPhone: '+306922222222' },
      })
    })

    test('an empty or missing part is stored as null', async () => {
      await service.setOwnEmergencyContact(COURIER_ID, '   ', null)

      expect(prisma.courier.update).toHaveBeenCalledWith({
        where: { id: COURIER_ID },
        data: { emergencyContactName: null, emergencyContactPhone: null },
      })
    })

    test("is not recorded as an account change (it is the rider's own)", async () => {
      await service.setOwnEmergencyContact(COURIER_ID, 'Maria Rider', '+306922222222')
      expect(accounts.record).not.toHaveBeenCalled()
    })

    test('is read back as name and phone; a rider with none reads nulls', async () => {
      prisma.courier.findUnique.mockResolvedValueOnce({
        emergencyContactName: 'Maria Rider',
        emergencyContactPhone: '+306922222222',
      })
      await expect(service.emergencyContactOf(COURIER_ID)).resolves.toEqual({
        name: 'Maria Rider',
        phone: '+306922222222',
      })

      prisma.courier.findUnique.mockResolvedValueOnce({ emergencyContactName: null, emergencyContactPhone: null })
      await expect(service.emergencyContactOf(COURIER_ID)).resolves.toEqual({ name: null, phone: null })
    })
  })
})
