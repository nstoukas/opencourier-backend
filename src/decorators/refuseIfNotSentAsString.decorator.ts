import { BadRequestException } from '@nestjs/common'
import { Transform } from 'class-transformer'

/**
 * Refuses a text setting that did not arrive as a real JSON string.
 *
 * The text sibling of `@RefuseIfNotSentAsNumber()`: the global ValidationPipe's
 * `enableImplicitConversion` runs `String(value)` on every field typed `string`, so a phone number
 * sent as the JSON number 302421012345 would save as "302421012345" with its leading + lost, and
 * `@IsString()` cannot tell, because by then it already is a string (row 72).
 *
 * `obj[key]` is the value as it was sent. Leaving the field out (undefined) means "don't change
 * it" and passes; null is refused, since an empty text ("") is how the setting is cleared.
 * `allowNull` lets null through as null, for a field where null means "none" (a chat message's
 * delivery tag, spec 0034).
 * `message` replaces the default refusal, for a field whose refusal is a fixed sentence the reader
 * sees (a reset code sent as a JSON number, row 17, spec 0039 AC-11).
 */
export function RefuseIfNotSentAsString(options: { allowNull?: boolean; message?: string } = {}): PropertyDecorator {
  return Transform(({ value, obj, key }) => {
    const sent: unknown = obj[key]
    if (sent === undefined) {
      return value
    }
    if (sent === null && options.allowNull) {
      return null
    }
    if (typeof sent !== 'string') {
      throw new BadRequestException(options.message ?? `${key} must be sent as text`)
    }
    return sent
  })
}
