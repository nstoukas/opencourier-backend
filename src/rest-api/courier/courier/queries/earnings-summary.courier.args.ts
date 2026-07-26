import { ApiProperty } from '@nestjs/swagger'
import { IsDateString, IsOptional, IsString } from 'class-validator'

// Query parameters DTO for the courier earnings summary endpoint.
export class EarningsSummaryCourierArgs {
  // Swagger documentation decorator for OpenAPI schema generation
  @ApiProperty({ required: false, type: String })
  @IsDateString()
  @IsOptional()
  from?: string

  // Swagger documentation decorator for OpenAPI schema generation
  @ApiProperty({ required: false, type: String })
  @IsDateString()
  @IsOptional()
  to?: string

  // Swagger documentation decorator for OpenAPI schema generation
  @ApiProperty({
    required: false,
    type: String,
    description: 'IANA timezone, e.g. Europe/Athens. Defaults to UTC.',
  })
  @IsString()
  @IsOptional()
  timezone?: string
}
