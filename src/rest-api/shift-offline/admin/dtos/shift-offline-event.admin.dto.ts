import { ApiProperty } from '@nestjs/swagger'
import { EnumCourierStatusChangeCause } from '@prisma/types'
import { INSTANCE_TIMEZONE } from 'src/constants'
import { dayjs } from 'src/core/utils/time'
import { ADMIN_CAUSE_WORDS, athensClockOf, athensDayOf } from 'src/domains/shift/shift-offline'
import { OfflineEventForAdmin } from 'src/persistence/repositories/shift-booking.repository'

// Spec 0049 (AC-6): one Offline during a booked shift, for an admin to follow up in person. Times are also
// sent as Athens text, so the page never formats them in the browser's zone. Copied field by field.
export class ShiftOfflineEventAdminDto {
  @ApiProperty() id: string
  @ApiProperty() courierId: string
  @ApiProperty() courierName: string
  @ApiProperty({ type: Date, nullable: true }) offlineAt: Date | null
  @ApiProperty({ example: '21:10', nullable: true, type: String }) offlineTime: string | null
  @ApiProperty({ example: '2026-11-20' }) shiftDate: string
  @ApiProperty({ example: 'Fri 20 Nov, 20:00 to 23:59' }) shiftText: string
  @ApiProperty({ enum: EnumCourierStatusChangeCause, nullable: true }) cause: EnumCourierStatusChangeCause | null
  @ApiProperty({ example: 'The rider switched to Offline' }) causeText: string
  @ApiProperty({ type: Date, nullable: true }) followedUpAt: Date | null
  @ApiProperty({ type: String, nullable: true }) followedUpByEmail: string | null

  constructor(event: OfflineEventForAdmin) {
    this.id = event.id
    this.courierId = event.courierId
    this.courierName = event.courierName
    this.offlineAt = event.offlineAt
    this.offlineTime = event.offlineAt ? athensClockOf(event.offlineAt) : null
    this.shiftDate = event.shiftDate
    // Review fix: a shift ending at midnight reads "24:00", as the rider's sentence does.
    const end = athensClockOf(event.shiftEndsAt)
    const endsNextDay = dayjs(event.shiftEndsAt).tz(INSTANCE_TIMEZONE).format('YYYY-MM-DD') !== event.shiftDate
    this.shiftText = `${athensDayOf(event.shiftStartsAt)}, ${athensClockOf(event.shiftStartsAt)} to ${
      end === '00:00' && endsNextDay ? '24:00' : end
    }`
    this.cause = event.cause
    this.causeText = event.cause ? ADMIN_CAUSE_WORDS[event.cause] : 'Cause not recorded'
    this.followedUpAt = event.followedUpAt
    this.followedUpByEmail = event.followedUpByEmail
  }
}
