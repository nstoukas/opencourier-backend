import { ApiProperty } from '@nestjs/swagger'
import { ORDER_ITEM_KINDS, OrderItem, OrderItemDimensions, OrderItemKind } from 'src/shared-types/index'
import { Type } from 'class-transformer'
import { IsIn, IsNumber, IsOptional, IsString, ValidateIf, ValidateNested } from 'class-validator'
import { RefuseIfNotSentAsString } from 'src/decorators/refuseIfNotSentAsString.decorator'

export class OrderItemDimensionsInput implements OrderItemDimensions {
  @ApiProperty({
    required: true,
    type: Number,
  })
  @IsNumber()
  length: number

  @ApiProperty({
    required: true,
    type: Number,
  })
  @IsNumber()
  height: number

  @ApiProperty({
    required: true,
    type: Number,
  })
  @IsNumber()
  depth: number
}

export class DeliveryOrderItemInput implements OrderItem {
  @ApiProperty({
    required: true,
    type: String,
  })
  @IsString()
  name: string

  @ApiProperty({
    required: true,
    type: Number,
  })
  @IsNumber()
  quantity: number

  @ApiProperty({
    required: false,
    type: String,
  })
  @IsString()
  @IsOptional()
  size?: string

  @ApiProperty({
    required: false,
    type: OrderItemDimensionsInput,
  })
  @Type(() => OrderItemDimensionsInput)
  @ValidateNested()
  @IsOptional()
  dimensions?: OrderItemDimensionsInput

  @ApiProperty({
    required: false,
    type: Number,
  })
  @IsNumber()
  @IsOptional()
  price?: number

  @ApiProperty({
    required: false,
    type: Number,
  })
  @IsNumber()
  @IsOptional()
  weight?: number

  @ApiProperty({
    required: false,
    type: Number,
  })
  @IsNumber()
  @IsOptional()
  vatPercentage?: number

  // Spec 0028 (row 103): DRINK or SIDE, or left out. Null, a number or any other text is a 400
  // (@RefuseIfNotSentAsString refuses null, which @IsOptional alone would let through).
  @ApiProperty({ required: false, enum: ORDER_ITEM_KINDS })
  @RefuseIfNotSentAsString()
  @ValidateIf((_input, value) => value !== undefined)
  @IsIn(ORDER_ITEM_KINDS)
  kind?: OrderItemKind
}
