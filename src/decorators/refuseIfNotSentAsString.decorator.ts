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
 */
export function RefuseIfNotSentAsString(): PropertyDecorator {
  return Transform(({ value, obj, key }) => {
    const sent: unknown = obj[key]
    if (sent === undefined) {
      return value
    }
    if (typeof sent !== 'string') {
      throw new BadRequestException(`${key} must be sent as text`)
    }
    return sent
  })
}
