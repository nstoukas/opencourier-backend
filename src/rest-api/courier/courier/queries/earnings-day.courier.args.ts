import { ApiProperty } from '@nestjs/swagger'
import { IsOptional, IsString, Matches } from 'class-validator'

// Query parameters DTO for the courier earnings day drill-down endpoint.
export class EarningsDayCourierArgs {
  // Swagger decorator for OpenAPI documentation
  @ApiProperty({ type: String, description: 'Day to list, YYYY-MM-DD in the given timezone' })
  // Class-validator decorator validating string matches YYYY-MM-DD pattern
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string

  // Swagger decorator for OpenAPI documentation
  @ApiProperty({ required: false, type: String, description: 'IANA timezone, e.g. Europe/Athens. Defaults to UTC.' })
  // Class-validator decorator validating property is a string
  @IsString()
  // Class-validator decorator marking parameter optional
  @IsOptional()
  timezone?: string
}
