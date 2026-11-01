import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CourierRotatePasswordAdminInput } from './courier-rotate-password.admin.input'

describe('CourierRotatePasswordAdminInput (Spec 0013 AC-4: password length)', () => {
  test('accepts password with 8 to 72 characters inclusive', async () => {
    const input8 = plainToInstance(CourierRotatePasswordAdminInput, {
      password: 'p'.repeat(8),
    })
    expect(await validate(input8)).toHaveLength(0)

    const input72 = plainToInstance(CourierRotatePasswordAdminInput, {
      password: 'p'.repeat(72),
    })
    expect(await validate(input72)).toHaveLength(0)
  })

  test('rejects password shorter than 8 characters', async () => {
    const input7 = plainToInstance(CourierRotatePasswordAdminInput, {
      password: 'p'.repeat(7),
    })
    const errors = await validate(input7)
    expect(errors.some((e) => e.property === 'password')).toBe(true)
  })

  test('rejects password longer than 72 characters', async () => {
    const input73 = plainToInstance(CourierRotatePasswordAdminInput, {
      password: 'p'.repeat(73),
    })
    const errors = await validate(input73)
    expect(errors.some((e) => e.property === 'password')).toBe(true)
  })

  test('rejects non-string password', async () => {
    const inputNum = plainToInstance(CourierRotatePasswordAdminInput, {
      password: 12345678 as any,
    })
    const errors = await validate(inputNum)
    expect(errors.some((e) => e.property === 'password')).toBe(true)
  })
})
