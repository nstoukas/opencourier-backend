import { ApiProperty } from '@nestjs/swagger'
import { MyShiftBooking, ShiftOccurrence, ShiftSchedule } from 'src/services/shift-booking/shift-booking.service'

// Spec 0027. Times come as text in Athens wall time (startTime, endTime, dropUntilText), so the app never
// formats an instant in its own zone. An open swap carries its booking id only, never who offered it.
export class ShiftOccurrenceCourierDto {
  @ApiProperty() shiftSlotId: string
  @ApiProperty({ example: '2026-11-06' }) date: string
  @ApiProperty({ type: Date }) startsAt: Date
  @ApiProperty({ type: Date }) endsAt: Date
  @ApiProperty({ example: '19:00' }) startTime: string
  @ApiProperty({ example: '23:00' }) endTime: string
  @ApiProperty() riderCap: number
  @ApiProperty() placesTaken: number
  @ApiProperty({ type: String, nullable: true }) myBookingId: string | null
  @ApiProperty({ type: Object, nullable: true }) openSwap: { bookingId: string } | null

  constructor(occurrence: ShiftOccurrence) {
    this.shiftSlotId = occurrence.shiftSlotId
    this.date = occurrence.date
    this.startsAt = occurrence.startsAt
    this.endsAt = occurrence.endsAt
    this.startTime = occurrence.startTime
    this.endTime = occurrence.endTime
    this.riderCap = occurrence.riderCap
    this.placesTaken = occurrence.placesTaken
    this.myBookingId = occurrence.myBookingId
    this.openSwap = occurrence.openSwap ? { bookingId: occurrence.openSwap.bookingId } : null
  }
}

export class MyShiftBookingCourierDto {
  @ApiProperty() id: string
  @ApiProperty() shiftSlotId: string
  @ApiProperty() date: string
  @ApiProperty({ type: Date }) startsAt: Date
  @ApiProperty({ type: Date }) endsAt: Date
  @ApiProperty() startTime: string
  @ApiProperty() endTime: string
  @ApiProperty({ type: Date, nullable: true }) swapOfferedAt: Date | null
  @ApiProperty({ type: Date }) dropUntil: Date
  @ApiProperty({ example: '18:00 today' }) dropUntilText: string
  @ApiProperty() slotRemoved: boolean

  constructor(booking: MyShiftBooking) {
    this.id = booking.id
    this.shiftSlotId = booking.shiftSlotId
    this.date = booking.date
    this.startsAt = booking.startsAt
    this.endsAt = booking.endsAt
    this.startTime = booking.startTime
    this.endTime = booking.endTime
    this.swapOfferedAt = booking.swapOfferedAt
    this.dropUntil = booking.dropUntil
    this.dropUntilText = booking.dropUntilText
    this.slotRemoved = booking.slotRemoved
  }
}

export class ShiftScheduleCourierDto {
  @ApiProperty({ type: Date }) serverNow: Date
  @ApiProperty({ type: [ShiftOccurrenceCourierDto] }) occurrences: ShiftOccurrenceCourierDto[]
  @ApiProperty({ type: [MyShiftBookingCourierDto] }) myBookings: MyShiftBookingCourierDto[]

  constructor(schedule: ShiftSchedule) {
    this.serverNow = schedule.serverNow
    this.occurrences = schedule.occurrences.map((occurrence) => new ShiftOccurrenceCourierDto(occurrence))
    this.myBookings = schedule.myBookings.map((booking) => new MyShiftBookingCourierDto(booking))
  }
}
