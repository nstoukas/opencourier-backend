import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { LocationNoteCreateCourierInput } from './location-note-create.courier.input'

describe('LocationNoteCreateCourierInput through ValidationPipe (Row 82 review fix)', () => {
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  })

  const transform = (body: any) =>
    pipe.transform(body, { type: 'body', metatype: LocationNoteCreateCourierInput })

  it('accepts valid input with non-blank note text', async () => {
    const result = (await transform({
      deliveryId: 'del-101',
      stop: 'DROPOFF',
      note: 'Doorbell 3B broken, knock twice',
    })) as LocationNoteCreateCourierInput

    expect(result).toBeInstanceOf(LocationNoteCreateCourierInput)
    expect(result.note).toBe('Doorbell 3B broken, knock twice')
    expect(result.deliveryId).toBe('del-101')
    expect(result.stop).toBe('DROPOFF')
    expect(result.confirmed).toBeUndefined()
  })

  it('accepts valid input with leading and trailing spaces as long as non-whitespace exists', async () => {
    const result = (await transform({
      deliveryId: 'del-101',
      stop: 'PICKUP',
      note: '   Rear kitchen door   ',
    })) as LocationNoteCreateCourierInput

    expect(result.note).toBe('   Rear kitchen door   ')
  })

  it('refuses blank note containing only spaces with 400 BadRequestException (@Matches(/\\S/))', async () => {
    await expect(
      transform({
        deliveryId: 'del-101',
        stop: 'DROPOFF',
        note: '   ',
      })
    ).rejects.toThrow(BadRequestException)
  })

  it('refuses blank note containing only tabs, newlines, and spaces with 400 BadRequestException', async () => {
    await expect(
      transform({
        deliveryId: 'del-101',
        stop: 'DROPOFF',
        note: '\t\n   \r\n',
      })
    ).rejects.toThrow(BadRequestException)
  })

  it('refuses empty string for note with 400 BadRequestException', async () => {
    await expect(
      transform({
        deliveryId: 'del-101',
        stop: 'DROPOFF',
        note: '',
      })
    ).rejects.toThrow(BadRequestException)
  })

  it('refuses note longer than 255 characters with 400 BadRequestException', async () => {
    const tooLong = 'a'.repeat(256)
    await expect(
      transform({
        deliveryId: 'del-101',
        stop: 'DROPOFF',
        note: tooLong,
      })
    ).rejects.toThrow(BadRequestException)
  })

  it('refuses invalid stop value with 400 BadRequestException', async () => {
    await expect(
      transform({
        deliveryId: 'del-101',
        stop: 'INVALID_STOP',
        note: 'Doorbell broken',
      })
    ).rejects.toThrow(BadRequestException)
  })

  it('refuses confirmed sent as string "false" or "true" (@RefuseIfNotSentAsBoolean)', async () => {
    await expect(
      transform({
        deliveryId: 'del-101',
        stop: 'DROPOFF',
        note: 'Doorbell broken',
        confirmed: 'true',
      })
    ).rejects.toThrow(BadRequestException)
  })
})
