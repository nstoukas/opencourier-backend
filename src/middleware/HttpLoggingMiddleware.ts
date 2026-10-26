import { Injectable, NestMiddleware, Logger } from '@nestjs/common'

import { Request, Response, NextFunction } from 'express'

// Paths that carry a secret in the URL itself. Before a request line is logged, the matched
// segment is replaced by a placeholder, so the secret never reaches the log file. Add a route here
// when its URL holds something that must not be written down.
const SENSITIVE_PATH_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  // A rider's phone push token (spec 0003, DELETE /devices/:token): whoever holds it can register it
  // as their own phone and receive that rider's offer alerts.
  { pattern: /\/devices\/[^/?#]+/g, replacement: '/devices/:token' },
]

// Saved customers (spec 0005, AC-9): a search's query string is part of a customer's name or phone,
// so for any `/customers` path (partner and admin) the query string is not logged at all.
const QUERY_STRING_DROPPED_PATH = /\/customers(\/|\?|#|$)/

// Exported so it can be tested on its own, without a request.
export function redactSensitivePath(url: string): string {
  // `?? url`: split always returns at least one part, but TypeScript cannot know that.
  const path = url.split('?')[0] ?? url
  const logged = QUERY_STRING_DROPPED_PATH.test(path) ? path : url
  return SENSITIVE_PATH_PATTERNS.reduce(
    (redacted, { pattern, replacement }) => redacted.replace(pattern, replacement),
    logged
  )
}

@Injectable()
export class HttpLoggerMiddleware implements NestMiddleware {
  private logger = new Logger('HTTP')

  use(request: Request, response: Response, next: NextFunction): void {
    const { ip, method } = request
    const url = redactSensitivePath(request.originalUrl)
    const userAgent = request.get('user-agent') || ''

    response.on('close', () => {
      const { statusCode } = response
      const contentLength = response.get('content-length')

      this.logger.log(`${method} ${url} ${statusCode} ${contentLength || ''} - ${userAgent} ${ip}`)
    })

    next()
  }
}
