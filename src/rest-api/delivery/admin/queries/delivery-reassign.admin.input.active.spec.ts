import { validate } from 'class-validator'
import { DeliveryReassignAdminInput } from './delivery-reassign.admin.input'

describe('DeliveryReassignAdminInput', () => {
  test('rejects empty courierId', async () => {
    const input = new DeliveryReassignAdminInput()
    input.courierId = ''
    const errors = await validate(input)
    const courierIdError = errors.find((e) => e.property === 'courierId')
    expect(courierIdError?.constraints?.isNotEmpty).toBeDefined()
  })

  test('accepts valid courierId', async () => {
    const input = new DeliveryReassignAdminInput()
    input.courierId = 'courier-123'
    const errors = await validate(input)
    expect(errors.filter((e) => e.property === 'courierId')).toEqual([])
  })
})
