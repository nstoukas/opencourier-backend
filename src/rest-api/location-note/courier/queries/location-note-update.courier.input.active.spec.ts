import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { LocationNoteUpdateCourierInput } from './location-note-update.courier.input'

describe('LocationNoteUpdateCourierInput through ValidationPipe (Row 82 review fix)', () => {
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  })

  const transform = (body: any) =>
    pipe.transform(body, { type: 'body', metatype: LocationNoteUpdateCourierInput })

  it('accepts valid input with non-blank note text', async () => {
    const result = (await transform({
      note: 'Updated: door fixed',
    })) as LocationNoteUpdateCourierInput

    expect(result).toBeInstanceOf(LocationNoteUpdateCourierInput)
    expect(result.note).toBe('Updated: door fixed')
    expect(result.confirmed).toBeUndefined()
  })

  it('accepts valid input with leading and trailing spaces as long as non-whitespace exists', async () => {
    const result = (await transform({
      note: '   Updated text   ',
    })) as LocationNoteUpdateCourierInput

    expect(result.note).toBe('   Updated text   ')
  })

  it('refuses blank note containing only spaces with 400 BadRequestException (@Matches(/\\S/))', async () => {
    await expect(
      transform({
        note: '   ',
      })
    ).rejects.toThrow(BadRequestException)
  })

  it('refuses blank note containing only tabs, newlines, and spaces with 400 BadRequestException', async () => {
    await expect(
      transform({
        note: '\t\n   \r\n',
      })
    ).rejects.toThrow(BadRequestException)
  })

  it('refuses empty string for note with 400 BadRequestException', async () => {
    await expect(
      transform({
        note: '',
      })
    ).rejects.toThrow(BadRequestException)
  })

  it('refuses note longer than 255 characters with 400 BadRequestException', async () => {
    const tooLong = 'b'.repeat(256)
    await expect(
      transform({
        note: tooLong,
      })
    ).rejects.toThrow(BadRequestException)
  })

  it('refuses confirmed sent as string (@RefuseIfNotSentAsBoolean)', async () => {
    await expect(
      transform({
        note: 'Updated text',
        confirmed: 'false',
      })
    ).rejects.toThrow(BadRequestException)
  })
})
