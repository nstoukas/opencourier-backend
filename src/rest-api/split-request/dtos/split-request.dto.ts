import { ApiProperty } from '@nestjs/swagger'
import { EnumSplitRequestStatus, SplitRequest } from '@prisma/types'
import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator'
import { BoxSize } from '@prisma/types'
import type { SplitRequestForQueue } from 'src/persistence/repositories/split-request.repository'

// Spec 0047: one box of a proposed or confirmed split. @ValidateNested + @Type check each item as this class.
export class SplitLegInput {
  @ApiProperty({ enum: BoxSize })
  @IsEnum(BoxSize)
  boxSize: BoxSize
}

// AC-1: the rider's proposal, 2 to 4 boxes.
export class SplitRequestCourierInput {
  @ApiProperty({ type: [SplitLegInput] })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => SplitLegInput)
  legs: SplitLegInput[]
}

// AC-4: the admin confirms as proposed (no legs) or with changed legs.
export class SplitConfirmAdminInput {
  @ApiProperty({ type: [SplitLegInput], required: false })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => SplitLegInput)
  legs?: SplitLegInput[]
}

// AC-4, AC-7: "It fits", with an optional sentence for the rider.
export class SplitRefuseAdminInput {
  @ApiProperty({ type: String, required: false, maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string
}

const legsOf = (value: unknown): { boxSize: BoxSize }[] =>
  Array.isArray(value) ? (value as { boxSize: BoxSize }[]).map((leg) => ({ boxSize: leg.boxSize })) : []

// What the rider sees of their own request (AC-1, AC-2, AC-7): the admin's id never, their sentence yes.
export class SplitRequestCourierDto {
  @ApiProperty() id: string
  @ApiProperty() deliveryId: string
  @ApiProperty({ enum: EnumSplitRequestStatus }) status: EnumSplitRequestStatus
  @ApiProperty({ type: Object, isArray: true }) proposedLegs: { boxSize: BoxSize }[]
  @ApiProperty({ type: Object, isArray: true, nullable: true }) finalLegs: { boxSize: BoxSize }[] | null
  @ApiProperty({ type: Date }) createdAt: Date
  // AC-2: when the rider may leave without an answer, on the server's clock.
  @ApiProperty({ type: Date }) leaveFrom: Date
  @ApiProperty({ type: String, nullable: true }) adminNote: string | null

  constructor(request: SplitRequest, leaveFrom: Date) {
    this.id = request.id
    this.deliveryId = request.deliveryId
    this.status = request.status
    this.proposedLegs = legsOf(request.proposedLegs)
    this.finalLegs = request.finalLegs === null ? null : legsOf(request.finalLegs)
    this.createdAt = request.createdAt
    this.leaveFrom = leaveFrom
    this.adminNote = request.adminNote
  }
}

// AC-4: one open request in the admin queue: the restaurant, the rider, the proposal, the wait so far.
export class SplitRequestAdminDto {
  @ApiProperty() id: string
  @ApiProperty() deliveryId: string
  @ApiProperty() courierId: string
  @ApiProperty() courierName: string
  @ApiProperty({ type: String, nullable: true }) restaurantName: string | null
  @ApiProperty({ type: String, nullable: true }) orderReference: string | null
  @ApiProperty({ type: String }) currentBoxSize: string
  @ApiProperty({ type: Number, nullable: true }) legNumber: number | null
  @ApiProperty({ type: Number, nullable: true }) legCount: number | null
  @ApiProperty({ type: Object, isArray: true }) proposedLegs: { boxSize: BoxSize }[]
  @ApiProperty({ type: Date }) createdAt: Date
  @ApiProperty({ type: Number }) waitedMinutes: number

  constructor(request: SplitRequestForQueue, now: Date) {
    this.id = request.id
    this.deliveryId = request.deliveryId
    this.courierId = request.courierId
    this.courierName = `${request.courier.firstName} ${request.courier.lastName}`.trim()
    this.restaurantName = request.delivery.pickupBusinessName
    this.orderReference = request.delivery.orderReference
    this.currentBoxSize = request.delivery.boxSize
    this.legNumber = request.delivery.legNumber
    this.legCount = request.delivery.legCount
    this.proposedLegs = legsOf(request.proposedLegs)
    this.createdAt = request.createdAt
    this.waitedMinutes = Math.max(0, Math.floor((now.getTime() - request.createdAt.getTime()) / 60_000))
  }
}
