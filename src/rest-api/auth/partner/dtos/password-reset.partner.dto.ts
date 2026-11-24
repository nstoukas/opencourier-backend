import { ApiProperty } from '@nestjs/swagger'

// Row 153: the answer to a restaurant's successful reset. No session: the restaurant signs in with its new
// password, through request-web's own sign in, which sets its cookie.
export class PasswordResetPartnerDto {
  // True when the restaurant had an API key and it was switched off; it asks the co-op for a new one.
  @ApiProperty({ type: Boolean })
  apiKeyRemoved: boolean

  constructor(apiKeyRemoved: boolean) {
    this.apiKeyRemoved = apiKeyRemoved
  }
}
