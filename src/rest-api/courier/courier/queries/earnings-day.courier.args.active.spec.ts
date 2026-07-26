import { validate } from 'class-validator'
import { EarningsDayCourierArgs } from './earnings-day.courier.args'

describe('EarningsDayCourierArgs', () => {
  test('missing date reports "date is required"', async () => {
    const args = new EarningsDayCourierArgs()
    const errors = await validate(args)
    const dateError = errors.find((e) => e.property === 'date')
    expect(dateError?.constraints?.matches).toBe('date is required')
  })

  test('malformed date still reports the format message', async () => {
    const args = new EarningsDayCourierArgs()
    args.date = '26-07-2026'
    const errors = await validate(args)
    const dateError = errors.find((e) => e.property === 'date')
    expect(dateError?.constraints?.matches).toBe('date must be YYYY-MM-DD')
  })

  test('valid date produces no date errors', async () => {
    const args = new EarningsDayCourierArgs()
    args.date = '2026-07-26'
    const errors = await validate(args)
    expect(errors.filter((e) => e.property === 'date')).toEqual([])
  })
})
