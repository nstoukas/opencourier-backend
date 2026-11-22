import { ConflictException, NotFoundException as NestNotFoundException } from '@nestjs/common'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import * as errors from 'src/errors'
import { BullMQService } from 'src/integrations/bullMQ/bullMQ.service'
import { ShiftBookingRepository } from 'src/persistence/repositories/shift-booking.repository'
import { CacheService } from 'src/services/cache/cache.service'
import { TaskBusService } from 'src/services/taskBus/taskBus.service'
import { OFFLINE_EVENT_SENTENCES, SHIFT_OFFLINE_WATERMARK_KEY, ShiftOfflineService } from './shift-offline.service'

// Spec 0049 (row 79; AC-4, AC-6, cross check 1 to 3; decision 79.3): the minute sweep that records an
// Offline during a booked shift, the admin list and the follow up. Written from the spec, with the
// repository, the settings and the queue mocked. No SQL and no Redis.
describe('ShiftOfflineService (spec 0049)', () => {
  // 22:00 Athens on Fri 20 Nov 2026. The break limit is 30 minutes.
  const now = new Date('2026-11-20T20:00:00.000Z')
  const BREAK_MINUTES = 30

  // A booked shift 20:00 to 24:00 Athens.
  const booking = {
    id: 'booking-1',
    courierId: 'rider-1',
    startsAt: new Date('2026-11-20T18:00:00.000Z'),
    endsAt: new Date('2026-11-20T22:00:00.000Z'),
  }

  function change(overrides: Record<string, unknown> = {}) {
    return {
      id: 'change-1',
      courierId: 'rider-1',
      cause: 'RIDER',
      adminUserId: null as string | null,
      // 21:10 Athens: 50 minutes before `now`, so the 30 minute break limit has passed.
      createdAt: new Date('2026-11-20T19:10:00.000Z'),
      ...overrides,
    }
  }

  let bookings: {
    offlineChangesWithoutEvent: jest.Mock
    shiftsLastSwitchedOnAt: jest.Mock
    leftOfflineBetween: jest.Mock
    bookedCovering: jest.Mock
    createOfflineEvent: jest.Mock
    offlineEventsForAdmin: jest.Mock
    markFollowedUp: jest.Mock
  }
  let instanceConfig: { getShiftsEnabled: jest.Mock; getShiftBreakMinutes: jest.Mock }
  let bullMQ: { addRepeatableJob: jest.Mock }
  let taskBus: { registerTaskHandler: jest.Mock }
  let cacheStore: Map<string, string>
  let cacheService: { get: jest.Mock; save: jest.Mock }
  let service: ShiftOfflineService

  beforeEach(() => {
    bookings = {
      offlineChangesWithoutEvent: jest.fn().mockResolvedValue([change()]),
      // No switch on recorded: Shifts has been on since setup.
      shiftsLastSwitchedOnAt: jest.fn().mockResolvedValue(null),
      leftOfflineBetween: jest.fn().mockResolvedValue(false),
      bookedCovering: jest.fn().mockResolvedValue(booking),
      createOfflineEvent: jest.fn().mockResolvedValue(true),
      offlineEventsForAdmin: jest.fn().mockResolvedValue([]),
      markFollowedUp: jest.fn().mockResolvedValue('done'),
    }
    instanceConfig = {
      getShiftsEnabled: jest.fn().mockResolvedValue(true),
      getShiftBreakMinutes: jest.fn().mockResolvedValue(BREAK_MINUTES),
    }
    bullMQ = { addRepeatableJob: jest.fn().mockResolvedValue(undefined) }
    taskBus = { registerTaskHandler: jest.fn() }
    cacheStore = new Map()
    cacheService = {
      get: jest.fn().mockImplementation(async (key: string) => cacheStore.get(key) ?? null),
      save: jest.fn().mockImplementation(async (key: string, value: string) => {
        cacheStore.set(key, value)
      }),
    }
    service = new ShiftOfflineService(
      bookings as unknown as ShiftBookingRepository,
      { instanceConfig } as unknown as ConfigDomainService,
      bullMQ as unknown as BullMQService,
      taskBus as unknown as TaskBusService,
      cacheService as unknown as CacheService
    )
  })

  describe('the sweep (AC-4, cross check 1 and 2)', () => {
    test('shifts off: does nothing at all, reads no status change and writes nothing', async () => {
      instanceConfig.getShiftsEnabled.mockResolvedValue(false)
      expect(await service.sweep(now)).toBe(0)
      expect(bookings.offlineChangesWithoutEvent).not.toHaveBeenCalled()
      expect(bookings.bookedCovering).not.toHaveBeenCalled()
      expect(bookings.createOfflineEvent).not.toHaveBeenCalled()
    })

    test('looks only at Offline changes whose break limit has passed', async () => {
      await service.sweep(now)
      expect(bookings.offlineChangesWithoutEvent).toHaveBeenCalledTimes(1)
      const [from, upTo] = bookings.offlineChangesWithoutEvent.mock.calls[0] as [Date, Date]
      // A change newer than now minus the break limit could still be a break.
      expect(upTo).toEqual(new Date('2026-11-20T19:30:00.000Z'))
      expect(from.getTime()).toBeLessThan(upTo.getTime())
    })

    test('the break limit is the co-op setting, read on each sweep', async () => {
      instanceConfig.getShiftBreakMinutes.mockResolvedValue(0)
      await service.sweep(now)
      expect((bookings.offlineChangesWithoutEvent.mock.calls[0] as [Date, Date])[1]).toEqual(now)
      // An hour later, with a 45 minute limit: upTo is 20:15 (21:00 minus 45 min), advancing past the watermark.
      instanceConfig.getShiftBreakMinutes.mockResolvedValue(45)
      const later = new Date(now.getTime() + 60 * 60_000)
      await service.sweep(later)
      expect((bookings.offlineChangesWithoutEvent.mock.calls[1] as [Date, Date])[1]).toEqual(
        new Date('2026-11-20T20:15:00.000Z')
      )
    })

    // Review ruling 1 (2026-11-21): Shifts off then on must not record Offline changes from while it was
    // off. The window starts at the later of (now - break - 6 h) and the last time Shifts was switched on.
    describe('the window never reaches back before Shifts was last switched on (review ruling 1)', () => {
      // now 20:00Z, break 30 min: the window ends 19:30Z and, on the 6 hour rule alone, starts 13:30Z.
      const sixHourStart = new Date('2026-11-20T13:30:00.000Z')
      const windowEnd = new Date('2026-11-20T19:30:00.000Z')

      function windowAsked(call = 0): [Date, Date] {
        return bookings.offlineChangesWithoutEvent.mock.calls[call] as [Date, Date]
      }

      test('no switch on recorded: the 6 hour window stands', async () => {
        bookings.shiftsLastSwitchedOnAt.mockResolvedValue(null)
        await service.sweep(now)
        expect(windowAsked()).toEqual([sixHourStart, windowEnd])
      })

      test('switched on inside the 6 hours: the window starts at the switch on, so an earlier Offline is never asked for', async () => {
        const switchedOnAt = new Date('2026-11-20T18:00:00.000Z')
        bookings.shiftsLastSwitchedOnAt.mockResolvedValue(switchedOnAt)
        await service.sweep(now)
        const [from, upTo] = windowAsked()
        expect(from).toEqual(switchedOnAt)
        expect(upTo).toEqual(windowEnd)
        // A rider who went Offline at 17:00Z, while Shifts was off, is outside what the sweep asks for.
        const offlineWhileOff = new Date('2026-11-20T17:00:00.000Z')
        expect(offlineWhileOff.getTime()).toBeLessThan(from.getTime())
        expect(bookings.offlineChangesWithoutEvent).toHaveBeenCalledTimes(1)
      })

      test('switched on longer ago than the 6 hours: the 6 hour window stands', async () => {
        bookings.shiftsLastSwitchedOnAt.mockResolvedValue(new Date('2026-11-20T10:00:00.000Z'))
        await service.sweep(now)
        expect(windowAsked()).toEqual([sixHourStart, windowEnd])
      })

      test('switched on a millisecond after the 6 hour start: the switch on wins', async () => {
        const justAfter = new Date(sixHourStart.getTime() + 1)
        bookings.shiftsLastSwitchedOnAt.mockResolvedValue(justAfter)
        await service.sweep(now)
        expect(windowAsked()[0]).toEqual(justAfter)
      })

      test('the 6 hours are counted back from now minus the break limit in force', async () => {
        instanceConfig.getShiftBreakMinutes.mockResolvedValue(0)
        // Later than 14:00Z (now - 0 - 6 h)? No: 13:45Z is earlier, so the 6 hour start stands.
        bookings.shiftsLastSwitchedOnAt.mockResolvedValue(new Date('2026-11-20T13:45:00.000Z'))
        await service.sweep(now)
        expect(windowAsked()).toEqual([new Date('2026-11-20T14:00:00.000Z'), now])
      })

      test('switched on after the window ends (within the last break limit): nothing from before it is asked for', async () => {
        const switchedOnAt = new Date('2026-11-20T19:45:00.000Z')
        bookings.shiftsLastSwitchedOnAt.mockResolvedValue(switchedOnAt)
        // With from (19:45) > upTo (19:30), the sweep returns 0 and does not query the repository.
        expect(await service.sweep(now)).toBe(0)
        expect(bookings.offlineChangesWithoutEvent).not.toHaveBeenCalled()
      })

      test('the switch on time is read afresh on every sweep', async () => {
        bookings.shiftsLastSwitchedOnAt.mockResolvedValueOnce(null)
        await service.sweep(now)
        // Shifts switched on after the first sweep's watermark (19:30); second sweep runs at 20:15 (upTo = 19:45).
        const switchedOnAt = new Date('2026-11-20T19:40:00.000Z')
        bookings.shiftsLastSwitchedOnAt.mockResolvedValueOnce(switchedOnAt)
        const later = new Date(now.getTime() + 15 * 60_000)
        await service.sweep(later)
        expect(bookings.shiftsLastSwitchedOnAt).toHaveBeenCalledTimes(2)
        expect(windowAsked(0)[0]).toEqual(sixHourStart)
        expect(windowAsked(1)[0]).toEqual(switchedOnAt)
      })
    })

    test('a rider Offline during a booked shift and still Offline past the break: one open record, cause RIDER', async () => {
      expect(await service.sweep(now)).toBe(1)
      expect(bookings.createOfflineEvent).toHaveBeenCalledTimes(1)
      expect(bookings.createOfflineEvent).toHaveBeenCalledWith({
        shiftBookingId: 'booking-1',
        courierId: 'rider-1',
        courierStatusChangeId: 'change-1',
        cause: 'RIDER',
        offlineAt: new Date('2026-11-20T19:10:00.000Z'),
        followedUpAt: null,
        followedUpByUserId: null,
      })
    })

    test('asks whether the rider came back within the break of that change, and which booking covered that moment', async () => {
      await service.sweep(now)
      expect(bookings.leftOfflineBetween).toHaveBeenCalledWith(
        'rider-1',
        new Date('2026-11-20T19:10:00.000Z'),
        new Date('2026-11-20T19:40:00.000Z')
      )
      // The booking is looked up at the Offline moment, not at the time the sweep runs.
      expect(bookings.bookedCovering).toHaveBeenCalledWith('rider-1', new Date('2026-11-20T19:10:00.000Z'))
    })

    test('back Online within the break: nothing written', async () => {
      bookings.leftOfflineBetween.mockResolvedValue(true)
      expect(await service.sweep(now)).toBe(0)
      expect(bookings.createOfflineEvent).not.toHaveBeenCalled()
    })

    test('no booked shift covering the moment: nothing written', async () => {
      bookings.bookedCovering.mockResolvedValue(null)
      expect(await service.sweep(now)).toBe(0)
      expect(bookings.createOfflineEvent).not.toHaveBeenCalled()
    })

    test('Offline in the last 10 minutes of the shift: nothing written', async () => {
      // 23:52 Athens, in a shift that ends at 24:00. Swept an hour later.
      bookings.offlineChangesWithoutEvent.mockResolvedValue([
        change({ createdAt: new Date('2026-11-20T21:52:00.000Z') }),
      ])
      expect(await service.sweep(new Date('2026-11-20T23:00:00.000Z'))).toBe(0)
      expect(bookings.createOfflineEvent).not.toHaveBeenCalled()
    })

    test('11 minutes before the end is still recorded', async () => {
      bookings.offlineChangesWithoutEvent.mockResolvedValue([
        change({ createdAt: new Date('2026-11-20T21:49:00.000Z') }),
      ])
      expect(await service.sweep(new Date('2026-11-20T23:00:00.000Z'))).toBe(1)
    })

    test("an admin's change is written already followed up by that admin, at the time of the sweep", async () => {
      bookings.offlineChangesWithoutEvent.mockResolvedValue([change({ cause: 'ADMIN', adminUserId: 'admin-9' })])
      expect(await service.sweep(now)).toBe(1)
      expect(bookings.createOfflineEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          cause: 'ADMIN',
          // The record is about the booking's rider, whatever the cause.
          courierId: 'rider-1',
          followedUpAt: now,
          followedUpByUserId: 'admin-9',
        })
      )
    })

    test('an ADMIN cause with no admin recorded stays open (nobody to name)', async () => {
      bookings.offlineChangesWithoutEvent.mockResolvedValue([change({ cause: 'ADMIN', adminUserId: null })])
      await service.sweep(now)
      expect(bookings.createOfflineEvent).toHaveBeenCalledWith(
        expect.objectContaining({ cause: 'ADMIN', followedUpAt: null, followedUpByUserId: null })
      )
    })

    test.each(['CUT_OFF', 'RIDER', 'LAST_CALL_ACCEPTED', 'SYSTEM_START'])(
      'a %s change is written open, even when the status record names an admin',
      async (cause) => {
        // A cut off comes from an admin's password change, yet it is open (cross check 2).
        bookings.offlineChangesWithoutEvent.mockResolvedValue([change({ cause, adminUserId: 'admin-9' })])
        expect(await service.sweep(now)).toBe(1)
        expect(bookings.createOfflineEvent).toHaveBeenCalledWith(
          expect.objectContaining({ cause, followedUpAt: null, followedUpByUserId: null })
        )
      }
    )

    test('writes once per change: one create for each change, each with its own status change id', async () => {
      bookings.offlineChangesWithoutEvent.mockResolvedValue([
        change({ id: 'change-1' }),
        change({ id: 'change-2', courierId: 'rider-2', createdAt: new Date('2026-11-20T19:20:00.000Z') }),
      ])
      bookings.bookedCovering.mockImplementation((courierId: string) =>
        Promise.resolve({ ...booking, id: `booking-of-${courierId}`, courierId })
      )
      expect(await service.sweep(now)).toBe(2)
      expect(bookings.createOfflineEvent).toHaveBeenCalledTimes(2)
      expect(
        bookings.createOfflineEvent.mock.calls.map(([data]) => [
          data.courierStatusChangeId,
          data.courierId,
          data.shiftBookingId,
        ])
      ).toEqual([
        ['change-1', 'rider-1', 'booking-of-rider-1'],
        ['change-2', 'rider-2', 'booking-of-rider-2'],
      ])
    })

    test('a change that already has its record is not offered again, so the next sweep writes nothing', async () => {
      bookings.offlineChangesWithoutEvent.mockResolvedValueOnce([change()]).mockResolvedValueOnce([])
      expect(await service.sweep(now)).toBe(1)
      expect(await service.sweep(new Date(now.getTime() + 60_000))).toBe(0)
      expect(bookings.createOfflineEvent).toHaveBeenCalledTimes(1)
    })

    test('a unique conflict (another server wrote it first) is not an error and is not counted', async () => {
      // The repository answers false for a refused second insert.
      bookings.createOfflineEvent.mockResolvedValue(false)
      const logged = jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined)
      await expect(service.sweep(now)).resolves.toBe(0)
      expect(logged).not.toHaveBeenCalled()
    })

    test('one failing change does not stop the others, and is logged by its id', async () => {
      bookings.offlineChangesWithoutEvent.mockResolvedValue([
        change({ id: 'change-bad', courierId: 'rider-bad' }),
        change({ id: 'change-good', courierId: 'rider-good' }),
      ])
      bookings.bookedCovering.mockImplementation((courierId: string) =>
        courierId === 'rider-bad' ? Promise.reject(new Error('read failed')) : Promise.resolve(booking)
      )
      const logged = jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined)
      await expect(service.sweep(now)).resolves.toBe(1)
      expect(bookings.createOfflineEvent).toHaveBeenCalledTimes(1)
      expect(bookings.createOfflineEvent).toHaveBeenCalledWith(
        expect.objectContaining({ courierStatusChangeId: 'change-good' })
      )
      expect(logged).toHaveBeenCalledTimes(1)
      expect(String(logged.mock.calls[0]![0])).toContain('change-bad')
    })

    test('a failing write does not stop the others either', async () => {
      bookings.offlineChangesWithoutEvent.mockResolvedValue([change({ id: 'change-a' }), change({ id: 'change-b' })])
      bookings.createOfflineEvent.mockRejectedValueOnce(new Error('insert failed')).mockResolvedValueOnce(true)
      jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined)
      await expect(service.sweep(now)).resolves.toBe(1)
      expect(bookings.createOfflineEvent).toHaveBeenCalledTimes(2)
    })

    test('no changes: nothing read further, nothing written', async () => {
      bookings.offlineChangesWithoutEvent.mockResolvedValue([])
      expect(await service.sweep(now)).toBe(0)
      expect(bookings.bookedCovering).not.toHaveBeenCalled()
      expect(bookings.createOfflineEvent).not.toHaveBeenCalled()
    })
  })

  describe('judging each change once via Redis watermark (row 79 review fix, decision OR.2)', () => {
    test('a change whose rider came back after 20 minutes is skipped under a 30 minute limit; the limit is then set to 10 and the sweep runs again; assert no event is written', async () => {
      const offlineAt = new Date('2026-11-20T19:10:00.000Z')
      instanceConfig.getShiftBreakMinutes.mockResolvedValue(30)
      // Rider came back after 20 minutes (at 19:30): leftOfflineBetween returns true if break window reaches 19:30.
      bookings.leftOfflineBetween.mockImplementation((_courierId: string, _from: Date, to: Date) =>
        Promise.resolve(to.getTime() >= new Date('2026-11-20T19:30:00.000Z').getTime())
      )
      // Repository returns the change only when its timestamp falls in the queried window [from, upTo].
      bookings.offlineChangesWithoutEvent.mockImplementation((from: Date, upTo: Date) => {
        if (offlineAt.getTime() >= from.getTime() && offlineAt.getTime() <= upTo.getTime()) {
          return Promise.resolve([change({ createdAt: offlineAt })])
        }
        return Promise.resolve([])
      })

      // Sweep 1 at 19:40: upTo is 19:10 (19:40 - 30 min). The change at 19:10 is evaluated.
      // Under the 30-min break limit (breakEnds = 19:40), rider returned at 19:30, so it counts as a valid break.
      const sweep1Time = new Date('2026-11-20T19:40:00.000Z')
      expect(await service.sweep(sweep1Time)).toBe(0)
      expect(bookings.createOfflineEvent).not.toHaveBeenCalled()
      expect(cacheStore.get(SHIFT_OFFLINE_WATERMARK_KEY)).toBe(new Date('2026-11-20T19:10:00.000Z').toISOString())

      // Break limit is lowered to 10 minutes.
      instanceConfig.getShiftBreakMinutes.mockResolvedValue(10)

      // Sweep 2 at 19:41: upTo is 19:31 (19:41 - 10 min).
      // Because the watermark is 19:10, from is 19:10:00.001Z. The change at 19:10:00.000Z is skipped.
      const sweep2Time = new Date('2026-11-20T19:41:00.000Z')
      expect(await service.sweep(sweep2Time)).toBe(0)
      // Assert no event was written across either sweep!
      expect(bookings.createOfflineEvent).not.toHaveBeenCalled()
    })

    test('persists the judged watermark in Redis with key, ISO string and 24-hour TTL', async () => {
      await service.sweep(now)
      const expectedUpTo = new Date('2026-11-20T19:30:00.000Z').toISOString()
      expect(cacheService.save).toHaveBeenCalledWith(SHIFT_OFFLINE_WATERMARK_KEY, expectedUpTo, 24 * 3600)
      expect(cacheStore.get(SHIFT_OFFLINE_WATERMARK_KEY)).toBe(expectedUpTo)
    })

    test('a raised limit leaves the window empty until upTo passes the watermark', async () => {
      // Sweep 1: 10 minute limit at 20:00 => upTo = 19:50. Watermark saved as 19:50.
      instanceConfig.getShiftBreakMinutes.mockResolvedValue(10)
      await service.sweep(now)
      expect(cacheStore.get(SHIFT_OFFLINE_WATERMARK_KEY)).toBe(new Date('2026-11-20T19:50:00.000Z').toISOString())

      // Limit is raised to 60 minutes.
      instanceConfig.getShiftBreakMinutes.mockResolvedValue(60)
      bookings.offlineChangesWithoutEvent.mockClear()

      // At 20:05: upTo = 20:05 - 60 min = 19:05. Watermark is 19:50, so from (19:50:00.001Z) > upTo (19:05).
      // Sweep returns 0 immediately without querying changes.
      expect(await service.sweep(new Date('2026-11-20T20:05:00.000Z'))).toBe(0)
      expect(bookings.offlineChangesWithoutEvent).not.toHaveBeenCalled()

      // At 20:55: upTo = 20:55 - 60 min = 19:55. Watermark is 19:50, so from is 19:50:00.001Z <= upTo (19:55).
      expect(await service.sweep(new Date('2026-11-20T20:55:00.000Z'))).toBe(1)
      expect(bookings.offlineChangesWithoutEvent).toHaveBeenCalledWith(
        new Date('2026-11-20T19:50:00.001Z'),
        new Date('2026-11-20T19:55:00.000Z')
      )
    })

    test('a change whose check throws holds the watermark 1 ms before it so the next tick retries it', async () => {
      const change1 = change({ id: 'change-fail', createdAt: new Date('2026-11-20T19:05:00.000Z') })
      const change2 = change({ id: 'change-ok', createdAt: new Date('2026-11-20T19:15:00.000Z') })
      bookings.offlineChangesWithoutEvent.mockResolvedValue([change1, change2])

      // Change 1 throws an error during processing.
      bookings.bookedCovering.mockImplementation((courierId: string, at: Date) => {
        if (at.getTime() === change1.createdAt.getTime()) return Promise.reject(new Error('db error'))
        return Promise.resolve(booking)
      })
      jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined)

      // Sweep processes change2 (change1 threw), so 1 event is written.
      expect(await service.sweep(now)).toBe(1)

      // Watermark is held 1 ms before the earliest failed change (19:05 - 1 ms = 19:04:59.999Z), NOT upTo (19:30).
      expect(cacheStore.get(SHIFT_OFFLINE_WATERMARK_KEY)).toBe(new Date('2026-11-20T19:04:59.999Z').toISOString())

      // Next tick (now + 1 min): from starts at watermark + 1 ms = 19:05:00.000Z, retrying change 1.
      bookings.offlineChangesWithoutEvent.mockClear()
      bookings.bookedCovering.mockResolvedValue(booking)
      await service.sweep(new Date(now.getTime() + 60_000))
      expect(bookings.offlineChangesWithoutEvent).toHaveBeenCalledWith(
        new Date('2026-11-20T19:05:00.000Z'),
        new Date('2026-11-20T19:31:00.000Z')
      )
    })

    test('if earlier changes succeed and a later change fails, watermark advances up to 1 ms before the failed change', async () => {
      const change1 = change({ id: 'change-ok', createdAt: new Date('2026-11-20T19:10:00.000Z') })
      const change2 = change({ id: 'change-fail', createdAt: new Date('2026-11-20T19:20:00.000Z') })
      bookings.offlineChangesWithoutEvent.mockResolvedValue([change1, change2])

      // Change 2 throws an error.
      bookings.bookedCovering.mockImplementation((courierId: string, at: Date) => {
        if (at.getTime() === change2.createdAt.getTime()) return Promise.reject(new Error('db error'))
        return Promise.resolve(booking)
      })
      jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined)

      expect(await service.sweep(now)).toBe(1)

      // Watermark is held 1 ms before change 2 (19:20 - 1 ms = 19:19:59.999Z).
      expect(cacheStore.get(SHIFT_OFFLINE_WATERMARK_KEY)).toBe(new Date('2026-11-20T19:19:59.999Z').toISOString())

      // Next tick: from starts at 19:20:00.000Z, so change 1 is not repeated and change 2 is retried.
      bookings.offlineChangesWithoutEvent.mockClear()
      await service.sweep(new Date(now.getTime() + 60_000))
      expect(bookings.offlineChangesWithoutEvent).toHaveBeenCalledWith(
        new Date('2026-11-20T19:20:00.000Z'),
        new Date('2026-11-20T19:31:00.000Z')
      )
    })

    test('without a watermark (first run or expired), the lookback window starts at 6 hours ago or switch-on time', async () => {
      cacheStore.clear()
      await service.sweep(now)
      const [from, upTo] = bookings.offlineChangesWithoutEvent.mock.calls[0] as [Date, Date]
      expect(from).toEqual(new Date('2026-11-20T13:30:00.000Z'))
      expect(upTo).toEqual(new Date('2026-11-20T19:30:00.000Z'))
    })

    test('if Shifts was switched on after the watermark, the switch-on time wins', async () => {
      cacheStore.set(SHIFT_OFFLINE_WATERMARK_KEY, new Date('2026-11-20T19:30:00.000Z').toISOString())
      const switchedOnAt = new Date('2026-11-20T19:40:00.000Z')
      bookings.shiftsLastSwitchedOnAt.mockResolvedValue(switchedOnAt)

      const later = new Date('2026-11-20T20:15:00.000Z')
      await service.sweep(later)
      expect(bookings.offlineChangesWithoutEvent).toHaveBeenCalledWith(
        switchedOnAt,
        new Date('2026-11-20T19:45:00.000Z')
      )
    })

    test('if Shifts was switched on before the watermark, the watermark wins', async () => {
      cacheStore.set(SHIFT_OFFLINE_WATERMARK_KEY, new Date('2026-11-20T19:30:00.000Z').toISOString())
      const switchedOnAt = new Date('2026-11-20T19:00:00.000Z')
      bookings.shiftsLastSwitchedOnAt.mockResolvedValue(switchedOnAt)

      const later = new Date('2026-11-20T20:05:00.000Z')
      await service.sweep(later)
      expect(bookings.offlineChangesWithoutEvent).toHaveBeenCalledWith(
        new Date('2026-11-20T19:30:00.001Z'),
        new Date('2026-11-20T19:35:00.000Z')
      )
    })
  })

  describe('the minute job (decision 79.3)', () => {
    test('registers a handler for shift-offline-sweep that runs the sweep', async () => {
      expect(taskBus.registerTaskHandler).toHaveBeenCalledTimes(1)
      const [name, handler] = taskBus.registerTaskHandler.mock.calls[0] as [string, () => Promise<void>]
      expect(name).toBe('shift-offline-sweep')
      await handler()
      expect(bookings.offlineChangesWithoutEvent).toHaveBeenCalledTimes(1)
    })

    test('is scheduled as a repeatable job every minute under the same name', async () => {
      await service.schedule()
      expect(bullMQ.addRepeatableJob).toHaveBeenCalledWith('shift-offline-sweep', {}, '* * * * *')
    })

    test('a queue that cannot be reached does not throw at startup', async () => {
      bullMQ.addRepeatableJob.mockRejectedValue(new Error('redis down'))
      jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined)
      await expect(service.schedule()).resolves.toBeUndefined()
      expect(() => service.onModuleInit()).not.toThrow()
    })
  })

  describe('the admin list (AC-6, cross check 3)', () => {
    test('asks for open items plus those followed up within the last 7 days, and returns them as given', async () => {
      const items = [{ id: 'event-2' }, { id: 'event-1' }]
      bookings.offlineEventsForAdmin.mockResolvedValue(items)
      const result = await service.adminList(now)
      expect(bookings.offlineEventsForAdmin).toHaveBeenCalledTimes(1)
      expect(bookings.offlineEventsForAdmin).toHaveBeenCalledWith(new Date('2026-11-13T20:00:00.000Z'))
      // Same order, nothing regrouped or sorted by rider.
      expect(result).toBe(items)
    })

    test('takes no rider, search, filter or sort argument', () => {
      expect(service.adminList.length).toBe(1)
    })
  })

  describe('follow up (AC-6)', () => {
    test('records the admin and the time', async () => {
      await expect(service.followUp('event-1', 'admin-9', now)).resolves.toBeUndefined()
      expect(bookings.markFollowedUp).toHaveBeenCalledWith('event-1', 'admin-9', now)
    })

    test("an unknown item is the project's NotFoundException (404), not Nest's", async () => {
      bookings.markFollowedUp.mockResolvedValue('missing')
      const refusal = await service.followUp('nope', 'admin-9', now).catch((error: unknown) => error)
      expect(refusal).toBeInstanceOf(errors.NotFoundException)
      // Nest's own 404 is logged as an error with a stack by ErrorLoggingInterceptor (row 121).
      expect(refusal).not.toBeInstanceOf(NestNotFoundException)
      expect(refusal).toBeInstanceOf(errors.ApiException)
      expect((refusal as errors.NotFoundException).getStatus()).toBe(404)
      expect((refusal as Error).message).toBe(OFFLINE_EVENT_SENTENCES.missing)
    })

    test('an item already followed up is a 409', async () => {
      bookings.markFollowedUp.mockResolvedValue('already')
      const refusal = await service.followUp('event-1', 'admin-9', now).catch((error: unknown) => error)
      expect(refusal).toBeInstanceOf(ConflictException)
      expect((refusal as ConflictException).getStatus()).toBe(409)
      expect((refusal as Error).message).toBe('This item was already followed up.')
    })
  })
})
