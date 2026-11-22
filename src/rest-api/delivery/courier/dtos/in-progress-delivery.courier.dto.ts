import { SplitRequestCourierDto } from 'src/rest-api/split-request/dtos/split-request.dto'
import { splitLeaveFrom } from 'src/domains/split/split'
import { DEFAULT_SPLIT_ANSWER_MINUTES } from 'src/constants'
import { DeliveryCourierDto } from './delivery.courier.dto'
import { ApiProperty } from '@nestjs/swagger'
import { AddressNoteCourierDto } from 'src/rest-api/location-note/courier/dtos/address-note.courier.dto'
import { InProgressDeliveryCourier } from '../types/in-progress-delivery.courier.type'
import { LocationCourierDto } from 'src/rest-api/location/courier/dto/location.courier.dto'
import { EnumDeliveryStatus } from '@prisma/types'
import { CourierWaitRules, waitLeaveFrom, waitPaidFrom } from 'src/domains/delivery/wait-pay'
import { RemovalRequestCourierDto } from 'src/rest-api/removal-request/courier/dtos/removal-request.courier.dto'

export class InProgressDeliveryCourierDto extends DeliveryCourierDto {
  @ApiProperty({ type: LocationCourierDto })
  pickupLocation: LocationCourierDto

  @ApiProperty({ type: LocationCourierDto })
  dropoffLocation: LocationCourierDto

  // Spec 0053 (AC-3): the notes within 30 m of each stop, at most 10, without their authors.
  @ApiProperty({ type: AddressNoteCourierDto, isArray: true })
  pickupLocationNotes: AddressNoteCourierDto[]

  @ApiProperty({ type: AddressNoteCourierDto, isArray: true })
  dropOffLocationNotes: AddressNoteCourierDto[]

  // Spec 0033 (AC-5), while the rider waits at the restaurant: when they may leave, and when the wait
  // starts earning (null when it will not). Worked out here so the phone only counts down to them.
  @ApiProperty({ type: Date, nullable: true })
  leaveFrom: Date | null

  @ApiProperty({ type: Date, nullable: true })
  paidFrom: Date | null

  // Spec 0035 (AC-5, AC-7): the rider's own request on this job while it is open or refused.
  @ApiProperty({ type: RemovalRequestCourierDto, nullable: true })
  removalRequest: RemovalRequestCourierDto | null

  // Spec 0047 (AC-2, AC-7): the rider's split request on this job while open, refused or confirmed, with
  // when they may leave without an answer (the server's clock).
  @ApiProperty({ type: SplitRequestCourierDto, nullable: true })
  splitRequest: SplitRequestCourierDto | null

  constructor(data: InProgressDeliveryCourier, waitRules: CourierWaitRules) {
    super(data)

    const waiting = data.status === EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION
    const promised = waiting ? data.promisedReadyAt ?? null : null
    this.leaveFrom =
      promised && data.arrivedAtPickupAt ? waitLeaveFrom(promised, data.arrivedAtPickupAt, waitRules.leaveMinutes) : null
    this.paidFrom =
      promised && waitRules.payOn && data.arrivedAtPickupAt
        ? waitPaidFrom({
            arrivedAt: data.arrivedAtPickupAt,
            promisedReadyAt: promised,
            foodReadyAt: data.foodReadyAt ?? null,
            freeMinutes: waitRules.freeMinutes,
          })
        : null

    this.removalRequest = data.removalRequest ? new RemovalRequestCourierDto(data.removalRequest) : null
    this.splitRequest = data.splitRequest
      ? new SplitRequestCourierDto(
          data.splitRequest,
          splitLeaveFrom(data.splitRequest.createdAt, waitRules.splitAnswerMinutes ?? DEFAULT_SPLIT_ANSWER_MINUTES)
        )
      : null

    this.pickupLocation = new LocationCourierDto(data.pickupLocation)
    this.dropoffLocation = new LocationCourierDto(data.dropoffLocation)

    this.pickupLocationNotes = data.pickupLocationNotes.map((note) => new AddressNoteCourierDto(note))
    this.dropOffLocationNotes = data.dropoffLocationNotes.map((note) => new AddressNoteCourierDto(note))
  }
}
