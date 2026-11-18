import { ApiProperty } from '@nestjs/swagger'

// The answer to an admin's New API key (spec 0037, AC-3). The only time the key itself leaves the
// server: it is shown once and never stored, so a lost key can only be replaced.
export class PartnerApiKeyAdminDto {
  @ApiProperty({ type: String })
  apiKey: string

  @ApiProperty({ type: Date })
  apiKeyCreatedAt: Date

  constructor(apiKey: string, apiKeyCreatedAt: Date) {
    this.apiKey = apiKey
    this.apiKeyCreatedAt = apiKeyCreatedAt
  }
}

// The answer to an admin's Set New Password (spec 0037, AC-1): the restaurant's new API key when it
// had one (replaced in the same write as the password), shown once; null when it had none.
export class PartnerRotatePasswordAdminDto {
  @ApiProperty({ type: String, nullable: true })
  apiKey: string | null

  constructor(apiKey: string | null) {
    this.apiKey = apiKey
  }
}
