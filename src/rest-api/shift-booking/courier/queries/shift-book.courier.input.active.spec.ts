import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { ShiftBookCourierInput } from './shift-book.courier.input'

// Spec 0027: the book body { shiftSlotId, date }, through the global pipe with src/main.ts's options,
// so a value reaches the service as it does live.
describe('ShiftBookCourierInput (spec 0027)', () => {
  const pipe = new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } })
  const run = (body: unknown) => pipe.transform(body, { type: 'body', metatype: ShiftBookCourierInput })

  async function refused(body: unknown): Promise<unknown> {
    try {
      await run(body)
    } catch (error) {
      return error
    }
    return undefined
  }

  it('accepts a slot id and a YYYY-MM-DD date', async () => {
    const value = (await run({ shiftSlotId: 'slot-fri', date: '2026-11-06' })) as ShiftBookCourierInput
    expect(value).toBeInstanceOf(ShiftBookCourierInput)
    expect(value.shiftSlotId).toBe('slot-fri')
    expect(value.date).toBe('2026-11-06')
  })

  it.each([
    '2026-11-6',
    '06-11-2026',
    '2026/11/06',
    '2026-11-06T00:00:00Z',
    ' 2026-11-06',
    '2026-11-06 ',
    '20261106',
    '',
    'tomorrow',
  ])('refuses the date %p with 400', async (date) => {
    const error = await refused({ shiftSlotId: 'slot-fri', date })
    expect(error).toBeInstanceOf(BadRequestException)
  })

  it.each([
    ['a number date', { shiftSlotId: 'slot-fri', date: 20261106 }],
    ['a null date', { shiftSlotId: 'slot-fri', date: null }],
    ['a missing date', { shiftSlotId: 'slot-fri' }],
    ['a number slot id', { shiftSlotId: 42, date: '2026-11-06' }],
    ['a null slot id', { shiftSlotId: null, date: '2026-11-06' }],
    ['a missing slot id', { date: '2026-11-06' }],
    ['a boolean date', { shiftSlotId: 'slot-fri', date: true }],
  ])('refuses %s with 400', async (_case, body) => {
    expect(await refused(body)).toBeInstanceOf(BadRequestException)
  })
})
