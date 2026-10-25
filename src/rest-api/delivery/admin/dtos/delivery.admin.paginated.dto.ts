import { ApiProperty } from '@nestjs/swagger'
import { IsOptional, ValidateNested } from 'class-validator'
import { Expose, Type } from 'class-transformer'
import { PaginationDto } from '../../../../core/dtos/PaginationDto'
import { DeliveryAdminDto } from './delivery.admin.dto'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { DeliveryOfferView } from 'src/domains/delivery/types/delivery-offer-view.type'

export class DeliveryAdminPaginatedDto {
  @ApiProperty({
    required: true,
    type: () => [DeliveryAdminDto],
  })
  @ValidateNested({ each: true })
  @Type(() => DeliveryAdminDto)
  @Expose()
  data: DeliveryAdminDto[]

  @ApiProperty({
    required: false,
    type: () => PaginationDto,
  })
  @ValidateNested()
  @Type(() => PaginationDto)
  @IsOptional()
  @Expose()
  pagination?: PaginationDto

  // `offerViews?` = optional map of delivery id to its Offer column data (spec 0002).
  constructor(data: { data: DeliveryEntity[]; pagination?: PaginationDto }, offerViews?: Map<string, DeliveryOfferView>) {
    this.data = data.data.map((delivery) => new DeliveryAdminDto(delivery, undefined, offerViews?.get(delivery.id)))
    this.pagination = data.pagination
  }
}
