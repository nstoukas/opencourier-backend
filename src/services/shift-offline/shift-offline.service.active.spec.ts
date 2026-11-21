import { ConflictException, NotFoundException as NestNotFoundException } from '@nestjs/common'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import * as errors from 'src/errors'
import { BullMQService } from 'src/integrations/bullMQ/bullMQ.service'
import { ShiftBookingRepository } from 'src/persistence/repositories/shift-booking.repository'
import { TaskBusService } from 'src/services/taskBus/taskBus.service'
import { OFFLINE_EVENT_SENTENCES, ShiftOfflineService } from './shift-offline.service'

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
    service = new ShiftOfflineService(
      bookings as unknown as ShiftBookingRepository,
      { instanceConfig } as unknown as ConfigDomainService,
      bullMQ as unknown as BullMQService,
      taskBus as unknown as TaskBusService
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
      instanceConfig.getShiftBreakMinutes.mockResolvedValue(45)
      await service.sweep(now)
      expect((bookings.offlineChangesWithoutEvent.mock.calls[1] as [Date, Date])[1]).toEqual(
        new Date('2026-11-20T19:15:00.000Z')
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
        await service.sweep(now)
        const [from, upTo] = windowAsked()
        expect(from).toEqual(switchedOnAt)
        // An empty window: it starts after it ends.
        expect(from.getTime()).toBeGreaterThan(upTo.getTime())
      })

      test('the switch on time is read afresh on every sweep', async () => {
        bookings.shiftsLastSwitchedOnAt.mockResolvedValueOnce(null)
        await service.sweep(now)
        const switchedOnAt = new Date('2026-11-20T19:00:00.000Z')
        bookings.shiftsLastSwitchedOnAt.mockResolvedValueOnce(switchedOnAt)
        await service.sweep(now)
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
