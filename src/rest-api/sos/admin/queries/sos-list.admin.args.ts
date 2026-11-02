import { ApiProperty } from '@nestjs/swagger'
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator'

// `GET admin/v1/sos?status=…` (spec 0022, AC-9). `current` is active and awaiting close, all of
// them (the banner and the top of the list); `closed` is paged, newest first.
export class SosListAdminArgs {
  @ApiProperty({ enum: ['current', 'closed'], required: true })
  @IsIn(['current', 'closed'])
  status: 'current' | 'closed'

  // Query values arrive as text; the global ValidationPipe turns them into numbers first.
  @ApiProperty({ type: Number, required: false, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number

  @ApiProperty({ type: Number, required: false, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number
}
