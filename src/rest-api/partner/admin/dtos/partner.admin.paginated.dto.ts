import { ApiProperty } from '@nestjs/swagger'
import { IsOptional, ValidateNested } from 'class-validator'
import { Expose, Type } from 'class-transformer'
import { PaginationDto } from 'src/core/dtos/PaginationDto'
import { PartnerAdminDto } from './partner.admin.dto'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'

export class PartnerPaginatedAdminDto {
  @ApiProperty({
    required: true,
    type: () => [PartnerAdminDto],
  })
  @ValidateNested({ each: true })
  @Type(() => PartnerAdminDto)
  @Expose()
  data: PartnerAdminDto[]

  @ApiProperty({
    required: false,
    type: () => PaginationDto,
  })
  @ValidateNested()
  @Type(() => PaginationDto)
  @IsOptional()
  @Expose()
  pagination?: PaginationDto

  constructor(data: { data: PartnerEntity[]; pagination?: PaginationDto }) {
    this.data = data.data.map((partner) => new PartnerAdminDto(partner))
    this.pagination = data.pagination
  }
}
