import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { ShiftSlotCreateAdminInput, ShiftSlotUpdateAdminInput } from './shift-slot.admin.input'

// Spec 0026, AC-1 and AC-4: what the admin shift slot routes refuse before the service sees a value.
// The pipe is built with the exact options of src/main.ts, so implicit conversion runs as it does live.
describe('Shift slot admin inputs (spec 0026, AC-4)', () => {
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
  })

  const createBody = (body: Record<string, unknown>) =>
    pipe.transform(body, { type: 'body', metatype: ShiftSlotCreateAdminInput })
  const updateBody = (body: Record<string, unknown>) =>
    pipe.transform(body, { type: 'body', metatype: ShiftSlotUpdateAdminInput })

  // Collects the sentences a refusal carries, whichever way it was raised (a decorator's own
  // BadRequestException message, or the pipe's list of class-validator messages).
  async function refusal(promise: Promise<unknown>): Promise<string> {
    try {
      await promise
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException)
      const response = (error as BadRequestException).getResponse() as { message: string | string[] }
      return Array.isArray(response.message) ? response.message.join(' | ') : String(response.message)
    }
    throw new Error('expected the input to be refused, but it passed')
  }

  const valid = { weekday: 5, startMinute: 1140, endMinute: 1380, riderCap: 6 }

  const DAY = 'The day must be a whole number from 1 (Monday) to 7 (Sunday).'
  const START = 'The start must be a whole minute from 00:00 to 23:59.'
  const END = 'The end must be a whole minute from 00:01 to 24:00.'
  const CAP = 'The rider cap must be a whole number from 1 to 50.'

  describe('ShiftSlotCreateAdminInput', () => {
    it('passes a valid slot through as real numbers', async () => {
      const result = (await createBody(valid)) as ShiftSlotCreateAdminInput
      expect(result).toBeInstanceOf(ShiftSlotCreateAdminInput)
      expect(result).toMatchObject(valid)
    })

    it('accepts the bounds: weekday 1 and 7, start 0 and 1439, end 1 and 1440, cap 1 and 50', async () => {
      for (const body of [
        { weekday: 1, startMinute: 0, endMinute: 1, riderCap: 1 },
        { weekday: 7, startMinute: 1439, endMinute: 1440, riderCap: 50 },
      ]) {
        await expect(createBody(body)).resolves.toMatchObject(body)
      }
    })

    it.each([
      ['weekday 0', { weekday: 0 }, DAY],
      ['weekday 8', { weekday: 8 }, DAY],
      ['a fractional weekday', { weekday: 2.5 }, DAY],
      ['a negative start', { startMinute: -1 }, START],
      ['a start of 1440 (24:00 is an end only)', { startMinute: 1440 }, START],
      ['a fractional start (not a whole minute)', { startMinute: 600.5 }, START],
      ['an end of 0', { endMinute: 0 }, END],
      ['an end of 1441', { endMinute: 1441 }, END],
      ['a fractional end', { endMinute: 1200.25 }, END],
      ['a cap of 0', { riderCap: 0 }, CAP],
      ['a cap of 51', { riderCap: 51 }, CAP],
      ['a fractional cap', { riderCap: 3.5 }, CAP],
    ])('refuses %s with its plain sentence', async (_label, change, sentence) => {
      expect(await refusal(createBody({ ...valid, ...change }))).toContain(sentence)
    })

    it.each(['weekday', 'startMinute', 'endMinute', 'riderCap'])(
      'refuses %s sent as text ("5") instead of converting it',
      async (key) => {
        expect(await refusal(createBody({ ...valid, [key]: '5' }))).toContain(`${key} must be sent as a number`)
      }
    )

    it.each(['weekday', 'startMinute', 'endMinute', 'riderCap'])(
      'refuses %s sent as an empty text ("") instead of saving 0',
      async (key) => {
        expect(await refusal(createBody({ ...valid, [key]: '' }))).toContain(`${key} cannot be empty`)
      }
    )

    it.each(['weekday', 'startMinute', 'endMinute', 'riderCap'])(
      'refuses %s sent as a boolean (true and false)',
      async (key) => {
        for (const bool of [true, false]) {
          expect(await refusal(createBody({ ...valid, [key]: bool }))).toContain(`${key} must be sent as a number`)
        }
      }
    )

    it.each(['weekday', 'startMinute', 'endMinute', 'riderCap'])('refuses a slot with %s left out', async (key) => {
      const body: Record<string, unknown> = { ...valid }
      delete body[key]
      await expect(createBody(body)).rejects.toBeInstanceOf(BadRequestException)
    })

    it.each(['weekday', 'startMinute', 'endMinute', 'riderCap'])('refuses %s sent as null', async (key) => {
      await expect(createBody({ ...valid, [key]: null })).rejects.toBeInstanceOf(BadRequestException)
    })
  })

  describe('ShiftSlotUpdateAdminInput', () => {
    it('passes an empty edit ({}) with every field left out', async () => {
      const result = (await updateBody({})) as ShiftSlotUpdateAdminInput
      expect(result.weekday).toBeUndefined()
      expect(result.startMinute).toBeUndefined()
      expect(result.endMinute).toBeUndefined()
      expect(result.riderCap).toBeUndefined()
    })

    it('passes one field alone (the rest stay undefined, for the service to merge)', async () => {
      const result = (await updateBody({ endMinute: 1440 })) as ShiftSlotUpdateAdminInput
      expect(result.endMinute).toBe(1440)
      expect(result.startMinute).toBeUndefined()
    })

    it.each([
      ['weekday 0', { weekday: 0 }, DAY],
      ['weekday 8', { weekday: 8 }, DAY],
      ['a fractional weekday', { weekday: 1.5 }, DAY],
      ['a start of 1440', { startMinute: 1440 }, START],
      ['a fractional start', { startMinute: 0.5 }, START],
      ['an end of 0', { endMinute: 0 }, END],
      ['an end of 1441', { endMinute: 1441 }, END],
      ['a cap of 0', { riderCap: 0 }, CAP],
      ['a cap of 51', { riderCap: 51 }, CAP],
    ])('refuses %s on an edit too', async (_label, body, sentence) => {
      expect(await refusal(updateBody(body))).toContain(sentence)
    })

    it.each([
      ['weekday', DAY],
      ['startMinute', START],
      ['endMinute', END],
      ['riderCap', CAP],
    ])('refuses %s sent as null on an edit (null is not "leave it")', async (key, sentence) => {
      expect(await refusal(updateBody({ [key]: null }))).toContain(sentence)
    })

    it.each(['weekday', 'startMinute', 'endMinute', 'riderCap'])('refuses %s sent as text or a boolean on an edit', async (key) => {
      for (const bad of ['12', true, false]) {
        expect(await refusal(updateBody({ [key]: bad }))).toContain(`${key} must be sent as a number`)
      }
    })
  })
})
