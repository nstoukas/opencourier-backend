import { Injectable, Logger, NestMiddleware } from '@nestjs/common'
import { Request, Response } from 'express'

@Injectable()
export class ResponseFormatMiddleware implements NestMiddleware {
  private readonly logger = new Logger(ResponseFormatMiddleware.name)

  use(req: Request, res: Response, next: () => void) {
    const originalJson = res.json.bind(res) // Bind the original response method to `res`
    res.json = (body) => {
      const data = body ? body : {} // Use an empty object if no response body is provided

      //TODO: implement human readable errors in message in production, developer readable messages in dev.
      if (res.statusCode >= 400) {
        const newResponse = {
          error: true,
          result: [
            {
              code: data.code ?? 'ERROR',
              message: data.message,
              statusCode: res.statusCode,
              // The one extra field an error may carry: a saved customer's phone clash names the other
              // customer by id, so the restaurant's page can show it (spec 0005, AC-4). Named here
              // rather than copying every field, so no other error starts sending more than before.
              ...(data.conflictingCustomerId !== undefined && { conflictingCustomerId: data.conflictingCustomerId }),
            },
          ],
        }
        return originalJson(newResponse) // Call the original response method with the new format
      } else {
        const newResponse = { error: false, result: data }
        return originalJson(newResponse) // Call the original response method with the new format
      }
    }
    next()
  }
}
