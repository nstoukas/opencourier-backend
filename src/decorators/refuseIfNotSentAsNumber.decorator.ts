import { BadRequestException } from '@nestjs/common'
import { Transform } from 'class-transformer'

/**
 * Refuses a number setting that did not arrive as a real JSON number.
 *
 * Why it exists: the global ValidationPipe (`main.ts`) uses `enableImplicitConversion`, which
 * runs `Number(value)` on every field typed `number` before any check sees it. `Number('')` is 0
 * (so are `Number('  ')`, `Number(false)` and `Number([])`), so an empty box would be saved as a
 * real 0, and a base fee of 0 pays riders cents on short trips. `@IsNumber()` cannot catch it,
 * because by the time it runs the value already is 0.
 *
 * `obj` is the request body as it was sent, before any conversion, so `obj[key]` is the value
 * the caller actually sent. Leaving the field out (undefined) or sending null is not handled here:
 * `@IsOptional()` lets those through and the domain service's numeric rules deal with them.
 */
export function RefuseIfNotSentAsNumber(): PropertyDecorator {
  // @Transform = a class-transformer hook that runs on one field while the body becomes the DTO class.
  return Transform(({ value, obj, key }) => {
    const sent: unknown = obj[key]
    if (sent === undefined || sent === null) {
      return value
    }
    if (typeof sent === 'string' && sent.trim() === '') {
      throw new BadRequestException(`${key} cannot be empty`)
    }
    if (typeof sent !== 'number') {
      throw new BadRequestException(`${key} must be sent as a number`)
    }
    return value
  })
}
