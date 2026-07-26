import { ApiProperty } from '@nestjs/swagger'
import { IsOptional, IsString, Matches } from 'class-validator'

// Query parameters DTO for the courier earnings day drill-down endpoint.
export class EarningsDayCourierArgs {
  // Swagger decorator for OpenAPI documentation
  @ApiProperty({ type: String, description: 'Day to list, YYYY-MM-DD in the given timezone' })
  // Class-validator decorator validating the string matches the YYYY-MM-DD pattern.
  // The message is a function so a missing value reports "required" while a
  // present-but-malformed value still reports the format error. (A separate
  // @IsDefined decorator would make a missing date return BOTH messages, because
  // the global ValidationPipe reports every failed constraint.)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: (args) => (args.value === undefined ? 'date is required' : 'date must be YYYY-MM-DD'),
  })
  date!: string

  // Swagger decorator for OpenAPI documentation
  @ApiProperty({ required: false, type: String, description: 'IANA timezone, e.g. Europe/Athens. Defaults to UTC.' })
  // Class-validator decorator validating property is a string
  @IsString()
  // Class-validator decorator marking parameter optional
  @IsOptional()
  timezone?: string
}
