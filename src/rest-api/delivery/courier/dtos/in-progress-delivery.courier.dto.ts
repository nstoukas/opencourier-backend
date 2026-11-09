import { DeliveryCourierDto } from './delivery.courier.dto'
import { ApiProperty } from '@nestjs/swagger'
import { LocationNoteCourierWithReactionCountsDto } from 'src/rest-api/location-note/courier/dtos/location-note-with-reaction-counts.courier.dto'
import { InProgressDeliveryCourier } from '../types/in-progress-delivery.courier.type'
import { LocationCourierDto } from 'src/rest-api/location/courier/dto/location.courier.dto'
import { EnumDeliveryStatus } from '@prisma/types'
import { CourierWaitRules, waitLeaveFrom, waitPaidFrom } from 'src/domains/delivery/wait-pay'

export class InProgressDeliveryCourierDto extends DeliveryCourierDto {
  @ApiProperty({ type: LocationCourierDto })
  pickupLocation: LocationCourierDto

  @ApiProperty({ type: LocationCourierDto })
  dropoffLocation: LocationCourierDto

  @ApiProperty({ type: LocationNoteCourierWithReactionCountsDto, isArray: true })
  pickupLocationNotes: LocationNoteCourierWithReactionCountsDto[]

  @ApiProperty({ type: LocationNoteCourierWithReactionCountsDto, isArray: true })
  dropOffLocationNotes: LocationNoteCourierWithReactionCountsDto[]

  // Spec 0033 (AC-5), while the rider waits at the restaurant: when they may leave, and when the wait
  // starts earning (null when it will not). Worked out here so the phone only counts down to them.
  @ApiProperty({ type: Date, nullable: true })
  leaveFrom: Date | null

  @ApiProperty({ type: Date, nullable: true })
  paidFrom: Date | null

  constructor(data: InProgressDeliveryCourier, waitRules: CourierWaitRules) {
    super(data)

    const waiting = data.status === EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION
    const promised = waiting ? data.promisedReadyAt ?? null : null
    this.leaveFrom = promised ? waitLeaveFrom(promised, waitRules.leaveMinutes) : null
    this.paidFrom =
      promised && waitRules.payOn && data.arrivedAtPickupAt
        ? waitPaidFrom({
            arrivedAt: data.arrivedAtPickupAt,
            promisedReadyAt: promised,
            foodReadyAt: data.foodReadyAt ?? null,
            freeMinutes: waitRules.freeMinutes,
          })
        : null

    this.pickupLocation = new LocationCourierDto(data.pickupLocation)
    this.dropoffLocation = new LocationCourierDto(data.dropoffLocation)

    this.pickupLocationNotes = data.pickupLocationNotes.map(
      (note) => new LocationNoteCourierWithReactionCountsDto(note)
    )
    this.dropOffLocationNotes = data.dropoffLocationNotes.map(
      (note) => new LocationNoteCourierWithReactionCountsDto(note)
    )
  }
}
