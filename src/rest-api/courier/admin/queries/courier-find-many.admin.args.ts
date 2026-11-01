import { ApiProperty } from '@nestjs/swagger'
import { IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator'
import { ADMIN_COURIER_STATUSES, MAX_COURIER_SEARCH_LENGTH, type AdminCourierStatus } from './courier-list-filter'

export class CourierFindManyAdminArgs {
  @ApiProperty({
    required: false,
    type: Number,
  })
  @IsInt()
  @IsOptional()
  page?: number

  @ApiProperty({
    required: false,
    type: Number,
  })
  @IsInt()
  @IsOptional()
  perPage?: number

  // Which riders to list (row 97): all, working (Online or Last call) or offline.
  @ApiProperty({
    required: false,
    enum: ADMIN_COURIER_STATUSES,
  })
  @IsIn(ADMIN_COURIER_STATUSES)
  @IsOptional()
  status?: AdminCourierStatus

  // Finds a rider by first name, last name or phone; every word must match (row 97).
  @ApiProperty({
    required: false,
    type: String,
  })
  @IsString()
  @MaxLength(MAX_COURIER_SEARCH_LENGTH)
  @IsOptional()
  search?: string
}
