import { ApiProperty } from '@nestjs/swagger'
import { IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator'
import { ADMIN_DELIVERY_STATES, MAX_DELIVERY_SEARCH_LENGTH, type AdminDeliveryState } from './delivery-list-filter'

export class DeliveryFindManyAdminArgs {
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

  @ApiProperty({
    required: false,
    type: String,
  })
  @IsString()
  @IsOptional()
  courierId?: string

  // One restaurant's deliveries, its whole history (spec 0017, AC-7). Combines with the rest.
  @ApiProperty({
    required: false,
    type: String,
  })
  @IsString()
  @MaxLength(64)
  @IsOptional()
  partnerId?: string

  // Which deliveries to list (row 96): all, active, dropped_off or canceled.
  @ApiProperty({
    required: false,
    enum: ADMIN_DELIVERY_STATES,
  })
  @IsIn(ADMIN_DELIVERY_STATES)
  @IsOptional()
  state?: AdminDeliveryState

  // Finds a delivery by order reference, customer, restaurant or the end of its id (row 96).
  @ApiProperty({
    required: false,
    type: String,
  })
  @IsString()
  @MaxLength(MAX_DELIVERY_SEARCH_LENGTH)
  @IsOptional()
  search?: string
}
