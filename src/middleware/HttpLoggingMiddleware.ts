import { Injectable, NestMiddleware, Logger } from '@nestjs/common'

import { Request, Response, NextFunction } from 'express'
import { queryHasApiKey } from 'src/domains/auth/api-key'

// Paths that carry a secret in the URL itself. Before a request line is logged, the matched
// segment is replaced by a placeholder, so the secret never reaches the log file. Add a route here
// when its URL holds something that must not be written down.
const SENSITIVE_PATH_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  // A rider's phone push token (spec 0003, DELETE /devices/:token): whoever holds it can register it
  // as their own phone and receive that rider's offer alerts.
  { pattern: /\/devices\/[^/?#]+/g, replacement: '/devices/:token' },
  // A search's text on any route (row 96: the admin deliveries list searches by customer name).
  // What someone typed into a search box can be a person's name, so its value is never logged.
  { pattern: /([?&]search=)[^&#]*/g, replacement: '$1[redacted]' },
]

// Paths whose query string is never logged at all, only the path.
const QUERY_STRING_DROPPED_PATHS: RegExp[] = [
  // Saved customers (spec 0005, AC-9): a search's query string is part of a customer's name or phone,
  // so for any `/customers` path (partner and admin) the query string is not logged.
  /\/customers(\/|\?|#|$)/,
  // Chat (spec 0034, AC-6): `?after=<message id>` says up to which message a rider's or restaurant's
  // device already had, at a logged time, which would be a read receipt. Dropped for all three
  // audiences: `/chat/messages` (courier, partner) and `/chat/threads/:id/messages` (admin). A bare
  // `GET .../chat/messages` line per fetch remains, as for every other request.
  /\/chat\/(threads\/[^/?#]+\/)?messages(\/|\?|#|$)/,
]

// Exported so it can be tested on its own, without a request. `dropQueryString` is true when the
// request's parsed query carries an API key (spec 0037, AC-9): its whole query string is left out,
// because the key can be spelled in the address in ways no pattern on the raw text would match.
export function redactSensitivePath(url: string, dropQueryString = false): string {
  // `?? url`: split always returns at least one part, but TypeScript cannot know that.
  const path = url.split('?')[0] ?? url
  const logged = dropQueryString || QUERY_STRING_DROPPED_PATHS.some((pattern) => pattern.test(path)) ? path : url
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
    const url = redactSensitivePath(request.originalUrl, queryHasApiKey(request.query))
    const userAgent = request.get('user-agent') || ''

    response.on('close', () => {
      const { statusCode } = response
      const contentLength = response.get('content-length')

      this.logger.log(`${method} ${url} ${statusCode} ${contentLength || ''} - ${userAgent} ${ip}`)
    })

    next()
  }
}
