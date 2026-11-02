import { ApiProperty } from '@nestjs/swagger'
import { IsOptional, ValidateNested } from 'class-validator'
import { Expose, Type } from 'class-transformer'
import { PaginationDto } from '../../../../core/dtos/PaginationDto'
import { InProgressDeliveryCourierDto } from './in-progress-delivery.courier.dto'
import { InProgressDeliveryCourier } from '../types/in-progress-delivery.courier.type'

export class InProgressDeliveriesCourierPaginatedDto {
  @ApiProperty({
    required: true,
    type: () => [InProgressDeliveryCourierDto],
  })
  @ValidateNested({ each: true })
  @Type(() => InProgressDeliveryCourierDto)
  @Expose()
  data: InProgressDeliveryCourierDto[]

  @ApiProperty({
    required: false,
    type: () => PaginationDto,
  })
  @ValidateNested()
  @Type(() => PaginationDto)
  @IsOptional()
  @Expose()
  pagination?: PaginationDto

  // The server's clock when this list was built (spec 0020, AC-3), as the offer list has it: the phone
  // counts the free hand back down from handBackUntil minus this, so a wrong phone clock cannot
  // stretch or cut the window.
  @ApiProperty({ type: Date })
  @Expose()
  serverNow: Date

  constructor(data: { data: InProgressDeliveryCourier[]; pagination?: PaginationDto }) {
    this.data = data.data.map((order) => new InProgressDeliveryCourierDto(order))
    this.pagination = data.pagination
    this.serverNow = new Date()
  }
}
