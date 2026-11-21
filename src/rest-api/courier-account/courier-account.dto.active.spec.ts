import { EnumCourierAccountChangeKind } from '@prisma/types'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CourierUpdateAdminInput } from 'src/rest-api/courier/admin/queries/courier-update.admin.input'
import { AccountChangeWithActor } from 'src/persistence/repositories/courier-account.repository'
import {
  ChangePasswordCourierInput,
  CourierAccountChangeAdminDto,
  CourierAccountChangeCourierDto,
  CourierDeactivateAdminInput,
  CourierReactivateAdminInput,
  EmergencyContactCourierInput,
} from './courier-account.dto'

// Spec 0051 (row 108): the inputs and answers of rider account upkeep. Written from the spec's acceptance
// criteria and its cross check, not from the code.
describe('Rider account upkeep inputs and answers (spec 0051)', () => {
  // The fields a check failed on, as the server's ValidationPipe would see them.
  const refusedFields = async (cls: new () => object, body: unknown): Promise<string[]> => {
    const errors = await validate(plainToInstance(cls, body) as object)
    return errors.map((error) => error.property)
  }

  describe('CourierDeactivateAdminInput: a reason is required, 1 to 300 characters after trimming (cross check 1)', () => {
    test('accepts a reason and trims it', async () => {
      const input = plainToInstance(CourierDeactivateAdminInput, { reason: '  Left the co-op  ' })
      expect(await validate(input)).toHaveLength(0)
      expect(input.reason).toBe('Left the co-op')
    })

    test('accepts 1 character and 300 characters', async () => {
      expect(await refusedFields(CourierDeactivateAdminInput, { reason: 'x' })).toEqual([])
      expect(await refusedFields(CourierDeactivateAdminInput, { reason: 'x'.repeat(300) })).toEqual([])
    })

    test('refuses 301 characters', async () => {
      expect(await refusedFields(CourierDeactivateAdminInput, { reason: 'x'.repeat(301) })).toEqual(['reason'])
    })

    test.each([
      ['no reason at all', {}],
      ['an empty reason', { reason: '' }],
      ['a reason of spaces only', { reason: '     ' }],
      ['a null reason', { reason: null }],
      ['a number', { reason: 42 }],
    ])('refuses %s', async (_name, body) => {
      expect(await refusedFields(CourierDeactivateAdminInput, body)).toEqual(['reason'])
    })

    test('300 characters wrapped in spaces still pass: the limit counts what is kept', async () => {
      expect(await refusedFields(CourierDeactivateAdminInput, { reason: `  ${'x'.repeat(300)}  ` })).toEqual([])
    })
  })

  describe('CourierReactivateAdminInput: the reason is optional (cross check 9)', () => {
    test('accepts no reason, and a reason up to 300 characters', async () => {
      expect(await refusedFields(CourierReactivateAdminInput, {})).toEqual([])
      expect(await refusedFields(CourierReactivateAdminInput, { reason: 'Came back' })).toEqual([])
      expect(await refusedFields(CourierReactivateAdminInput, { reason: 'x'.repeat(300) })).toEqual([])
    })

    test('refuses 301 characters', async () => {
      expect(await refusedFields(CourierReactivateAdminInput, { reason: 'x'.repeat(301) })).toEqual(['reason'])
    })
  })

  describe('ChangePasswordCourierInput: the new password follows the existing rules, 8 to 72 characters (AC-8)', () => {
    const body = (newPassword: unknown) => ({ currentPassword: 'current-password', newPassword })

    test('accepts 8 and 72 characters', async () => {
      expect(await refusedFields(ChangePasswordCourierInput, body('12345678'))).toEqual([])
      expect(await refusedFields(ChangePasswordCourierInput, body('x'.repeat(72)))).toEqual([])
    })

    test('refuses 7 and 73 characters', async () => {
      expect(await refusedFields(ChangePasswordCourierInput, body('1234567'))).toEqual(['newPassword'])
      expect(await refusedFields(ChangePasswordCourierInput, body('x'.repeat(73)))).toEqual(['newPassword'])
    })

    test('refuses a missing current or new password', async () => {
      expect(await refusedFields(ChangePasswordCourierInput, { newPassword: 'a-new-password' })).toEqual([
        'currentPassword',
      ])
      expect(await refusedFields(ChangePasswordCourierInput, { currentPassword: 'current-password' })).toEqual([
        'newPassword',
      ])
    })

    test("takes this phone's push token, which is optional", async () => {
      expect(await refusedFields(ChangePasswordCourierInput, { ...body('a-new-password'), pushToken: 'token-1' })).toEqual([])
      expect(await refusedFields(ChangePasswordCourierInput, { ...body('a-new-password'), pushToken: 12 })).toEqual([
        'pushToken',
      ])
    })
  })

  describe('EmergencyContactCourierInput (cross check 12)', () => {
    test('either part may be empty or left out', async () => {
      expect(await refusedFields(EmergencyContactCourierInput, {})).toEqual([])
      expect(await refusedFields(EmergencyContactCourierInput, { name: null, phone: null })).toEqual([])
      expect(await refusedFields(EmergencyContactCourierInput, { name: 'Maria Rider', phone: '+306922222222' })).toEqual([])
    })

    test('a name is at most 120 characters and a phone at most 32', async () => {
      expect(await refusedFields(EmergencyContactCourierInput, { name: 'x'.repeat(120), phone: '1'.repeat(32) })).toEqual([])
      expect(await refusedFields(EmergencyContactCourierInput, { name: 'x'.repeat(121) })).toEqual(['name'])
      expect(await refusedFields(EmergencyContactCourierInput, { phone: '1'.repeat(33) })).toEqual(['phone'])
    })
  })

  describe('CourierUpdateAdminInput: the login email and the emergency contact (AC-4)', () => {
    // The PATCH has always asked for both names; the rest is optional.
    const names = { firstName: 'Nikos', lastName: 'Rider' }

    test('accepts an email and an emergency contact beside the fields it had', async () => {
      expect(
        await refusedFields(CourierUpdateAdminInput, {
          ...names,
          phoneNumber: '+306900000000',
          email: 'nikos@coop.gr',
          emergencyContactName: 'Maria Rider',
          emergencyContactPhone: '+306922222222',
        })
      ).toEqual([])
    })

    test('every new field is optional', async () => {
      expect(await refusedFields(CourierUpdateAdminInput, names)).toEqual([])
    })

    test('refuses an email that is not one', async () => {
      expect(await refusedFields(CourierUpdateAdminInput, { ...names, email: 'not-an-email' })).toEqual(['email'])
      expect(await refusedFields(CourierUpdateAdminInput, { ...names, email: 'nikos@' })).toEqual(['email'])
    })

    test('refuses an emergency contact name past 120 characters and a phone past 32', async () => {
      expect(await refusedFields(CourierUpdateAdminInput, { ...names, emergencyContactName: 'x'.repeat(120) })).toEqual([])
      expect(await refusedFields(CourierUpdateAdminInput, { ...names, emergencyContactName: 'x'.repeat(121) })).toEqual([
        'emergencyContactName',
      ])
      expect(await refusedFields(CourierUpdateAdminInput, { ...names, emergencyContactPhone: '1'.repeat(33) })).toEqual([
        'emergencyContactPhone',
      ])
    })
  })

  describe('what the record looks like to each reader (AC-5, AC-6, AC-7, cross check 10)', () => {
    const change = (overrides: Partial<AccountChangeWithActor> = {}): AccountChangeWithActor => ({
      id: 'change-1',
      courierId: 'courier-volos-1',
      actorUserId: 'admin-user-1',
      actorIsRider: false,
      kind: EnumCourierAccountChangeKind.FIELD_EDITED,
      field: 'phoneNumber',
      oldValue: '+306900000000',
      newValue: '+306911111111',
      reason: null,
      createdAt: new Date('2026-11-21T10:00:00Z'),
      actorEmail: 'anna.admin@coop.gr',
      ...overrides,
    })

    describe("the rider's own view", () => {
      test('an admin\'s action is by "the co-op"', () => {
        expect(new CourierAccountChangeCourierDto(change()).by).toBe('the co-op')
      })

      test('the rider\'s own action is by "you"', () => {
        const dto = new CourierAccountChangeCourierDto(
          change({
            actorUserId: null,
            actorIsRider: true,
            actorEmail: null,
            kind: EnumCourierAccountChangeKind.PASSWORD_CHANGED,
            field: null,
            oldValue: null,
            newValue: null,
          })
        )
        expect(dto.by).toBe('you')
        expect(dto.kind).toBe(EnumCourierAccountChangeKind.PASSWORD_CHANGED)
      })

      test.each(Object.values(EnumCourierAccountChangeKind))(
        'a %s row by an admin never carries the admin\'s email, id or any actor field',
        (kind) => {
          const dto = new CourierAccountChangeCourierDto(change({ kind, reason: 'A reason' }))

          const sent = JSON.stringify(dto)
          expect(sent).not.toContain('anna.admin@coop.gr')
          expect(sent).not.toContain('admin-user-1')
          expect(dto).not.toHaveProperty('actorEmail')
          expect(dto).not.toHaveProperty('actorUserId')
          expect(dto).not.toHaveProperty('actorIsRider')
          expect(dto.by).toBe('the co-op')
        }
      )

      test('carries what changed, when, the values in full and the reason', () => {
        const createdAt = new Date('2026-11-21T10:00:00Z')
        expect({ ...new CourierAccountChangeCourierDto(change({ createdAt })) }).toEqual({
          id: 'change-1',
          kind: EnumCourierAccountChangeKind.FIELD_EDITED,
          field: 'phoneNumber',
          oldValue: '+306900000000',
          newValue: '+306911111111',
          reason: null,
          by: 'the co-op',
          createdAt,
        })
        const deactivated = new CourierAccountChangeCourierDto(
          change({ kind: EnumCourierAccountChangeKind.DEACTIVATED, field: null, reason: 'Left the co-op' })
        )
        expect(deactivated.reason).toBe('Left the co-op')
      })
    })

    describe("an admin's view", () => {
      test("names the acting admin by email, and says when the rider acted", () => {
        const byAdmin = new CourierAccountChangeAdminDto(change())
        expect(byAdmin.actorEmail).toBe('anna.admin@coop.gr')
        expect(byAdmin.actorIsRider).toBe(false)

        const byRider = new CourierAccountChangeAdminDto(
          change({ actorUserId: null, actorIsRider: true, actorEmail: null })
        )
        expect(byRider.actorEmail).toBeNull()
        expect(byRider.actorIsRider).toBe(true)
      })

      test('carries the kind, the field, both values, the reason and the time', () => {
        const createdAt = new Date('2026-11-21T10:00:00Z')
        expect(new CourierAccountChangeAdminDto(change({ createdAt, reason: 'Typo' }))).toMatchObject({
          id: 'change-1',
          kind: EnumCourierAccountChangeKind.FIELD_EDITED,
          field: 'phoneNumber',
          oldValue: '+306900000000',
          newValue: '+306911111111',
          reason: 'Typo',
          createdAt,
        })
      })
    })

    test('the four kinds are DEACTIVATED, REACTIVATED, FIELD_EDITED and PASSWORD_CHANGED (AC-5)', () => {
      expect(Object.values(EnumCourierAccountChangeKind).sort()).toEqual(
        ['DEACTIVATED', 'FIELD_EDITED', 'PASSWORD_CHANGED', 'REACTIVATED'].sort()
      )
    })
  })
})
