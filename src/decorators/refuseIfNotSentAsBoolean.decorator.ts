import { BadRequestException } from '@nestjs/common'
import { Transform } from 'class-transformer'

/**
 * Refuses an on/off setting that did not arrive as a real JSON `true` or `false`.
 *
 * The boolean sibling of `@RefuseIfNotSentAsNumber()`, and needed for the same reason: the global
 * ValidationPipe (`main.ts`) uses `enableImplicitConversion`, which runs `Boolean(value)` on every
 * field typed `boolean` before any check sees it. `Boolean("false")` is `true` (any non-empty
 * string is), so a switch sent as the text "false" would turn the feature ON. `@IsBoolean()`
 * cannot catch it, because by the time it runs the value already is `true`.
 *
 * `obj` is the request body as it was sent, before any conversion, so `obj[key]` is the value the
 * caller actually sent. Leaving the field out (undefined) means "don't change it" and passes.
 * Unlike the number guard, null is refused here too: an on/off switch has no empty state.
 */
export function RefuseIfNotSentAsBoolean(): PropertyDecorator {
  // @Transform = a class-transformer hook that runs on one field while the body becomes the DTO class.
  return Transform(({ value, obj, key }) => {
    const sent: unknown = obj[key]
    if (sent === undefined) {
      return value
    }
    if (typeof sent !== 'boolean') {
      throw new BadRequestException(`${key} must be sent as true or false`)
    }
    return sent
  })
}
