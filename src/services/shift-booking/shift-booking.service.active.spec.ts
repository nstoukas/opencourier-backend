import { ConflictException, NotFoundException } from '@nestjs/common'
import { EnumShiftBookingEventType, EnumShiftBookingStatus } from '@prisma/types'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { ShiftBookingRepository } from 'src/persistence/repositories/shift-booking.repository'
import { ShiftSlotRepository } from 'src/persistence/repositories/shift-slot.repository'
import { SHIFT_SENTENCES, ShiftBookingService } from './shift-booking.service'

// Spec 0027 (row 78): the booking rules, with the repositories and the settings mocked. No SQL runs:
// the transaction hands the work a sentinel `tx`, so each test can check every write went through it.
describe('ShiftBookingService (spec 0027)', () => {
  // Tuesday 3 Nov 2026, 12:00 in Athens (UTC+2). The window is 3 to 16 Nov.
  const now = new Date('2026-11-03T10:00:00.000Z')
  const RIDER = 'courier-me'
  const GIVER = 'courier-giver'

  const tx = { sentinel: 'tx' }
  let calls: string[]
  let bookings: { [K in keyof ShiftBookingRepository]: jest.Mock }
  let slots: { list: jest.Mock; findById: jest.Mock }
  let instanceConfig: { getShiftsEnabled: jest.Mock; getShiftDropNoticeHours: jest.Mock }
  let service: ShiftBookingService

  // Friday 19:00 to 23:00 Athens, cap 2.
  const friSlot = {
    id: 'slot-fri',
    weekday: 5,
    startMinute: 1140,
    endMinute: 1380,
    riderCap: 2,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    removedAt: null as Date | null,
  }

  function booking(overrides: Record<string, unknown> = {}) {
    return {
      id: 'booking-1',
      shiftSlotId: 'slot-fri',
      courierId: RIDER,
      date: '2026-11-06',
      startsAt: new Date('2026-11-06T17:00:00.000Z'),
      endsAt: new Date('2026-11-06T21:00:00.000Z'),
      capAtBooking: 2,
      status: EnumShiftBookingStatus.BOOKED,
      swapOfferedAt: null as Date | null,
      createdAt: new Date('2026-11-01T00:00:00.000Z'),
      endedAt: null as Date | null,
      shiftSlot: { ...friSlot },
      ...overrides,
    }
  }

  // Records the order the repository is called in, by method name.
  function tracked(name: string, impl?: (...args: unknown[]) => unknown) {
    return jest.fn((...args: unknown[]) => {
      calls.push(name)
      // Every repository method is async, so each answer is a promise.
      return Promise.resolve(impl ? impl(...args) : undefined)
    })
  }

  beforeEach(() => {
    calls = []
    bookings = {
      transaction: tracked('transaction', (work) => (work as (t: unknown) => unknown)(tx)),
      lockRider: tracked('lockRider', () => undefined),
      lockOccurrence: tracked('lockOccurrence', () => undefined),
      placesTaken: tracked('placesTaken', () => new Map()),
      currentBookingsOf: tracked('currentBookingsOf', () => []),
      openSwapsNotBy: tracked('openSwapsNotBy', () => []),
      findBooking: tracked('findBooking', () => booking()),
      overlapping: tracked('overlapping', () => null),
      alreadyBooked: tracked('alreadyBooked', () => false),
      countBooked: tracked('countBooked', () => 0),
      createBooking: tracked('createBooking', (_tx, data) => ({ id: 'booking-new', ...(data as object) })),
      updateIf: tracked('updateIf', () => true),
      event: tracked('event', () => undefined),
    } as unknown as { [K in keyof ShiftBookingRepository]: jest.Mock }
    slots = {
      list: tracked('slots.list', () => [friSlot]),
      findById: tracked('slots.findById', () => ({ ...friSlot })),
    }
    instanceConfig = {
      getShiftsEnabled: jest.fn().mockResolvedValue(true),
      getShiftDropNoticeHours: jest.fn().mockResolvedValue(12),
    }
    service = new ShiftBookingService(
      bookings as unknown as ShiftBookingRepository,
      slots as unknown as ShiftSlotRepository,
      { instanceConfig } as unknown as ConfigDomainService
    )
  })

  async function refusal(promise: Promise<unknown>): Promise<{ type: unknown; message: string }> {
    try {
      await promise
    } catch (error) {
      return { type: (error as object).constructor, message: (error as Error).message }
    }
    throw new Error('expected a refusal')
  }

  describe('AC-1: Shifts off', () => {
    const methods: Array<[string, (s: ShiftBookingService) => Promise<unknown>]> = [
      ['schedule', (s) => s.schedule(RIDER, now)],
      ['book', (s) => s.book(RIDER, 'slot-fri', '2026-11-06', now)],
      ['drop', (s) => s.drop(RIDER, 'booking-1', now)],
      ['offerSwap', (s) => s.offerSwap(RIDER, 'booking-1', now)],
      ['withdrawSwap', (s) => s.withdrawSwap(RIDER, 'booking-1', now)],
      ['take', (s) => s.take(RIDER, 'booking-1', now)],
    ]

    it.each(methods)('%s answers 409 "Shifts are off." and reads or writes nothing', async (_name, call) => {
      instanceConfig.getShiftsEnabled.mockResolvedValue(false)
      const result = await refusal(call(service))
      expect(result).toEqual({ type: ConflictException, message: 'Shifts are off.' })
      expect(calls).toEqual([])
    })

    it("the sentence is the spec's", () => {
      expect(SHIFT_SENTENCES.off).toBe('Shifts are off.')
    })
  })

  describe('AC-2: the schedule', () => {
    // 12:30 to 14:00 Athens on Tuesdays: 3 Nov's has not started at 12:00.
    const tueLate = { ...friSlot, id: 'slot-tue-late', weekday: 2, startMinute: 750, endMinute: 840, riderCap: 3 }
    // 10:00 to 12:00 on Tuesdays: 3 Nov's has started; 10 Nov's is listed.
    const tueEarly = { ...friSlot, id: 'slot-tue-early', weekday: 2, startMinute: 600, endMinute: 720, riderCap: 1 }
    // 12:00 exactly on Tuesdays: starts at now, so 3 Nov's counts as started.
    const tueNoon = { ...friSlot, id: 'slot-tue-noon', weekday: 2, startMinute: 720, endMinute: 780, riderCap: 1 }
    // Wednesdays to midnight: 4 and 11 Nov only (18 Nov is the 16th day).
    const wedNight = { ...friSlot, id: 'slot-wed', weekday: 3, startMinute: 1260, endMinute: 1440, riderCap: 4 }

    it('lists only current slots (list(false)), only in the 14 dates, of matching weekday, with startsAt > now, soonest first', async () => {
      slots.list.mockResolvedValue([friSlot, tueLate, tueEarly, tueNoon, wedNight])

      const result = await service.schedule(RIDER, now)

      expect(slots.list).toHaveBeenCalledWith(false)
      expect(result.occurrences.map((o) => `${o.shiftSlotId}@${o.date}`)).toEqual([
        'slot-tue-late@2026-11-03',
        'slot-wed@2026-11-04',
        'slot-fri@2026-11-06',
        'slot-tue-early@2026-11-10',
        'slot-tue-noon@2026-11-10',
        'slot-tue-late@2026-11-10',
        'slot-wed@2026-11-11',
        'slot-fri@2026-11-13',
      ])
      for (const occurrence of result.occurrences) {
        expect(occurrence.startsAt.getTime()).toBeGreaterThan(now.getTime())
      }
      expect(result.serverNow).toBe(now)
    })

    it('gives each occurrence its instants, its Athens times as text (24:00 for a midnight end), the current cap', async () => {
      slots.list.mockResolvedValue([wedNight])
      const result = await service.schedule(RIDER, now)
      expect(result.occurrences[0]).toEqual({
        shiftSlotId: 'slot-wed',
        date: '2026-11-04',
        startsAt: new Date('2026-11-04T19:00:00.000Z'),
        endsAt: new Date('2026-11-04T22:00:00.000Z'),
        startTime: '21:00',
        endTime: '24:00',
        riderCap: 4,
        placesTaken: 0,
        myBookingId: null,
        openSwap: null,
      })
    })

    it("asks for places taken over the 14 dates, and shows each occurrence's count", async () => {
      bookings.placesTaken.mockResolvedValue(new Map([['slot-fri:2026-11-13', 2]]))
      const result = await service.schedule(RIDER, now)
      const dates = bookings.placesTaken.mock.calls[0][0] as string[]
      expect(dates).toHaveLength(14)
      expect(dates[0]).toBe('2026-11-03')
      expect(dates[13]).toBe('2026-11-16')
      expect(result.occurrences.map((o) => [o.date, o.placesTaken])).toEqual([
        ['2026-11-06', 0],
        ['2026-11-13', 2],
      ])
    })

    it("marks the asking rider's own booking (myBookingId)", async () => {
      bookings.currentBookingsOf.mockResolvedValue([booking({ id: 'mine-1' })])
      const result = await service.schedule(RIDER, now)
      expect(bookings.currentBookingsOf).toHaveBeenCalledWith(RIDER, now)
      expect(result.occurrences.find((o) => o.date === '2026-11-06')!.myBookingId).toBe('mine-1')
      expect(result.occurrences.find((o) => o.date === '2026-11-13')!.myBookingId).toBeNull()
    })

    it('shows the oldest open swap by another rider as { bookingId } only, never the giver', async () => {
      bookings.openSwapsNotBy.mockResolvedValue([
        booking({ id: 'swap-oldest', courierId: 'other-a', swapOfferedAt: new Date('2026-11-01T00:00:00.000Z') }),
        booking({ id: 'swap-newer', courierId: 'other-b', swapOfferedAt: new Date('2026-11-02T00:00:00.000Z') }),
      ])
      const result = await service.schedule(RIDER, now)
      expect(bookings.openSwapsNotBy).toHaveBeenCalledWith(RIDER, now)
      const friday = result.occurrences.find((o) => o.date === '2026-11-06')!
      expect(friday.openSwap).toEqual({ bookingId: 'swap-oldest' })
      expect(Object.keys(friday.openSwap!)).toEqual(['bookingId'])
      expect(JSON.stringify(result.occurrences)).not.toMatch(/other-a|other-b|courierId/)
      expect(result.occurrences.find((o) => o.date === '2026-11-13')!.openSwap).toBeNull()
    })

    it('myBookings: drop deadline and its text, slotRemoved, and times from the snapshot (24:00 for a midnight end)', async () => {
      bookings.currentBookingsOf.mockResolvedValue([
        // Today 19:00 to 23:00; the slot has since been edited to other minutes, which must not show.
        booking({
          id: 'today',
          date: '2026-11-03',
          startsAt: new Date('2026-11-03T17:00:00.000Z'),
          endsAt: new Date('2026-11-03T21:00:00.000Z'),
          shiftSlot: { ...friSlot, startMinute: 600, endMinute: 660 },
        }),
        // Friday 21:00 to midnight, on a slot an admin removed.
        booking({
          id: 'removed',
          date: '2026-11-06',
          startsAt: new Date('2026-11-06T19:00:00.000Z'),
          endsAt: new Date('2026-11-06T22:00:00.000Z'),
          swapOfferedAt: new Date('2026-11-02T09:00:00.000Z'),
          shiftSlot: { ...friSlot, removedAt: new Date('2026-11-02T00:00:00.000Z') },
        }),
      ])
      const result = await service.schedule(RIDER, now)
      expect(result.myBookings).toEqual([
        {
          id: 'today',
          shiftSlotId: 'slot-fri',
          date: '2026-11-03',
          startsAt: new Date('2026-11-03T17:00:00.000Z'),
          endsAt: new Date('2026-11-03T21:00:00.000Z'),
          startTime: '19:00',
          endTime: '23:00',
          swapOfferedAt: null,
          dropUntil: new Date('2026-11-03T05:00:00.000Z'),
          dropUntilText: '07:00 today',
          slotRemoved: false,
        },
        {
          id: 'removed',
          shiftSlotId: 'slot-fri',
          date: '2026-11-06',
          startsAt: new Date('2026-11-06T19:00:00.000Z'),
          endsAt: new Date('2026-11-06T22:00:00.000Z'),
          startTime: '21:00',
          endTime: '24:00',
          swapOfferedAt: new Date('2026-11-02T09:00:00.000Z'),
          dropUntil: new Date('2026-11-06T07:00:00.000Z'),
          dropUntilText: 'Fri 6 Nov, 09:00',
          slotRemoved: true,
        },
      ])
    })

    it('reads a booking that starts at midnight as 00:00, not 24:00', async () => {
      bookings.currentBookingsOf.mockResolvedValue([
        booking({
          date: '2026-11-07',
          startsAt: new Date('2026-11-06T22:00:00.000Z'),
          endsAt: new Date('2026-11-07T02:00:00.000Z'),
        }),
      ])
      const mine = (await service.schedule(RIDER, now)).myBookings[0]!
      expect(mine.startTime).toBe('00:00')
      expect(mine.endTime).toBe('04:00')
    })

    it("the drop deadline follows the co-op's notice hours", async () => {
      instanceConfig.getShiftDropNoticeHours.mockResolvedValue(24)
      bookings.currentBookingsOf.mockResolvedValue([booking()])
      const mine = (await service.schedule(RIDER, now)).myBookings[0]!
      expect(mine.dropUntil).toEqual(new Date('2026-11-05T17:00:00.000Z'))
      expect(mine.dropUntilText).toBe('Thu 5 Nov, 19:00')
    })
  })

  describe('AC-3, AC-6, AC-7: book', () => {
    const book = (date = '2026-11-06', slotId = 'slot-fri', at = now) => service.book(RIDER, slotId, date, at)

    it('takes the rider lock, then the occurrence lock, inside the transaction, before any read or write', async () => {
      await book()
      expect(bookings.lockRider).toHaveBeenCalledWith(tx, RIDER)
      expect(bookings.lockOccurrence).toHaveBeenCalledWith(tx, 'slot-fri', '2026-11-06')
      expect(calls.slice(0, 3)).toEqual(['transaction', 'lockRider', 'lockOccurrence'])
      expect(calls.indexOf('countBooked')).toBeGreaterThan(calls.indexOf('lockOccurrence'))
      expect(calls.indexOf('overlapping')).toBeGreaterThan(calls.indexOf('lockOccurrence'))
      expect(calls.indexOf('alreadyBooked')).toBeGreaterThan(calls.indexOf('lockOccurrence'))
      expect(calls.indexOf('createBooking')).toBeGreaterThan(calls.indexOf('lockOccurrence'))
    })

    it('stores the snapshot (slot, date, instants, cap in force) and writes BOOKED in the same transaction', async () => {
      slots.findById.mockResolvedValue({ ...friSlot, riderCap: 5 })
      bookings.countBooked.mockResolvedValue(4)
      await book()
      expect(bookings.createBooking).toHaveBeenCalledTimes(1)
      expect(bookings.createBooking).toHaveBeenCalledWith(
        tx,
        {
          shiftSlotId: 'slot-fri',
          courierId: RIDER,
          date: '2026-11-06',
          startsAt: new Date('2026-11-06T17:00:00.000Z'),
          endsAt: new Date('2026-11-06T21:00:00.000Z'),
          capAtBooking: 5,
        },
        { otherCourierId: null }
      )
      expect(bookings.countBooked).toHaveBeenCalledWith(tx, 'slot-fri', '2026-11-06')
      expect(bookings.alreadyBooked).toHaveBeenCalledWith(tx, RIDER, 'slot-fri', '2026-11-06')
      expect(bookings.overlapping).toHaveBeenCalledWith(
        tx,
        RIDER,
        new Date('2026-11-06T17:00:00.000Z'),
        new Date('2026-11-06T21:00:00.000Z')
      )
    })

    it('answers the new booking as the rider reads it', async () => {
      bookings.findBooking.mockResolvedValue(booking({ id: 'booking-new' }))
      const result = await book()
      expect(bookings.findBooking).toHaveBeenLastCalledWith('booking-new')
      expect(result.id).toBe('booking-new')
      expect(result.startTime).toBe('19:00')
      expect(result.dropUntilText).toBe('Fri 6 Nov, 07:00')
    })

    describe('404 "This shift is not on the schedule."', () => {
      it.each([
        ['an unknown slot', () => slots.findById.mockResolvedValue(null), '2026-11-06'],
        [
          'a removed slot',
          () => slots.findById.mockResolvedValue({ ...friSlot, removedAt: new Date('2026-11-02T00:00:00.000Z') }),
          '2026-11-06',
        ],
        ['a Friday after the window (20 Nov)', () => undefined, '2026-11-20'],
        [
          'the 15th date (17 Nov, a Tuesday)',
          () => slots.findById.mockResolvedValue({ ...friSlot, weekday: 2 }),
          '2026-11-17',
        ],
        ['a Friday before today (30 Oct)', () => undefined, '2026-10-30'],
        [
          'yesterday (2 Nov, a Monday)',
          () => slots.findById.mockResolvedValue({ ...friSlot, weekday: 1, startMinute: 1380, endMinute: 1440 }),
          '2026-11-02',
        ],
        ['the wrong weekday (a Thursday for a Friday slot)', () => undefined, '2026-11-05'],
      ])('%s', async (_case, arrange, date) => {
        arrange()
        expect(await refusal(book(date))).toEqual({
          type: NotFoundException,
          message: 'This shift is not on the schedule.',
        })
        expect(bookings.createBooking).not.toHaveBeenCalled()
      })

      it('the 14th date (16 Nov, a Monday) is still in the window', async () => {
        slots.findById.mockResolvedValue({ ...friSlot, weekday: 1 })
        await book('2026-11-16')
        expect(bookings.createBooking).toHaveBeenCalled()
      })
    })

    it('409 "This shift has already started." for an occurrence starting before now or at now', async () => {
      // A Tuesday slot at 10:00 Athens: 3 Nov's started two hours ago.
      slots.findById.mockResolvedValue({ ...friSlot, weekday: 2, startMinute: 600, endMinute: 720 })
      expect(await refusal(book('2026-11-03'))).toEqual({
        type: ConflictException,
        message: 'This shift has already started.',
      })
      // 12:00 Athens is now exactly.
      slots.findById.mockResolvedValue({ ...friSlot, weekday: 2, startMinute: 720, endMinute: 780 })
      expect(await refusal(book('2026-11-03'))).toEqual({
        type: ConflictException,
        message: 'This shift has already started.',
      })
      // One minute later it has not.
      slots.findById.mockResolvedValue({ ...friSlot, weekday: 2, startMinute: 721, endMinute: 780 })
      await book('2026-11-03')
      expect(bookings.createBooking).toHaveBeenCalledTimes(1)
    })

    it('409 "You already booked this shift."', async () => {
      bookings.alreadyBooked.mockResolvedValue(true)
      expect(await refusal(book())).toEqual({ type: ConflictException, message: 'You already booked this shift.' })
      expect(bookings.createBooking).not.toHaveBeenCalled()
    })

    it('409 "This shift just filled up." when the BOOKED count reaches the current cap', async () => {
      bookings.countBooked.mockResolvedValue(2)
      expect(await refusal(book())).toEqual({ type: ConflictException, message: 'This shift just filled up.' })
      bookings.countBooked.mockResolvedValue(3)
      expect(await refusal(book())).toEqual({ type: ConflictException, message: 'This shift just filled up.' })
      expect(bookings.createBooking).not.toHaveBeenCalled()
    })

    it('books the last place: count one below the cap', async () => {
      bookings.countBooked.mockResolvedValue(1)
      await book()
      expect(bookings.createBooking).toHaveBeenCalledTimes(1)
    })

    it("checks against the slot's current cap, not any booking's capAtBooking (lowered cap refuses)", async () => {
      slots.findById.mockResolvedValue({ ...friSlot, riderCap: 1 })
      bookings.countBooked.mockResolvedValue(1)
      expect(await refusal(book())).toEqual({ type: ConflictException, message: 'This shift just filled up.' })
    })

    it('409 "You already have a shift at that time." on an overlap', async () => {
      bookings.overlapping.mockResolvedValue(booking({ id: 'other' }))
      expect(await refusal(book())).toEqual({
        type: ConflictException,
        message: 'You already have a shift at that time.',
      })
      expect(bookings.createBooking).not.toHaveBeenCalled()
    })
  })

  describe('AC-4, AC-7: drop', () => {
    // Friday 6 Nov 19:00 Athens; with 12 h notice the deadline is 07:00 that day (05:00 UTC).
    const deadline = new Date('2026-11-06T05:00:00.000Z')

    it("404 for another rider's booking or an unknown id", async () => {
      bookings.findBooking.mockResolvedValue(booking({ courierId: 'someone-else' }))
      expect(await refusal(service.drop(RIDER, 'booking-1', now))).toEqual({
        type: NotFoundException,
        message: 'This shift is not on the schedule.',
      })
      bookings.findBooking.mockResolvedValue(null)
      expect(await refusal(service.drop(RIDER, 'nope', now))).toEqual({
        type: NotFoundException,
        message: 'This shift is not on the schedule.',
      })
      expect(bookings.updateIf).not.toHaveBeenCalled()
    })

    it.each([EnumShiftBookingStatus.DROPPED, EnumShiftBookingStatus.SWAPPED_AWAY])(
      '409 "This booking is no longer yours to change." when %s',
      async (status) => {
        bookings.findBooking.mockResolvedValue(booking({ status }))
        expect(await refusal(service.drop(RIDER, 'booking-1', now))).toEqual({
          type: ConflictException,
          message: 'This booking is no longer yours to change.',
        })
        expect(bookings.updateIf).not.toHaveBeenCalled()
      }
    )

    it('is allowed at exactly the deadline', async () => {
      await service.drop(RIDER, 'booking-1', deadline)
      expect(bookings.updateIf).toHaveBeenCalledTimes(1)
    })

    it('is refused 1 ms after the deadline, with the sentence naming until when and the swap', async () => {
      const late = new Date(deadline.getTime() + 1)
      expect(await refusal(service.drop(RIDER, 'booking-1', late))).toEqual({
        type: ConflictException,
        message:
          'This shift can no longer be dropped. You could drop it until 07:00 today; you can still offer it as a swap.',
      })
      expect(bookings.updateIf).not.toHaveBeenCalled()
      expect(bookings.event).not.toHaveBeenCalled()
    })

    it('words a deadline earlier today as "HH:mm today" and one on an earlier day by its date', async () => {
      // 26 h notice: the deadline is Thursday 5 Nov, 17:00 Athens (15:00 UTC).
      instanceConfig.getShiftDropNoticeHours.mockResolvedValue(26)
      // Asked on Thursday at 18:00 Athens.
      expect((await refusal(service.drop(RIDER, 'booking-1', new Date('2026-11-05T16:00:00.000Z')))).message).toBe(
        'This shift can no longer be dropped. You could drop it until 17:00 today; you can still offer it as a swap.'
      )
      // Asked on Friday at 08:00 Athens.
      expect((await refusal(service.drop(RIDER, 'booking-1', new Date('2026-11-06T06:00:00.000Z')))).message).toBe(
        'This shift can no longer be dropped. You could drop it until Thu 5 Nov, 17:00; you can still offer it as a swap.'
      )
      // On Wednesday the deadline is ahead: the drop goes through.
      await service.drop(RIDER, 'booking-1', new Date('2026-11-04T16:00:00.000Z'))
      expect(bookings.updateIf).toHaveBeenCalledTimes(1)
    })

    it('is a conditional write on (id, rider, BOOKED) that ends the booking and clears any swap offer', async () => {
      bookings.findBooking.mockResolvedValue(booking({ swapOfferedAt: new Date('2026-11-02T00:00:00.000Z') }))
      await service.drop(RIDER, 'booking-1', now)
      expect(bookings.updateIf).toHaveBeenCalledWith(
        tx,
        { id: 'booking-1', courierId: RIDER, status: EnumShiftBookingStatus.BOOKED },
        { status: EnumShiftBookingStatus.DROPPED, endedAt: now, swapOfferedAt: null }
      )
    })

    it('writes one DROPPED event in the same transaction', async () => {
      bookings.findBooking.mockResolvedValue(booking({ swapOfferedAt: new Date('2026-11-02T00:00:00.000Z') }))
      await service.drop(RIDER, 'booking-1', now)
      expect(bookings.event).toHaveBeenCalledTimes(1)
      expect(bookings.event).toHaveBeenCalledWith(tx, 'booking-1', EnumShiftBookingEventType.DROPPED, RIDER)
      expect(calls.indexOf('event')).toBeGreaterThan(calls.indexOf('updateIf'))
    })

    it('409 "This booking is no longer yours to change." on a lost write, with no event', async () => {
      bookings.updateIf.mockResolvedValue(false)
      expect(await refusal(service.drop(RIDER, 'booking-1', now))).toEqual({
        type: ConflictException,
        message: 'This booking is no longer yours to change.',
      })
      expect(bookings.event).not.toHaveBeenCalled()
    })

    it("a removed slot's booking can still be dropped", async () => {
      bookings.findBooking.mockResolvedValue(
        booking({ shiftSlot: { ...friSlot, removedAt: new Date('2026-11-02T00:00:00.000Z') } })
      )
      const result = await service.drop(RIDER, 'booking-1', now)
      expect(bookings.updateIf).toHaveBeenCalledTimes(1)
      expect(result.slotRemoved).toBe(true)
    })
  })

  describe('AC-5, AC-7: offerSwap', () => {
    it('409 "This shift has already started." at or after the start', async () => {
      bookings.findBooking.mockResolvedValue(booking({ startsAt: now }))
      expect(await refusal(service.offerSwap(RIDER, 'booking-1', now))).toEqual({
        type: ConflictException,
        message: 'This shift has already started.',
      })
      expect(bookings.updateIf).not.toHaveBeenCalled()
    })

    it('is allowed after the drop notice, until the start', async () => {
      await service.offerSwap(RIDER, 'booking-1', new Date('2026-11-06T16:59:59.999Z'))
      expect(bookings.updateIf).toHaveBeenCalledTimes(1)
    })

    it('409 "This slot was removed. You can still drop it." on a removed slot', async () => {
      bookings.findBooking.mockResolvedValue(
        booking({ shiftSlot: { ...friSlot, removedAt: new Date('2026-11-02T00:00:00.000Z') } })
      )
      expect(await refusal(service.offerSwap(RIDER, 'booking-1', now))).toEqual({
        type: ConflictException,
        message: 'This slot was removed. You can still drop it.',
      })
      expect(bookings.updateIf).not.toHaveBeenCalled()
    })

    it("404 for another rider's booking", async () => {
      bookings.findBooking.mockResolvedValue(booking({ courierId: 'someone-else' }))
      expect((await refusal(service.offerSwap(RIDER, 'booking-1', now))).type).toBe(NotFoundException)
    })

    it('an already offered booking is a no op: no write, no event, the booking answered', async () => {
      bookings.findBooking.mockResolvedValue(booking({ swapOfferedAt: new Date('2026-11-02T00:00:00.000Z') }))
      const result = await service.offerSwap(RIDER, 'booking-1', now)
      expect(bookings.transaction).not.toHaveBeenCalled()
      expect(bookings.updateIf).not.toHaveBeenCalled()
      expect(bookings.event).not.toHaveBeenCalled()
      expect(result.swapOfferedAt).toEqual(new Date('2026-11-02T00:00:00.000Z'))
    })

    it('is a conditional write on (id, rider, BOOKED, not offered) and writes SWAP_OFFERED', async () => {
      await service.offerSwap(RIDER, 'booking-1', now)
      expect(bookings.updateIf).toHaveBeenCalledWith(
        tx,
        { id: 'booking-1', courierId: RIDER, status: EnumShiftBookingStatus.BOOKED, swapOfferedAt: null },
        { swapOfferedAt: now }
      )
      expect(bookings.event).toHaveBeenCalledWith(tx, 'booking-1', EnumShiftBookingEventType.SWAP_OFFERED, RIDER)
    })

    it('409 on a lost write, with no event', async () => {
      bookings.updateIf.mockResolvedValue(false)
      expect(await refusal(service.offerSwap(RIDER, 'booking-1', now))).toEqual({
        type: ConflictException,
        message: 'This booking is no longer yours to change.',
      })
      expect(bookings.event).not.toHaveBeenCalled()
    })
  })

  describe('AC-5, AC-7: withdrawSwap', () => {
    const offered = () => booking({ swapOfferedAt: new Date('2026-11-02T00:00:00.000Z') })

    it('nothing offered is a no op: no write, no event', async () => {
      await service.withdrawSwap(RIDER, 'booking-1', now)
      expect(bookings.transaction).not.toHaveBeenCalled()
      expect(bookings.updateIf).not.toHaveBeenCalled()
      expect(bookings.event).not.toHaveBeenCalled()
    })

    it('is a conditional write on (id, rider, BOOKED, offered) and writes SWAP_WITHDRAWN', async () => {
      bookings.findBooking.mockResolvedValue(offered())
      await service.withdrawSwap(RIDER, 'booking-1', now)
      expect(bookings.updateIf).toHaveBeenCalledWith(
        tx,
        { id: 'booking-1', courierId: RIDER, status: EnumShiftBookingStatus.BOOKED, swapOfferedAt: { not: null } },
        { swapOfferedAt: null }
      )
      expect(bookings.event).toHaveBeenCalledWith(tx, 'booking-1', EnumShiftBookingEventType.SWAP_WITHDRAWN, RIDER)
    })

    it('409 "This booking is no longer yours to change." when the swap was taken in between', async () => {
      bookings.findBooking.mockResolvedValue(offered())
      bookings.updateIf.mockResolvedValue(false)
      expect(await refusal(service.withdrawSwap(RIDER, 'booking-1', now))).toEqual({
        type: ConflictException,
        message: 'This booking is no longer yours to change.',
      })
      expect(bookings.event).not.toHaveBeenCalled()
    })

    it("a removed slot's open offer can still be withdrawn", async () => {
      bookings.findBooking.mockResolvedValue(
        booking({
          swapOfferedAt: new Date('2026-11-02T00:00:00.000Z'),
          shiftSlot: { ...friSlot, removedAt: new Date('2026-11-02T00:00:00.000Z') },
        })
      )
      await service.withdrawSwap(RIDER, 'booking-1', now)
      expect(bookings.updateIf).toHaveBeenCalledTimes(1)
    })

    it("404 for another rider's booking", async () => {
      bookings.findBooking.mockResolvedValue(booking({ courierId: 'someone-else', swapOfferedAt: now }))
      expect((await refusal(service.withdrawSwap(RIDER, 'booking-1', now))).type).toBe(NotFoundException)
      expect(bookings.updateIf).not.toHaveBeenCalled()
    })
  })

  describe('AC-5, AC-6, AC-7, AC-11: take', () => {
    const openSwap = (overrides: Record<string, unknown> = {}) =>
      booking({
        id: 'swap-1',
        courierId: GIVER,
        capAtBooking: 3,
        swapOfferedAt: new Date('2026-11-02T00:00:00.000Z'),
        ...overrides,
      })

    beforeEach(() => {
      bookings.findBooking.mockImplementation((id: string) =>
        Promise.resolve(id === 'swap-1' ? openSwap() : booking({ id, courierId: RIDER }))
      )
    })

    it.each([
      ['an unknown booking', null],
      ['a booking with no open offer', 'no-offer'],
      ['an ended booking', 'ended'],
    ])('404 "No open swap here." for %s', async (_case, kind) => {
      bookings.findBooking.mockResolvedValue(
        kind === null
          ? null
          : kind === 'no-offer'
          ? openSwap({ swapOfferedAt: null })
          : openSwap({ status: EnumShiftBookingStatus.SWAPPED_AWAY })
      )
      expect(await refusal(service.take(RIDER, 'swap-1', now))).toEqual({
        type: NotFoundException,
        message: 'No open swap here.',
      })
      expect(bookings.transaction).not.toHaveBeenCalled()
    })

    it('409 "You can\'t take your own swap."', async () => {
      bookings.findBooking.mockResolvedValue(openSwap({ courierId: RIDER }))
      expect(await refusal(service.take(RIDER, 'swap-1', now))).toEqual({
        type: ConflictException,
        message: "You can't take your own swap.",
      })
      expect(bookings.transaction).not.toHaveBeenCalled()
    })

    it('409 "This shift has already started." at the start', async () => {
      bookings.findBooking.mockResolvedValue(openSwap({ startsAt: now }))
      expect(await refusal(service.take(RIDER, 'swap-1', now))).toEqual({
        type: ConflictException,
        message: 'This shift has already started.',
      })
      expect(bookings.transaction).not.toHaveBeenCalled()
    })

    it("takes the taker's rider lock, then the occurrence lock, before the overlap check and the writes", async () => {
      await service.take(RIDER, 'swap-1', now)
      expect(bookings.lockRider).toHaveBeenCalledWith(tx, RIDER)
      expect(bookings.lockOccurrence).toHaveBeenCalledWith(tx, 'slot-fri', '2026-11-06')
      const inTx = calls.slice(calls.indexOf('transaction'))
      expect(inTx.slice(0, 3)).toEqual(['transaction', 'lockRider', 'lockOccurrence'])
      expect(inTx.indexOf('overlapping')).toBeGreaterThan(inTx.indexOf('lockOccurrence'))
      expect(inTx.indexOf('updateIf')).toBeGreaterThan(inTx.indexOf('lockOccurrence'))
    })

    it('409 "You already have a shift at that time." on an overlap with the swap\'s snapshot times', async () => {
      bookings.overlapping.mockResolvedValue(booking({ id: 'mine' }))
      expect(await refusal(service.take(RIDER, 'swap-1', now))).toEqual({
        type: ConflictException,
        message: 'You already have a shift at that time.',
      })
      expect(bookings.overlapping).toHaveBeenCalledWith(
        tx,
        RIDER,
        new Date('2026-11-06T17:00:00.000Z'),
        new Date('2026-11-06T21:00:00.000Z')
      )
      expect(bookings.updateIf).not.toHaveBeenCalled()
      expect(bookings.createBooking).not.toHaveBeenCalled()
    })

    it("ends the giver's booking with a conditional write (BOOKED and still offered) as SWAPPED_AWAY", async () => {
      await service.take(RIDER, 'swap-1', now)
      expect(bookings.updateIf).toHaveBeenCalledTimes(1)
      expect(bookings.updateIf).toHaveBeenCalledWith(
        tx,
        { id: 'swap-1', status: EnumShiftBookingStatus.BOOKED, swapOfferedAt: { not: null } },
        { status: EnumShiftBookingStatus.SWAPPED_AWAY, endedAt: now, swapOfferedAt: null }
      )
    })

    it('409 "This swap was just taken." on a miss, with no event and no new booking', async () => {
      bookings.updateIf.mockResolvedValue(false)
      expect(await refusal(service.take(RIDER, 'swap-1', now))).toEqual({
        type: ConflictException,
        message: 'This swap was just taken.',
      })
      expect(bookings.event).not.toHaveBeenCalled()
      expect(bookings.createBooking).not.toHaveBeenCalled()
    })

    it("records SWAP_TAKEN on the giver's booking, by the giver, with otherCourierId = the taker", async () => {
      await service.take(RIDER, 'swap-1', now)
      expect(bookings.event).toHaveBeenCalledTimes(1)
      expect(bookings.event).toHaveBeenCalledWith(tx, 'swap-1', EnumShiftBookingEventType.SWAP_TAKEN, GIVER, RIDER)
    })

    it("creates the taker's booking from the giver's snapshot, never from the slot (even if the slot changed), with BOOKED and otherCourierId = the giver", async () => {
      // The slot was edited since: other minutes and another cap. The taker must still get the snapshot.
      slots.findById.mockResolvedValue({ ...friSlot, startMinute: 600, endMinute: 900, riderCap: 9 })
      slots.list.mockResolvedValue([{ ...friSlot, startMinute: 600, endMinute: 900, riderCap: 9 }])
      await service.take(RIDER, 'swap-1', now)
      expect(bookings.createBooking).toHaveBeenCalledWith(
        tx,
        {
          shiftSlotId: 'slot-fri',
          courierId: RIDER,
          date: '2026-11-06',
          startsAt: new Date('2026-11-06T17:00:00.000Z'),
          endsAt: new Date('2026-11-06T21:00:00.000Z'),
          capAtBooking: 3,
        },
        { otherCourierId: GIVER }
      )
      expect(calls.indexOf('createBooking')).toBeGreaterThan(calls.indexOf('event'))
    })

    it('copies a snapshot that no slot could give today (a removed slot with other times)', async () => {
      bookings.findBooking.mockImplementation((id: string) =>
        Promise.resolve(
          id === 'swap-1'
            ? openSwap({
                startsAt: new Date('2026-11-06T16:15:00.000Z'),
                endsAt: new Date('2026-11-06T20:45:00.000Z'),
                shiftSlot: { ...friSlot, removedAt: new Date('2026-11-04T00:00:00.000Z') },
              })
            : booking({ id })
        )
      )
      slots.findById.mockResolvedValue(null)
      await service.take(RIDER, 'swap-1', now)
      const [, data] = bookings.createBooking.mock.calls[0]
      expect(data.startsAt).toEqual(new Date('2026-11-06T16:15:00.000Z'))
      expect(data.endsAt).toEqual(new Date('2026-11-06T20:45:00.000Z'))
    })

    it("answers the taker's new booking", async () => {
      const result = await service.take(RIDER, 'swap-1', now)
      expect(bookings.findBooking).toHaveBeenLastCalledWith('booking-new')
      expect(result.id).toBe('booking-new')
    })
  })
})
