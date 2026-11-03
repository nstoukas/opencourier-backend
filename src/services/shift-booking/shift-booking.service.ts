import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { EnumShiftBookingEventType, EnumShiftBookingStatus, ShiftBooking } from '@prisma/types'
import { INSTANCE_TIMEZONE } from 'src/constants'
import { dayjs } from 'src/core/utils/time'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import {
  clockText,
  dropDeadline,
  dropUntilText,
  isoWeekday,
  occurrenceTimes,
  scheduleDates,
} from 'src/domains/shift/shift-occurrences'
import { BookingWithSlot, ShiftBookingRepository } from 'src/persistence/repositories/shift-booking.repository'
import { ShiftSlotRepository } from 'src/persistence/repositories/shift-slot.repository'

// The sentences riders read (spec 0027): one place, so the app never words a refusal itself.
export const SHIFT_SENTENCES = {
  off: 'Shifts are off.',
  full: 'This shift just filled up.',
  started: 'This shift has already started.',
  overlap: 'You already have a shift at that time.',
  alreadyBooked: 'You already booked this shift.',
  notYours: 'This booking is no longer yours to change.',
  justTaken: 'This swap was just taken.',
  ownSwap: "You can't take your own swap.",
  removed: 'This slot was removed. You can still drop it.',
  notOnSchedule: 'This shift is not on the schedule.',
  noOpenSwap: 'No open swap here.',
  dropTooLate: (until: string) =>
    `This shift can no longer be dropped. You could drop it until ${until}; you can still offer it as a swap.`,
}

export interface ShiftOccurrence {
  shiftSlotId: string
  date: string
  startsAt: Date
  endsAt: Date
  startTime: string
  endTime: string
  riderCap: number
  placesTaken: number
  myBookingId: string | null
  openSwap: { bookingId: string } | null
}

export interface MyShiftBooking {
  id: string
  shiftSlotId: string
  date: string
  startsAt: Date
  endsAt: Date
  startTime: string
  endTime: string
  swapOfferedAt: Date | null
  dropUntil: Date
  dropUntilText: string
  slotRemoved: boolean
}

export interface ShiftSchedule {
  serverNow: Date
  occurrences: ShiftOccurrence[]
  myBookings: MyShiftBooking[]
}

// Spec 0027 (row 78): riders book occurrences of the weekly slots, drop them before the co-op's notice,
// and pass them on as swaps. Book and take run under the rider lock then the occurrence lock; drop,
// swap and withdraw are conditional writes; every change writes its ShiftBookingEvent in its transaction.
// Nothing here counts bookings per rider (value 5).
@Injectable()
export class ShiftBookingService {
  constructor(
    private readonly bookings: ShiftBookingRepository,
    private readonly slots: ShiftSlotRepository,
    private readonly configDomainService: ConfigDomainService
  ) {}

  async schedule(courierId: string, now: Date): Promise<ShiftSchedule> {
    await this.refuseIfShiftsOff()
    const dates = scheduleDates(now)
    const [slots, taken, mine, swaps, noticeHours] = await Promise.all([
      this.slots.list(false),
      this.bookings.placesTaken(dates),
      this.bookings.currentBookingsOf(courierId, now),
      this.bookings.openSwapsNotBy(courierId, now),
      this.configDomainService.instanceConfig.getShiftDropNoticeHours(),
    ])
    const myByOccurrence = new Map(mine.map((booking) => [`${booking.shiftSlotId}:${booking.date}`, booking.id]))
    // The oldest open offer per occurrence (the list is oldest first, so the first one wins).
    const swapByOccurrence = new Map<string, string>()
    for (const swap of swaps) {
      const key = `${swap.shiftSlotId}:${swap.date}`
      if (!swapByOccurrence.has(key)) swapByOccurrence.set(key, swap.id)
    }
    const occurrences: ShiftOccurrence[] = []
    for (const date of dates) {
      const weekday = isoWeekday(date)
      for (const slot of slots) {
        if (slot.weekday !== weekday) continue
        const { startsAt, endsAt } = occurrenceTimes(date, slot)
        if (startsAt <= now) continue
        const key = `${slot.id}:${date}`
        const swapId = swapByOccurrence.get(key)
        occurrences.push({
          shiftSlotId: slot.id,
          date,
          startsAt,
          endsAt,
          startTime: clockText(slot.startMinute),
          endTime: clockText(slot.endMinute),
          riderCap: slot.riderCap,
          placesTaken: taken.get(key) ?? 0,
          myBookingId: myByOccurrence.get(key) ?? null,
          openSwap: swapId ? { bookingId: swapId } : null,
        })
      }
    }
    occurrences.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    return { serverNow: now, occurrences, myBookings: mine.map((booking) => this.myBooking(booking, noticeHours, now)) }
  }

  async book(courierId: string, shiftSlotId: string, date: string, now: Date): Promise<MyShiftBooking> {
    await this.refuseIfShiftsOff()
    const created = await this.bookings.transaction(async (tx) => {
      await this.bookings.lockRider(tx, courierId)
      await this.bookings.lockOccurrence(tx, shiftSlotId, date)
      const slot = await this.slots.findById(shiftSlotId)
      if (!slot || slot.removedAt || !scheduleDates(now).includes(date) || isoWeekday(date) !== slot.weekday) {
        throw new NotFoundException(SHIFT_SENTENCES.notOnSchedule)
      }
      const { startsAt, endsAt } = occurrenceTimes(date, slot)
      if (startsAt <= now) throw new ConflictException(SHIFT_SENTENCES.started)
      if (await this.bookings.alreadyBooked(tx, courierId, shiftSlotId, date)) {
        throw new ConflictException(SHIFT_SENTENCES.alreadyBooked)
      }
      if ((await this.bookings.countBooked(tx, shiftSlotId, date)) >= slot.riderCap) {
        throw new ConflictException(SHIFT_SENTENCES.full)
      }
      if (await this.bookings.overlapping(tx, courierId, startsAt, endsAt)) {
        throw new ConflictException(SHIFT_SENTENCES.overlap)
      }
      return this.bookings.createBooking(
        tx,
        { shiftSlotId, courierId, date, startsAt, endsAt, capAtBooking: slot.riderCap },
        { otherCourierId: null }
      )
    })
    return this.answer(created.id, now)
  }

  async drop(courierId: string, bookingId: string, now: Date): Promise<MyShiftBooking> {
    await this.refuseIfShiftsOff()
    const booking = await this.ownBooked(courierId, bookingId)
    const noticeHours = await this.configDomainService.instanceConfig.getShiftDropNoticeHours()
    const until = dropDeadline(booking.startsAt, noticeHours)
    if (now > until) throw new ConflictException(SHIFT_SENTENCES.dropTooLate(dropUntilText(until, now)))
    await this.bookings.transaction(async (tx) => {
      const done = await this.bookings.updateIf(
        tx,
        { id: bookingId, courierId, status: EnumShiftBookingStatus.BOOKED },
        { status: EnumShiftBookingStatus.DROPPED, endedAt: now, swapOfferedAt: null }
      )
      if (!done) throw new ConflictException(SHIFT_SENTENCES.notYours)
      await this.bookings.event(tx, bookingId, EnumShiftBookingEventType.DROPPED, courierId)
    })
    return this.answer(bookingId, now)
  }

  async offerSwap(courierId: string, bookingId: string, now: Date): Promise<MyShiftBooking> {
    await this.refuseIfShiftsOff()
    const booking = await this.ownBooked(courierId, bookingId)
    if (booking.startsAt <= now) throw new ConflictException(SHIFT_SENTENCES.started)
    if (booking.shiftSlot.removedAt) throw new ConflictException(SHIFT_SENTENCES.removed)
    // Already offered: a double tap changes nothing.
    if (booking.swapOfferedAt) return this.answer(bookingId, now)
    await this.bookings.transaction(async (tx) => {
      const done = await this.bookings.updateIf(
        tx,
        { id: bookingId, courierId, status: EnumShiftBookingStatus.BOOKED, swapOfferedAt: null },
        { swapOfferedAt: now }
      )
      if (!done) throw new ConflictException(SHIFT_SENTENCES.notYours)
      await this.bookings.event(tx, bookingId, EnumShiftBookingEventType.SWAP_OFFERED, courierId)
    })
    return this.answer(bookingId, now)
  }

  async withdrawSwap(courierId: string, bookingId: string, now: Date): Promise<MyShiftBooking> {
    await this.refuseIfShiftsOff()
    const booking = await this.ownBooked(courierId, bookingId)
    // Nothing offered: a double tap changes nothing.
    if (!booking.swapOfferedAt) return this.answer(bookingId, now)
    await this.bookings.transaction(async (tx) => {
      const done = await this.bookings.updateIf(
        tx,
        { id: bookingId, courierId, status: EnumShiftBookingStatus.BOOKED, swapOfferedAt: { not: null } },
        { swapOfferedAt: null }
      )
      // The offer was taken in between: the booking is no longer this rider's.
      if (!done) throw new ConflictException(SHIFT_SENTENCES.notYours)
      await this.bookings.event(tx, bookingId, EnumShiftBookingEventType.SWAP_WITHDRAWN, courierId)
    })
    return this.answer(bookingId, now)
  }

  // Takes another rider's open swap: their booking ends (SWAPPED_AWAY) and this rider gets one with the
  // same snapshot (date, times, cap at booking), never worked out again from the slot.
  async take(courierId: string, bookingId: string, now: Date): Promise<MyShiftBooking> {
    await this.refuseIfShiftsOff()
    const offered = await this.bookings.findBooking(bookingId)
    if (!offered || offered.status !== EnumShiftBookingStatus.BOOKED || !offered.swapOfferedAt) {
      throw new NotFoundException(SHIFT_SENTENCES.noOpenSwap)
    }
    if (offered.courierId === courierId) throw new ConflictException(SHIFT_SENTENCES.ownSwap)
    if (offered.startsAt <= now) throw new ConflictException(SHIFT_SENTENCES.started)
    const created = await this.bookings.transaction(async (tx) => {
      await this.bookings.lockRider(tx, courierId)
      await this.bookings.lockOccurrence(tx, offered.shiftSlotId, offered.date)
      if (await this.bookings.overlapping(tx, courierId, offered.startsAt, offered.endsAt)) {
        throw new ConflictException(SHIFT_SENTENCES.overlap)
      }
      const ended = await this.bookings.updateIf(
        tx,
        { id: bookingId, status: EnumShiftBookingStatus.BOOKED, swapOfferedAt: { not: null } },
        { status: EnumShiftBookingStatus.SWAPPED_AWAY, endedAt: now, swapOfferedAt: null }
      )
      if (!ended) throw new ConflictException(SHIFT_SENTENCES.justTaken)
      await this.bookings.event(tx, bookingId, EnumShiftBookingEventType.SWAP_TAKEN, offered.courierId, courierId)
      return this.bookings.createBooking(
        tx,
        {
          shiftSlotId: offered.shiftSlotId,
          courierId,
          date: offered.date,
          startsAt: offered.startsAt,
          endsAt: offered.endsAt,
          capAtBooking: offered.capAtBooking,
        },
        { otherCourierId: offered.courierId }
      )
    })
    return this.answer(created.id, now)
  }

  private async refuseIfShiftsOff(): Promise<void> {
    if (!(await this.configDomainService.instanceConfig.getShiftsEnabled())) {
      throw new ConflictException(SHIFT_SENTENCES.off)
    }
  }

  // This rider's booking, still BOOKED: another rider's or an unknown id is 404, an ended one 409.
  private async ownBooked(courierId: string, bookingId: string): Promise<BookingWithSlot> {
    const booking = await this.bookings.findBooking(bookingId)
    if (!booking || booking.courierId !== courierId) throw new NotFoundException(SHIFT_SENTENCES.notOnSchedule)
    if (booking.status !== EnumShiftBookingStatus.BOOKED) throw new ConflictException(SHIFT_SENTENCES.notYours)
    return booking
  }

  private async answer(bookingId: string, now: Date): Promise<MyShiftBooking> {
    const booking = await this.bookings.findBooking(bookingId)
    if (!booking) throw new NotFoundException(SHIFT_SENTENCES.notOnSchedule)
    const noticeHours = await this.configDomainService.instanceConfig.getShiftDropNoticeHours()
    return this.myBooking(booking, noticeHours, now)
  }

  private myBooking(booking: BookingWithSlot | (ShiftBooking & { shiftSlot: { removedAt: Date | null } }), noticeHours: number, now: Date): MyShiftBooking {
    const until = dropDeadline(booking.startsAt, noticeHours)
    return {
      id: booking.id,
      shiftSlotId: booking.shiftSlotId,
      date: booking.date,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      startTime: athensClock(booking.startsAt, booking.date),
      endTime: athensClock(booking.endsAt, booking.date),
      swapOfferedAt: booking.swapOfferedAt,
      dropUntil: until,
      dropUntilText: dropUntilText(until, now),
      slotRemoved: booking.shiftSlot.removedAt !== null,
    }
  }
}

// HH:mm in Athens of a booking's instant; a midnight on the day after the booking's date reads 24:00.
function athensClock(instant: Date, date: string): string {
  const local = dayjs(instant).tz(INSTANCE_TIMEZONE)
  const time = local.format('HH:mm')
  return time === '00:00' && local.format('YYYY-MM-DD') !== date ? '24:00' : time
}
