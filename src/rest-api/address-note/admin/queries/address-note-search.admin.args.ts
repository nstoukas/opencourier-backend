import { ApiProperty } from '@nestjs/swagger'
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'

// Spec 0053 (AC-7, cross check 9): the Address notes search, by address text or coordinates.
export class AddressNoteSearchAdminArgs {
  @ApiProperty({ required: false, type: String })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  search?: string

  @ApiProperty({ required: false, type: Number })
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number

  @ApiProperty({ required: false, type: Number })
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  perPage?: number
}
