import * as fs from 'fs'
import * as path from 'path'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { CourierDomainService } from 'src/domains/courier/courier.domain.service'
import { ShiftBookingRepository } from 'src/persistence/repositories/shift-booking.repository'
import { PrismaService } from 'src/services/prisma/prisma.service'
import { OsrmRoutingService } from '../osrm/osrm-routing.service'
import { FairnessDayFigures, TimeWorkedService } from '../time-worked/time-worked.service'
import { FairnessCourierMatcherService } from './fairness-courier-matcher.service'

// Spec 0049 (row 79; AC-2, AC-3, AC-7, AC-8, cross check 5; decision 79.2): shift priority in the fairness
// matcher. Written from the spec, with the settings, the routing, the day's figures and the bookings read
// faked. No SQL runs.
describe('FairnessCourierMatcherService and shifts (spec 0049)', () => {
  const pickupLocation = { latitude: 39.3621, longitude: 22.9421 }
  const dropoffLocation = { latitude: 39.3701, longitude: 22.9501 }
  const now = new Date('2026-11-21T12:00:00.000Z')

  // Two riders: `near` is 100 s from the restaurant, `far` 700 s. Everything else about them is equal,
  // so without shifts `near` wins on road time.
  const inRange = [
    { courierId: 'near', distance: 300, courierLocation: { latitude: 39.363, longitude: 22.943 } },
    { courierId: 'far', distance: 2500, courierLocation: { latitude: 39.38, longitude: 22.96 } },
  ]

  function figures(): Map<string, FairnessDayFigures> {
    const same: FairnessDayFigures = {
      workSeconds: 7200,
      centsPerHour: 1000,
      lastJobEndAt: new Date('2026-11-21T11:30:00.000Z'),
      onlineSpellStartAt: new Date('2026-11-21T09:00:00.000Z'),
    }
    return new Map([
      ['near', { ...same }],
      ['far', { ...same }],
    ])
  }

  let instanceConfig: {
    getMaxAssignmentDistanceInKM: jest.Mock
    getFairnessCandidateLimit: jest.Mock
    getFairnessMinOnlineMinutes: jest.Mock
    getFairnessWeightRoadTime: jest.Mock
    getFairnessWeightEarnings: jest.Mock
    getFairnessWeightWaiting: jest.Mock
    getShiftsEnabled: jest.Mock
    getFairnessWeightShift: jest.Mock
  }
  let courierDomainService: { getNearestAvailableCandidates: jest.Mock }
  let osrm: { getTableSecondsTo: jest.Mock }
  let timeWorked: { todayForFairness: jest.Mock }
  let onShiftNow: jest.Mock

  function matcherWith(bookingsRepository?: unknown): FairnessCourierMatcherService {
    return new FairnessCourierMatcherService(
      courierDomainService as unknown as CourierDomainService,
      { instanceConfig } as unknown as ConfigDomainService,
      osrm as unknown as OsrmRoutingService,
      timeWorked as unknown as TimeWorkedService,
      bookingsRepository as ShiftBookingRepository | undefined
    )
  }

  function settings(shiftsEnabled: boolean, shiftWeight: number) {
    instanceConfig.getShiftsEnabled.mockResolvedValue(shiftsEnabled)
    instanceConfig.getFairnessWeightShift.mockResolvedValue(shiftWeight)
  }

  async function offer(service: FairnessCourierMatcherService) {
    const result = await service.findCourierForDelivery({ pickupLocation, dropoffLocation, rejectedCourierIds: [] })
    if (!result || !result.reason) throw new Error('expected an offer with a reason')
    return { ...result, reason: result.reason }
  }

  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(now)
    instanceConfig = {
      getMaxAssignmentDistanceInKM: jest.fn().mockResolvedValue(20),
      getFairnessCandidateLimit: jest.fn().mockResolvedValue(10),
      getFairnessMinOnlineMinutes: jest.fn().mockResolvedValue(30),
      getFairnessWeightRoadTime: jest.fn().mockResolvedValue(50),
      getFairnessWeightEarnings: jest.fn().mockResolvedValue(30),
      getFairnessWeightWaiting: jest.fn().mockResolvedValue(20),
      getShiftsEnabled: jest.fn().mockResolvedValue(false),
      getFairnessWeightShift: jest.fn().mockResolvedValue(0),
    }
    courierDomainService = { getNearestAvailableCandidates: jest.fn().mockResolvedValue(inRange) }
    osrm = { getTableSecondsTo: jest.fn().mockResolvedValue([100, 700]) }
    timeWorked = { todayForFairness: jest.fn().mockImplementation(() => Promise.resolve(figures())) }
    // `far` holds a booked shift covering now.
    onShiftNow = jest.fn().mockResolvedValue(new Set(['far']))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('shifts off (AC-2, cross check 5): shifts change nothing', () => {
    test('the recorded weights are the three core ones only, whatever the saved shift weight', async () => {
      settings(false, 100)
      const { reason } = await offer(matcherWith({ onShiftNow }))
      expect(reason.weights).toEqual({ roadTime: 50, earnings: 30, waiting: 20 })
      expect(Object.keys(reason.weights as object)).not.toContain('shift')
    })

    test('no onShift and no scaled shift value is recorded, for the chosen rider or any compared rider', async () => {
      settings(false, 100)
      const { reason } = await offer(matcherWith({ onShiftNow }))
      expect(reason.values).not.toHaveProperty('onShift')
      expect((reason.values as { scaled: object }).scaled).not.toHaveProperty('shift')
      for (const candidate of reason.candidates!) {
        expect(candidate).not.toHaveProperty('onShift')
        expect((candidate as { scaled: object }).scaled).not.toHaveProperty('shift')
      }
    })

    test('the bookings are never read', async () => {
      settings(false, 100)
      await offer(matcherWith({ onShiftNow }))
      expect(onShiftNow).not.toHaveBeenCalled()
    })

    test('the booked rider gets no head start: the result is the same at shift weight 100 as at 0', async () => {
      settings(false, 100)
      const atHundred = await offer(matcherWith({ onShiftNow }))
      settings(false, 0)
      const atZero = await offer(matcherWith({ onShiftNow }))
      expect(atHundred).toEqual(atZero)
      expect(atHundred.courierId).toBe('near')
      // near: best on everything, 0. far: (50 * 1) / (50 + 30 + 20).
      expect(atHundred.reason.candidates!.map((c) => [c.courierId, c.score])).toEqual([
        ['near', 0],
        ['far', 0.5],
      ])
    })
  })

  describe('shifts on (AC-2, AC-3)', () => {
    test('asks which of the compared riders are on a booked shift now, once, with their ids and the offer time', async () => {
      settings(true, 0)
      await offer(matcherWith({ onShiftNow }))
      expect(onShiftNow).toHaveBeenCalledTimes(1)
      expect(onShiftNow).toHaveBeenCalledWith(['near', 'far'], now)
    })

    test('asks only about the shortlist, not every rider in range', async () => {
      settings(true, 0)
      instanceConfig.getFairnessCandidateLimit.mockResolvedValue(1)
      osrm.getTableSecondsTo.mockResolvedValue([100])
      await offer(matcherWith({ onShiftNow }))
      expect(onShiftNow).toHaveBeenCalledWith(['near'], now)
    })

    test('weight 0: the reason records shift: 0 and onShift per rider, and nobody changes place', async () => {
      settings(true, 0)
      const { courierId, reason } = await offer(matcherWith({ onShiftNow }))
      expect(reason.weights).toEqual({ roadTime: 50, earnings: 30, waiting: 20, shift: 0 })
      expect(courierId).toBe('near')
      expect(reason.values).toMatchObject({ onShift: false })
      expect(reason.candidates!.map((c) => [c.courierId, (c as { onShift?: boolean }).onShift, c.score])).toEqual([
        ['near', false, 0],
        ['far', true, 0.5],
      ])
    })

    test('weight 100: the rider on a booked shift who lost at weight 0 now wins, and the reason says onShift: true', async () => {
      settings(true, 100)
      const { courierId, reason } = await offer(matcherWith({ onShiftNow }))
      expect(courierId).toBe('far')
      expect(reason.weights).toEqual({ roadTime: 50, earnings: 30, waiting: 20, shift: 100 })
      expect(reason.values).toMatchObject({ onShift: true })
      expect((reason.values as { scaled: { shift?: number } }).scaled.shift).toBe(0)
      // far: (50 * 1 + 100 * 0) / 200. near: (50 * 0 + 100 * 1) / 200.
      expect(reason.score).toBeCloseTo(0.25, 10)
      const near = reason.candidates!.find((c) => c.courierId === 'near') as { onShift?: boolean; score: number }
      expect(near.onShift).toBe(false)
      expect(near.score).toBeCloseTo(0.5, 10)
    })

    test('the factor recorded is the unscaled 0 or 1: with nobody on a shift every rider has 1', async () => {
      settings(true, 100)
      onShiftNow.mockResolvedValue(new Set())
      const { courierId, reason } = await offer(matcherWith({ onShiftNow }))
      expect(courierId).toBe('near')
      for (const candidate of reason.candidates!) {
        expect((candidate as { onShift?: boolean }).onShift).toBe(false)
        expect((candidate as { scaled: { shift?: number } }).scaled.shift).toBe(1)
      }
    })

    test('the settings are read at offer time, so a saved weight applies to the next offer', async () => {
      const service = matcherWith({ onShiftNow })
      settings(true, 0)
      expect((await offer(service)).courierId).toBe('near')
      settings(true, 100)
      expect((await offer(service)).courierId).toBe('far')
    })

    // Review ruling 2 (2026-11-21), which replaces decision 79.2's record: when the bookings cannot be read,
    // the offer is made as with Shifts off. Recording `onShift: false` and the shift weight for everyone
    // would state something the matcher does not know.
    describe('the bookings cannot be read: the offer is made as with Shifts off (review ruling 2)', () => {
      function expectAsWithShiftsOff(reason: Awaited<ReturnType<typeof offer>>['reason']) {
        expect(reason.weights).toEqual({ roadTime: 50, earnings: 30, waiting: 20 })
        expect(Object.keys(reason.weights as object)).not.toContain('shift')
        expect(reason.values).not.toHaveProperty('onShift')
        expect((reason.values as { scaled: object }).scaled).not.toHaveProperty('shift')
        expect(reason.candidates).toHaveLength(2)
        for (const candidate of reason.candidates!) {
          expect(candidate).not.toHaveProperty('onShift')
          expect((candidate as { scaled: object }).scaled).not.toHaveProperty('shift')
        }
      }

      test('a failed bookings read: the offer is still made, with no shift weight and no onShift recorded', async () => {
        settings(true, 100)
        onShiftNow.mockRejectedValue(new Error('bookings table unreachable'))
        const { courierId, reason } = await offer(matcherWith({ onShiftNow }))
        expect(onShiftNow).toHaveBeenCalledTimes(1)
        expect(courierId).toBe('near')
        expectAsWithShiftsOff(reason)
      })

      test('a failed bookings read: the same choice and the same record as at shift weight 0, and as with Shifts off', async () => {
        onShiftNow.mockRejectedValue(new Error('bookings table unreachable'))
        settings(true, 100)
        const atHundred = await offer(matcherWith({ onShiftNow }))
        settings(true, 0)
        const atZero = await offer(matcherWith({ onShiftNow }))
        settings(false, 100)
        const shiftsOff = await offer(matcherWith({ onShiftNow }))
        expect(atHundred).toEqual(atZero)
        expect(atHundred).toEqual(shiftsOff)
        // The scores are the three factor ones: near best on everything, far (50 * 1) / (50 + 30 + 20).
        expect(atHundred.reason.candidates!.map((c) => [c.courierId, c.score])).toEqual([
          ['near', 0],
          ['far', 0.5],
        ])
      })

      test('the failure is logged, never thrown', async () => {
        settings(true, 100)
        onShiftNow.mockRejectedValue(new Error('bookings table unreachable'))
        const service = matcherWith({ onShiftNow })
        const logged = jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined)
        await expect(offer(service)).resolves.toMatchObject({ courierId: 'near' })
        expect(logged).toHaveBeenCalledTimes(1)
        expect(String(logged.mock.calls[0]![0])).toContain('bookings table unreachable')
      })

      test('the next offer, once the bookings read again, has the shift weight and onShift back', async () => {
        settings(true, 100)
        const service = matcherWith({ onShiftNow })
        jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined)
        onShiftNow.mockRejectedValueOnce(new Error('bookings table unreachable'))
        expect((await offer(service)).courierId).toBe('near')
        const { courierId, reason } = await offer(service)
        expect(courierId).toBe('far')
        expect(reason.weights).toEqual({ roadTime: 50, earnings: 30, waiting: 20, shift: 100 })
        expect(reason.values).toMatchObject({ onShift: true })
      })

      test('a matcher built without the bookings repository still offers, with no shift weight and no onShift recorded', async () => {
        settings(true, 100)
        const { courierId, reason } = await offer(matcherWith(undefined))
        expect(courierId).toBe('near')
        expectAsWithShiftsOff(reason)
      })

      test('a matcher built without the bookings repository: the same choice and record as at shift weight 0', async () => {
        settings(true, 100)
        const atHundred = await offer(matcherWith(undefined))
        settings(true, 0)
        const atZero = await offer(matcherWith(undefined))
        settings(false, 100)
        const shiftsOff = await offer(matcherWith(undefined))
        expect(atHundred).toEqual(atZero)
        expect(atHundred).toEqual(shiftsOff)
      })
    })
  })

  // AC-7: "The matcher, the fairness factors and every pay path never read WENT_OFFLINE_MID_SHIFT or any
  // booking history beyond 'booked now'. A test fails if the score changes when such an event exists."
  describe('AC-7: an Offline during a shift record never reaches the score', () => {
    const farBooking = {
      id: 'booking-far',
      courierId: 'far',
      status: 'BOOKED',
      startsAt: new Date('2026-11-21T10:00:00.000Z'),
      endsAt: new Date('2026-11-21T14:00:00.000Z'),
    }
    const offlineEvent = {
      id: 'event-1',
      type: 'WENT_OFFLINE_MID_SHIFT',
      shiftBookingId: 'booking-far',
      courierId: 'far',
      cause: 'RIDER',
      offlineAt: new Date('2026-11-21T11:00:00.000Z'),
      followedUpAt: null,
      followedUpByUserId: null,
    }

    // A small stand in for the database, read through the real ShiftBookingRepository. The bookings answer
    // the `where` they are asked with; every read of the events table is counted.
    function database(events: unknown[]) {
      const eventReads: string[] = []
      const bookingReads: unknown[] = []
      const eventTable = new Proxy(
        {},
        {
          get: (_target, method) => {
            eventReads.push(String(method))
            return () => Promise.resolve(events)
          },
        }
      )
      const prisma = {
        shiftBooking: {
          findMany: jest.fn(
            (args: { where: { courierId: { in: string[] }; startsAt: { lte: Date }; endsAt: { gt: Date } } }) => {
              bookingReads.push(args)
              const covering = [farBooking].filter(
                (b) =>
                  args.where.courierId.in.includes(b.courierId) &&
                  b.startsAt.getTime() <= args.where.startsAt.lte.getTime() &&
                  b.endsAt.getTime() > args.where.endsAt.gt.getTime()
              )
              // The booking comes back with its events attached, as a careless include would deliver them.
              return Promise.resolve(covering.map((b) => ({ ...b, events })))
            }
          ),
        },
        get shiftBookingEvent() {
          return eventTable
        },
      }
      return { prisma, eventReads, bookingReads }
    }

    test.each([
      ['shift weight 100', 100],
      ['shift weight 40', 40],
      ['shift weight 0', 0],
    ])('the matcher result is identical with and without the event (%s)', async (_name, weight) => {
      settings(true, weight)
      const without = database([])
      const withEvent = database([offlineEvent])

      const resultWithout = await offer(
        matcherWith(new ShiftBookingRepository(without.prisma as unknown as PrismaService))
      )
      const resultWith = await offer(
        matcherWith(new ShiftBookingRepository(withEvent.prisma as unknown as PrismaService))
      )

      expect(resultWith).toEqual(resultWithout)
      expect(resultWith.reason.score).toBe(resultWithout.reason.score)
      expect(resultWith.reason.candidates!.map((c) => c.score)).toEqual(
        resultWithout.reason.candidates!.map((c) => c.score)
      )
      // The rider with the record still counts as on their booked shift.
      const far = resultWith.reason.candidates!.find((c) => c.courierId === 'far') as { onShift?: boolean }
      expect(far.onShift).toBe(true)
    })

    test('the matcher never reads the events table, and asks the bookings for the rider id only', async () => {
      settings(true, 100)
      const db = database([offlineEvent])
      await offer(matcherWith(new ShiftBookingRepository(db.prisma as unknown as PrismaService)))
      expect(db.eventReads).toEqual([])
      expect(db.bookingReads).toHaveLength(1)
      const read = db.bookingReads[0] as { where: Record<string, unknown>; select?: unknown; include?: unknown }
      // "Booked now" and nothing else: BOOKED, startsAt <= now < endsAt, these riders.
      expect(read.where).toEqual({
        courierId: { in: ['near', 'far'] },
        status: 'BOOKED',
        startsAt: { lte: now },
        endsAt: { gt: now },
      })
      expect(read.select).toEqual({ courierId: true })
      expect(read.include).toBeUndefined()
    })

    // Source guards. A file that matches riders or pays them must not name the event, the events table, or
    // any of the reads that return it.
    describe('no matcher or pay source file names the record', () => {
      const SRC = path.resolve(__dirname, '../..')
      const FORBIDDEN =
        /WENT_OFFLINE_MID_SHIFT|shiftBookingEvent|ShiftBookingEvent|shift-offline|ShiftOffline|offlineEventsForAdmin|ownOfflineRecords|createOfflineEvent|markFollowedUp|offlineChangesWithoutEvent|leftOfflineBetween|followedUp/

      function sourceFiles(directory: string): string[] {
        return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
          const full = path.join(directory, entry.name)
          if (entry.isDirectory()) return sourceFiles(full)
          return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [full] : []
        })
      }

      // Everything that picks a rider, prices a delivery, pays a rider or sums what they earned.
      const MATCHER_AND_PAY = [
        'domains/matching',
        'services/courier-matcher',
        'services/delivery-matching',
        'services/delivery-calculation',
        'services/quote-calculation',
        'services/courier-compensation',
        'services/cancellation',
        'services/time-worked',
        'domains/time-worked',
        'services/partner-billing',
        'domains/partner-billing',
        'services/delivery-event',
      ]

      test.each(MATCHER_AND_PAY)('%s', (directory) => {
        const files = sourceFiles(path.join(SRC, directory))
        // An empty folder would make this test pass over nothing.
        expect(files.length).toBeGreaterThan(0)
        const naming = files.filter((file) => FORBIDDEN.test(fs.readFileSync(file, 'utf8')))
        expect(naming.map((file) => path.relative(SRC, file))).toEqual([])
      })

      test('the guard bites: the file that does write the record is caught by the same pattern', () => {
        const repository = fs.readFileSync(
          path.join(SRC, 'persistence/repositories/shift-booking.repository.ts'),
          'utf8'
        )
        expect(FORBIDDEN.test(repository)).toBe(true)
      })

      test('in all of src, only the bookings repository names WENT_OFFLINE_MID_SHIFT', () => {
        const naming = sourceFiles(SRC)
          .filter((file) => !file.includes(`${path.sep}generated${path.sep}`))
          .filter((file) => fs.readFileSync(file, 'utf8').includes('WENT_OFFLINE_MID_SHIFT'))
        expect(naming.map((file) => path.relative(SRC, file))).toEqual([
          'persistence/repositories/shift-booking.repository.ts',
        ])
      })

      test('the only bookings read the matcher calls is onShiftNow', () => {
        const matcher = fs.readFileSync(path.join(__dirname, 'fairness-courier-matcher.service.ts'), 'utf8')
        const called = [...matcher.matchAll(/shiftBookingRepository\.(\w+)/g)].map((match) => match[1])
        expect(called.length).toBeGreaterThan(0)
        expect([...new Set(called)]).toEqual(['onShiftNow'])
      })
    })
  })

  // AC-8: "Shift priority never reads the time worked record (spec 0040)."
  describe('AC-8: on shift comes from bookings alone, never from time worked', () => {
    test('with no time worked figures at all, the booked rider is still on shift', async () => {
      settings(true, 100)
      timeWorked.todayForFairness.mockResolvedValue(new Map())
      const { reason } = await offer(matcherWith({ onShiftNow }))
      const byId = Object.fromEntries(
        reason.candidates!.map((c) => [c.courierId, (c as { onShift?: boolean }).onShift])
      )
      expect(byId).toEqual({ near: false, far: true })
    })

    test('when the time worked read fails, the booked rider is still on shift and still gets the head start', async () => {
      settings(true, 100)
      timeWorked.todayForFairness.mockRejectedValue(new Error('time worked unreachable'))
      const { courierId, reason } = await offer(matcherWith({ onShiftNow }))
      expect(courierId).toBe('far')
      expect(reason.values).toMatchObject({ onShift: true })
    })

    test('a rider who has worked all day but holds no booking is not on shift', async () => {
      settings(true, 100)
      onShiftNow.mockResolvedValue(new Set())
      timeWorked.todayForFairness.mockResolvedValue(
        new Map([
          [
            'near',
            {
              workSeconds: 36000,
              centsPerHour: 1000,
              lastJobEndAt: null,
              onlineSpellStartAt: new Date('2026-11-21T02:00:00.000Z'),
            },
          ],
          [
            'far',
            {
              workSeconds: 36000,
              centsPerHour: 1000,
              lastJobEndAt: null,
              onlineSpellStartAt: new Date('2026-11-21T02:00:00.000Z'),
            },
          ],
        ])
      )
      const { reason } = await offer(matcherWith({ onShiftNow }))
      for (const candidate of reason.candidates!) {
        expect((candidate as { onShift?: boolean }).onShift).toBe(false)
      }
    })

    test('the time worked service is asked for the day figures only, never about a shift or a booking', async () => {
      settings(true, 100)
      // Any other method called on it would throw "is not a function".
      await offer(matcherWith({ onShiftNow }))
      expect(timeWorked.todayForFairness).toHaveBeenCalledTimes(1)
      expect(timeWorked.todayForFairness).toHaveBeenCalledWith(now)
    })

    test('onShiftNow reads the bookings table and no other: not the status record, not time worked', async () => {
      const tablesRead: string[] = []
      const prisma = new Proxy(
        {},
        {
          get: (_target, table) => {
            tablesRead.push(String(table))
            return { findMany: () => Promise.resolve([{ courierId: 'far' }]) }
          },
        }
      )
      const repository = new ShiftBookingRepository(prisma as unknown as PrismaService)
      const result = await repository.onShiftNow(['near', 'far'], now)
      expect([...result]).toEqual(['far'])
      expect(tablesRead).toEqual(['shiftBooking'])
    })

    test('the score file and the on shift read name nothing of time worked', () => {
      const SRC = path.resolve(__dirname, '../..')
      const score = fs.readFileSync(path.join(SRC, 'domains/matching/fairness-score.ts'), 'utf8')
      expect(score).not.toMatch(/^import /m)
      const repository = fs.readFileSync(path.join(SRC, 'persistence/repositories/shift-booking.repository.ts'), 'utf8')
      expect(repository).not.toMatch(/time-worked|WorkedShift|buildWorkedShifts|TimeWorked/)
      // The body of onShiftNow, up to the next method's comment.
      const body = repository.slice(repository.indexOf('async onShiftNow('))
      const onShiftNowBody = body.slice(0, body.indexOf('\n  }\n') + 5)
      expect(onShiftNowBody).toContain('this.prisma.shiftBooking.findMany')
      expect(onShiftNowBody).not.toMatch(/courierStatusChange|shiftBookingEvent/)
    })
  })
})
