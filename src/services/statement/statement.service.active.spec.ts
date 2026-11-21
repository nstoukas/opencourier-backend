import { BadRequestException } from '@nestjs/common'
import {
  EnumCourierAccountChangeKind,
  EnumCourierCompensationReason,
  EnumCourierStatus,
  EnumCourierStatusChangeCause,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
} from '@prisma/types'
import * as errors from 'src/errors'
import { summarisePeriod } from 'src/domains/time-worked/period-figures'
import { EnumJobEndLabel } from 'src/domains/time-worked/worked-shifts'
import { TimeWorkedService } from 'src/services/time-worked/time-worked.service'
import { StatementService, formatOf, monthsBetween } from './statement.service'

// Spec 0050 (row 76): StatementService. Written from the acceptance criteria and the "Cross check,
// 2026-11-20" section. The time worked service is the real one over a faked repository, so the statement
// is compared with what the Earnings screen itself would show for the same records (AC-3, cross check 6).

const COURIER = 'courier-76'
const ADMIN = 'admin-user-9'
// 21 November 2026, 12:00 in Athens: October is the last complete month.
const NOW = new Date('2026-11-21T10:00:00Z')
const R = EnumCourierCompensationReason
const E = EnumDeliveryEventType

// ---- A month built by hand: October 2026 for one rider ----
//
// Athens is UTC+3 until 25 October 2026 and UTC+2 after it.
//  30 Sept  shift 20:00 to 21:00, job d0 (999 cents): September, never in the statement.
//   5 Oct   shift 10:00 to 14:00 (4 h). d1 10:30 to 11:00 delivered, pay 350 + tips 100, 2.5 km, 4 paid
//           waiting minutes (80). d2 12:00 to 12:20 delivered, pay 420, 3.2 km, a review correction of 50
//           written on 3 November. d3 13:00 to 13:10 reassigned, 150 reassignment pay, a 77 tip on the
//           delivery that is not this rider's.
//  12 Oct   shift 18:00 to 21:00 (3 h). d4 18:10 to 18:20 cancelled before pickup, 200 cancellation pay.
//           d5 19:00 to 19:30 delivered, pay 500 + tips 250, 4.1 km.
//  20 Oct   d6 accepted and dropped off at the same instant while Offline: a job in no shift, pay 300 +
//           tips 50, 9.9 km (in the money, in no rate).
//  22 Oct   120 on d7, a delivery this rider never held: money linked to no job.
//  31 Oct   shift 22:00 to 00:30. d8 23:30 to 00:20 delivered, pay 600 + tips 30, 1.9 km: October's by its
//           accept day, though it ends in November. d9 accepted 00:25 on 1 November (888): November's.
//  Also a 999 USD payment on d1, left out as not in the instance currency.
const at = (iso: string) => new Date(iso)

function statusChange(id: string, iso: string, online: boolean) {
  return {
    id,
    courierId: COURIER,
    createdAt: at(iso),
    fromStatus: online ? EnumCourierStatus.OFFLINE : EnumCourierStatus.ONLINE,
    toStatus: online ? EnumCourierStatus.ONLINE : EnumCourierStatus.OFFLINE,
    cause: EnumCourierStatusChangeCause.RIDER,
    adminUserId: null,
  }
}

function event(deliveryId: string, type: EnumDeliveryEventType, iso: string, extra: Record<string, unknown> = {}) {
  return {
    id: `${deliveryId}-${type}-${iso}`,
    deliveryId,
    type,
    oldStatus: EnumDeliveryStatus.ACCEPTED,
    courierId: type === E.ACCEPTED ? COURIER : null,
    occurredAt: at(iso),
    createdAt: at(iso),
    ...extra,
  }
}

function delivery(id: string, totalCompensation: number, tips: number, paidKm: number | null, pickupName: string) {
  return {
    id,
    status: EnumDeliveryStatus.DROPPED_OFF,
    courierId: COURIER,
    totalCompensation,
    tips,
    pickupName,
    paidKm,
    dropoffArea: `Area ${id}`,
  }
}

function comp(
  id: string,
  deliveryId: string,
  amount: number,
  reason: EnumCourierCompensationReason,
  iso: string,
  extra: Record<string, unknown> = {}
) {
  return {
    id,
    courierId: COURIER,
    deliveryId,
    amount,
    currencyCode: 'EUR',
    reason,
    waitMinutes: null,
    createdAt: at(iso),
    ...extra,
  }
}

const DELIVERIES = [
  delivery('d0', 999, 0, 5, 'September Grill'),
  delivery('d1', 350, 100, 2.5, 'Souvlaki Bar'),
  delivery('d2', 420, 0, 3.2, 'Pizza Roma'),
  { ...delivery('d3', 400, 77, 2, 'Burger Spot'), courierId: 'another-courier' },
  { ...delivery('d4', 300, 0, 1.5, 'Cancelled Kitchen'), status: EnumDeliveryStatus.CANCELED },
  delivery('d5', 500, 250, 4.1, 'Το Κουτούκι'),
  delivery('d6', 300, 50, 9.9, 'Offline Deli'),
  delivery('d8', 600, 30, 1.9, 'Midnight Gyros'),
  delivery('d9', 888, 0, 7, 'November Bakery'),
]

function octoberRecords() {
  const ids = DELIVERIES.map((d) => d.id)
  return {
    statusChanges: [
      statusChange('s1', '2026-09-30T17:00:00Z', true),
      statusChange('s2', '2026-09-30T18:00:00Z', false),
      statusChange('s3', '2026-10-05T07:00:00Z', true),
      statusChange('s4', '2026-10-05T11:00:00Z', false),
      statusChange('s5', '2026-10-12T15:00:00Z', true),
      statusChange('s6', '2026-10-12T18:00:00Z', false),
      statusChange('s7', '2026-10-31T20:00:00Z', true),
      statusChange('s8', '2026-10-31T22:30:00Z', false),
    ],
    statusBefore: new Map(),
    acceptedDeliveries: new Map([[COURIER, new Set(ids)]]),
    events: [
      event('d0', E.ACCEPTED, '2026-09-30T17:10:00Z'),
      event('d0', E.DROPPED_OFF, '2026-09-30T17:30:00Z'),
      event('d1', E.ACCEPTED, '2026-10-05T07:30:00Z'),
      event('d1', E.DROPPED_OFF, '2026-10-05T08:00:00Z'),
      event('d2', E.ACCEPTED, '2026-10-05T09:00:00Z'),
      event('d2', E.DROPPED_OFF, '2026-10-05T09:20:00Z'),
      event('d3', E.ACCEPTED, '2026-10-05T10:00:00Z'),
      event('d3', E.REASSIGNED, '2026-10-05T10:10:00Z'),
      event('d4', E.ACCEPTED, '2026-10-12T15:10:00Z'),
      event('d4', E.CANCELED, '2026-10-12T15:20:00Z'),
      event('d5', E.ACCEPTED, '2026-10-12T16:00:00Z'),
      event('d5', E.DROPPED_OFF, '2026-10-12T16:30:00Z'),
      // Received five seconds apart, both timed at the same tap: a zero length job while Offline.
      event('d6', E.ACCEPTED, '2026-10-20T09:00:00Z'),
      event('d6', E.DROPPED_OFF, '2026-10-20T09:00:00Z', { createdAt: at('2026-10-20T09:00:05Z') }),
      event('d8', E.ACCEPTED, '2026-10-31T21:30:00Z'),
      event('d8', E.DROPPED_OFF, '2026-10-31T22:20:00Z'),
      event('d9', E.ACCEPTED, '2026-10-31T22:25:00Z'),
      event('d9', E.DROPPED_OFF, '2026-10-31T22:28:00Z'),
    ],
    deliveries: DELIVERIES,
    compensations: [
      comp('c-wait', 'd1', 80, R.WAITING, '2026-10-05T07:50:00Z', { waitMinutes: 4 }),
      comp('c-usd', 'd1', 999, R.REVIEW, '2026-10-05T07:55:00Z', { currencyCode: 'USD' }),
      comp('c-review-late', 'd2', 50, R.REVIEW, '2026-11-03T09:00:00Z'),
      comp('c-reassign', 'd3', 150, R.REASSIGNMENT, '2026-10-05T10:10:00Z'),
      comp('c-cancel', 'd4', 200, R.CANCELLATION, '2026-10-12T15:20:00Z'),
      comp('c-nojob', 'd7', 120, R.REMOVAL, '2026-10-22T10:00:00Z'),
    ],
    everAccepted: new Set(ids.map((id) => `${COURIER}:${id}`)),
  }
}

const emptyRecords = () => ({
  statusChanges: [],
  statusBefore: new Map(),
  acceptedDeliveries: new Map(),
  events: [],
  deliveries: [],
  compensations: [],
  everAccepted: new Set<string>(),
})

function setup(
  options: {
    records?: ReturnType<typeof octoberRecords> | ReturnType<typeof emptyRecords>
    createdAt?: Date
    firstAccept?: Date | null
    coopName?: unknown
    recordedFrom?: Date | null
  } = {}
) {
  const repository = {
    findRecordedFrom: jest
      .fn()
      .mockResolvedValue(options.recordedFrom === undefined ? at('2026-01-01T00:00:00Z') : options.recordedFrom),
    findRecords: jest.fn().mockResolvedValue(options.records ?? emptyRecords()),
  }
  const config = {
    instanceConfig: {
      getShiftBreakMinutes: jest.fn().mockResolvedValue(30),
      getCurrency: jest.fn().mockResolvedValue('EUR'),
      getDetails: jest
        .fn()
        .mockResolvedValue({ name: options.coopName === undefined ? 'Volos Riders' : options.coopName }),
    },
  }
  const prisma = {
    courier: {
      findUnique: jest.fn().mockResolvedValue({
        createdAt: options.createdAt ?? at('2026-08-15T09:00:00Z'),
        firstName: 'Nikos',
        lastName: 'Rider',
      }),
    },
    deliveryEvent: {
      findFirst: jest.fn().mockResolvedValue(options.firstAccept ? { createdAt: options.firstAccept } : null),
    },
    delivery: {
      // The tips read: each asked delivery's own tips, as the database holds them.
      findMany: jest
        .fn()
        .mockImplementation(async (args: { where: { id: { in: string[] } } }) =>
          DELIVERIES.filter((d) => args.where.id.in.includes(d.id)).map((d) => ({ id: d.id, tips: d.tips }))
        ),
    },
    statementDownload: {
      create: jest.fn().mockResolvedValue({ id: 'download-1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  }
  const accounts = { record: jest.fn().mockResolvedValue(undefined) }
  // The real service, so the statement is fed by the screen's own function.
  const timeWorked = new TimeWorkedService(repository as any, config as any)
  const earnings = jest.spyOn(timeWorked, 'earnings')
  const service = new StatementService(timeWorked, config as any, accounts as any, prisma as any)
  return { service, timeWorked, earnings, repository, config, prisma, accounts }
}

describe('StatementService: the statement equals the Earnings screen (spec 0050 AC-3, cross check 6)', () => {
  test("AC-3: the month totals equal the sums of the screen's days, to the cent", async () => {
    const { service, timeWorked } = setup({ records: octoberRecords() })

    const model = await service.model(COURIER, '2026-10', 'en', NOW)
    // The exact comparison cross check 6 names.
    const screen = await timeWorked.earnings(
      COURIER,
      { from: '2026-10-01', to: '2026-10-31', reachFrom: null },
      { withAdminLabels: false },
      NOW
    )

    expect(screen.days).toHaveLength(31)
    const sum = (pick: (day: (typeof screen.days)[number]) => number) =>
      screen.days.reduce((total, day) => total + pick(day), 0)
    expect(model.totals.moneyCents).toBe(sum((day) => day.moneyCents))
    expect(model.totals.dropOffCount).toBe(sum((day) => day.dropOffCount))
    expect(model.totals.paidKm).toBe(sum((day) => day.paidKm))
    expect(model.totals.workSeconds).toBe(sum((day) => day.workSeconds))
    expect(model.totals.jobSeconds).toBe(sum((day) => day.jobSeconds))
    expect(model.totals.paidWaitSeconds).toBe(sum((day) => day.paidWaitSeconds))
    expect(model.totals.unpaidSeconds).toBe(sum((day) => day.unpaidSeconds))
  })

  test('AC-3: and they are the figures worked out by hand for this month', async () => {
    const { service } = setup({ records: octoberRecords() })

    const { totals } = await service.model(COURIER, '2026-10', 'en', NOW)

    // 5 Oct 1150 (530 + 470 + 150), 12 Oct 950 (200 + 750), 20 Oct 350, 22 Oct 120, 31 Oct 630.
    expect(totals.moneyCents).toBe(3200)
    // d1, d2, d5, d8: the drop offs inside a recorded shift, as the screen counts them.
    expect(totals.dropOffCount).toBe(4)
    expect(totals.paidKm).toBeCloseTo(2.5 + 3.2 + 4.1 + 1.9, 9)
    // 4 h + 3 h + the 2 h of the last shift that fall on 31 October.
    expect(totals.workSeconds).toBe(32400)
    // Job time 60 + 40 + 30 minutes, less the 4 paid waiting minutes.
    expect(totals.jobSeconds).toBe(7560)
    expect(totals.paidWaitSeconds).toBe(240)
    expect(totals.unpaidSeconds).toBe(24600)
    expect((totals.jobSeconds ?? 0) + (totals.paidWaitSeconds ?? 0) + (totals.unpaidSeconds ?? 0)).toBe(
      totals.workSeconds
    )
  })

  test('cross check 6: € per hour and € per paid km equal summarisePeriod over the month, not a sum of days', async () => {
    const { service, timeWorked } = setup({ records: octoberRecords() })

    const model = await service.model(COURIER, '2026-10', 'en', NOW)
    const screen = await timeWorked.earnings(
      COURIER,
      { from: '2026-10-01', to: '2026-10-31', reachFrom: null },
      { withAdminLabels: false },
      NOW
    )
    const month = summarisePeriod(
      screen.shifts.flatMap((shift) => shift.jobs),
      screen.days
    )

    expect(model.totals.centsPerHour).toBe(month.centsPerHour)
    expect(model.totals.centsPerPaidKm).toBe(month.centsPerPaidKm)
    // By hand: linked money 3200 - 350 - 120 = 2730 over 9 h; delivered money 2380 over 11.7 km.
    expect(model.totals.centsPerHour).toBe(303)
    expect(model.totals.centsPerPaidKm).toBe(203)
    // Neither is the sum of the days' own rates.
    const sumOfDayRates = screen.days.reduce((total, day) => total + (day.centsPerHour ?? 0), 0)
    expect(model.totals.centsPerHour).not.toBe(sumOfDayRates)
  })

  test("AC-3: the rider's own month on the Earnings screen (riderMonth) adds up to the same statement", async () => {
    const { service, timeWorked } = setup({ records: octoberRecords() })

    const model = await service.model(COURIER, '2026-10', 'en', NOW)
    // October is inside the rider's 2 month reach on 21 November, so the screen shows all of it.
    const screen = await timeWorked.riderMonth(COURIER, '2026-10', NOW)

    expect(screen.from).toBe('2026-10-01')
    expect(screen.to).toBe('2026-10-31')
    expect(model.totals.moneyCents).toBe(screen.days.reduce((total, day) => total + day.moneyCents, 0))
    expect(model.totals.workSeconds).toBe(screen.days.reduce((total, day) => total + day.workSeconds, 0))
    expect(model.totals.dropOffCount).toBe(screen.days.reduce((total, day) => total + day.dropOffCount, 0))
    // The same job rows as the screen lists: the jobs in its shifts plus its jobs in no shift.
    const screenJobs = [...screen.shifts.flatMap((shift) => shift.jobs), ...screen.jobsInNoShift]
    expect(model.jobs.map((job) => job.deliveryId).sort()).toEqual(screenJobs.map((job) => job.deliveryId).sort())
  })

  test('AC-2, cross check 9: the job rows plus the money linked to no job add up to the money total', async () => {
    const { service } = setup({ records: octoberRecords() })

    const model = await service.model(COURIER, '2026-10', 'en', NOW)

    const rows = model.jobs.reduce((total, job) => total + job.totalCents, 0)
    const unlinked = model.unlinked.reduce((total, line) => total + line.amountCents, 0)
    expect(rows).toBe(3080)
    expect(unlinked).toBe(120)
    expect(rows + unlinked).toBe(model.totals.moneyCents)
  })

  test('AC-2, cross checks 4, 7, 8, 9, 13: every job accepted in October is a row, oldest first, with its pay parts', async () => {
    const { service } = setup({ records: octoberRecords() })

    const model = await service.model(COURIER, '2026-10', 'en', NOW)

    // d0 (30 September) and d9 (accepted 00:25 on 1 November) are other months' jobs; d8, accepted
    // 23:30 on 31 October and ended after midnight, is October's.
    expect(
      model.jobs.map((job) => [
        job.deliveryId,
        job.end,
        job.deliveryPayCents,
        job.tipsCents,
        job.waitingCents,
        job.cancellationCents,
        job.reviewCents,
        job.otherCents,
        job.totalCents,
      ])
    ).toEqual([
      ['d1', 'DELIVERED', 350, 100, 80, 0, 0, 0, 530],
      ['d2', 'DELIVERED', 420, 0, 0, 0, 50, 0, 470],
      ['d3', EnumJobEndLabel.REASSIGNED, 0, 0, 0, 0, 0, 150, 150],
      ['d4', EnumJobEndLabel.CANCELLED, 0, 0, 0, 200, 0, 0, 200],
      ['d5', 'DELIVERED', 500, 250, 0, 0, 0, 0, 750],
      ['d6', 'DELIVERED', 300, 50, 0, 0, 0, 0, 350],
      ['d8', 'DELIVERED', 600, 30, 0, 0, 0, 0, 630],
    ])
    expect(model.jobs[2]?.otherReasons).toEqual([R.REASSIGNMENT])
    const first = model.jobs[0]
    expect(first?.pickupName).toBe('Souvlaki Bar')
    expect(first?.dropoffArea).toBe('Area d1')
    expect(first?.paidKm).toBe(2.5)
    expect(first?.minutes).toBe(30)
    expect(first?.acceptedAt).toEqual(at('2026-10-05T07:30:00Z'))
    // d8 ran 50 minutes across midnight.
    expect(model.jobs[6]?.minutes).toBe(50)
  })

  test('cross check 9: money linked to no job is listed on its day; the job in no shift is a row instead', async () => {
    const { service } = setup({ records: octoberRecords() })

    const model = await service.model(COURIER, '2026-10', 'en', NOW)

    expect(model.unlinked).toEqual([{ date: '2026-10-22', amountCents: 120 }])
  })

  test("cross check 5: the review correction written on 3 November is in October's money and named as added later", async () => {
    const { service } = setup({ records: octoberRecords() })

    const model = await service.model(COURIER, '2026-10', 'en', NOW)

    expect(model.addedLaterCents).toBe(50)
    expect(model.monthEnd).toBe('2026-10-31')
    expect(model.madeAt).toEqual(NOW)
  })

  test('cross check 3: time recorded from before the month is shown; from inside it, every time total is null', async () => {
    const before = setup({ records: octoberRecords(), recordedFrom: at('2026-01-01T00:00:00Z') })
    const inside = setup({ records: octoberRecords(), recordedFrom: at('2026-10-03T00:00:00Z') })
    const never = setup({ records: emptyRecords(), recordedFrom: null })

    expect((await before.service.model(COURIER, '2026-10', 'en', NOW)).timeRecorded).toBe(true)
    const straddling = await inside.service.model(COURIER, '2026-10', 'en', NOW)
    expect(straddling.timeRecorded).toBe(false)
    expect(straddling.totals.workSeconds).toBeNull()
    expect(straddling.totals.centsPerHour).toBeNull()
    expect(straddling.totals.moneyCents).toBe(3200)
    const none = await never.service.model(COURIER, '2026-10', 'en', NOW)
    expect(none.timeRecorded).toBe(false)
    expect(none.totals.workSeconds).toBeNull()
  })

  test('cross check 6: earnings is asked for the whole month with no reach, without admin labels', async () => {
    const { service, earnings } = setup({ records: octoberRecords() })

    await service.model(COURIER, '2026-10', 'el', NOW)

    expect(earnings).toHaveBeenCalledTimes(1)
    expect(earnings).toHaveBeenCalledWith(
      COURIER,
      { from: '2026-10-01', to: '2026-10-31', reachFrom: null },
      { withAdminLabels: false },
      NOW
    )
  })

  test("cross check 6: a month older than the rider's 2 month screen reach is still made in full", async () => {
    // Asked on 21 November the screen reaches back to 21 September only; August is the statement's alone.
    const { service, earnings } = setup({ createdAt: at('2026-05-10T09:00:00Z') })

    const model = await service.model(COURIER, '2026-08', 'en', NOW)

    expect(model.month).toBe('2026-08')
    expect(model.monthEnd).toBe('2026-08-31')
    expect(earnings).toHaveBeenCalledWith(
      COURIER,
      { from: '2026-08-01', to: '2026-08-31', reachFrom: null },
      { withAdminLabels: false },
      NOW
    )
  })

  // Value 5, cross check 16.
  test("cross check 16 (value 5): only this rider's records are read, and nothing in the model is anyone else's", async () => {
    const { service, repository, prisma } = setup({ records: octoberRecords() })

    const model = await service.model(COURIER, '2026-10', 'en', NOW)

    expect(repository.findRecords).toHaveBeenCalled()
    for (const [args] of repository.findRecords.mock.calls) {
      expect(args.courierId).toBe(COURIER)
    }
    for (const [args] of prisma.courier.findUnique.mock.calls) {
      expect(args.where).toEqual({ id: COURIER })
    }
    // The tips read asks only for this statement's own jobs.
    expect(prisma.delivery.findMany.mock.calls[0][0].where.id.in.sort()).toEqual(
      ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd8'].sort()
    )
    expect(JSON.stringify(model)).not.toMatch(/average|median|rank|another-courier/i)
  })
})

describe('StatementService.model: the header and the months it refuses (spec 0050 AC-1, AC-10, cross check 12)', () => {
  test("the header: the month, the rider's full name, the co-op name, the currency, when it was made", async () => {
    const { service } = setup()

    const model = await service.model(COURIER, '2026-10', 'en', NOW)

    expect(model.month).toBe('2026-10')
    expect(model.lang).toBe('en')
    expect(model.riderName).toBe('Nikos Rider')
    expect(model.coopName).toBe('Volos Riders')
    expect(model.currencyCode).toBe('EUR')
    expect(model.madeAt).toEqual(NOW)
  })

  test.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['missing', null],
  ])(
    "cross check 12: an instance name that is %s falls back to a plain name in the statement's language",
    async (_n, name) => {
      const { service } = setup({ coopName: name })

      expect((await service.model(COURIER, '2026-10', 'en', NOW)).coopName).toBe('The co-op')
      expect((await service.model(COURIER, '2026-10', 'el', NOW)).coopName).toBe('Ο συνεταιρισμός')
    }
  )

  test('AC-10: a month with no work is still made: no rows and zero totals', async () => {
    const { service } = setup()

    const model = await service.model(COURIER, '2026-09', 'el', NOW)

    expect(model.jobs).toEqual([])
    expect(model.unlinked).toEqual([])
    expect(model.totals.moneyCents).toBe(0)
    expect(model.totals.dropOffCount).toBe(0)
    expect(model.totals.workSeconds).toBe(0)
    expect(model.totals.centsPerHour).toBeNull()
    expect(model.addedLaterCents).toBe(0)
  })

  test.each([
    ['the current month', '2026-11'],
    ['a month that has not come', '2027-01'],
    ['a month before the rider joined', '2026-07'],
  ])('AC-10: %s answers 400 and reads no earnings', async (_name, month) => {
    const { service, earnings } = setup()

    await expect(service.model(COURIER, month, 'el', NOW)).rejects.toBeInstanceOf(BadRequestException)
    expect(earnings).not.toHaveBeenCalled()
  })

  test.each([['2026-13'], ['2026-1'], ['october'], [''], [undefined], [202610], ['2026-10-01']])(
    'AC-10: a month written as %p answers 400',
    async (month) => {
      const { service, earnings } = setup()

      await expect(service.model(COURIER, month, 'el', NOW)).rejects.toBeInstanceOf(BadRequestException)
      expect(earnings).not.toHaveBeenCalled()
    }
  )
})

describe('StatementService.offeredMonths (spec 0050 AC-1, cross check 2)', () => {
  test('complete months only, newest first, back to the month the rider was created', async () => {
    const { service } = setup({ createdAt: at('2026-08-15T09:00:00Z') })

    expect(await service.offeredMonths(COURIER, NOW)).toEqual(['2026-10', '2026-09', '2026-08'])
  })

  test('the current month is never offered', async () => {
    const { service } = setup()

    expect(await service.offeredMonths(COURIER, NOW)).not.toContain('2026-11')
  })

  test('cross check 2: a first accepted job earlier than the creation date moves the first month back', async () => {
    const { service } = setup({ createdAt: at('2026-08-15T09:00:00Z'), firstAccept: at('2026-06-10T09:00:00Z') })

    expect(await service.offeredMonths(COURIER, NOW)).toEqual(['2026-10', '2026-09', '2026-08', '2026-07', '2026-06'])
  })

  test('cross check 2: a first accepted job later than the creation date changes nothing', async () => {
    const { service } = setup({ createdAt: at('2026-08-15T09:00:00Z'), firstAccept: at('2026-10-02T09:00:00Z') })

    expect(await service.offeredMonths(COURIER, NOW)).toEqual(['2026-10', '2026-09', '2026-08'])
  })

  test("cross check 2: the first job is the rider's oldest ACCEPTED event carrying their id", async () => {
    const { service, prisma } = setup()

    await service.offeredMonths(COURIER, NOW)

    expect(prisma.deliveryEvent.findFirst).toHaveBeenCalledTimes(1)
    const args = prisma.deliveryEvent.findFirst.mock.calls[0][0]
    expect(args.where).toEqual({ courierId: COURIER, type: EnumDeliveryEventType.ACCEPTED })
    expect(args.orderBy).toEqual({ createdAt: 'asc' })
    expect(prisma.courier.findUnique.mock.calls[0][0].where).toEqual({ id: COURIER })
  })

  test('AC-1: the first month is read in Athens time (01:30 on 1 July in Athens is still 30 June in UTC)', async () => {
    const { service } = setup({ createdAt: at('2026-08-15T09:00:00Z'), firstAccept: at('2026-06-30T22:30:00Z') })

    const months = await service.offeredMonths(COURIER, NOW)

    expect(months[months.length - 1]).toBe('2026-07')
  })

  test('AC-1: a rider created at 00:30 on 1 October in Athens starts in October', async () => {
    const { service } = setup({ createdAt: at('2026-09-30T21:30:00Z') })

    expect(await service.offeredMonths(COURIER, NOW)).toEqual(['2026-10'])
  })

  test('AC-1: the last complete month is read in Athens time', async () => {
    const { service } = setup({ createdAt: at('2026-08-15T09:00:00Z') })

    // 23:30 on 31 October in Athens: October is not over.
    expect((await service.offeredMonths(COURIER, at('2026-10-31T21:30:00Z')))[0]).toBe('2026-09')
    // 00:30 on 1 November in Athens (still 31 October in UTC): October is complete.
    expect((await service.offeredMonths(COURIER, at('2026-10-31T22:30:00Z')))[0]).toBe('2026-10')
  })

  test('a rider created this month is offered nothing', async () => {
    const { service } = setup({ createdAt: at('2026-11-03T09:00:00Z') })

    expect(await service.offeredMonths(COURIER, NOW)).toEqual([])
  })

  test('a rider created last month is offered that one month', async () => {
    const { service } = setup({ createdAt: at('2026-10-28T09:00:00Z') })

    expect(await service.offeredMonths(COURIER, NOW)).toEqual(['2026-10'])
  })

  test('the months run across a new year', async () => {
    const { service } = setup({ createdAt: at('2026-11-03T09:00:00Z') })

    expect(await service.offeredMonths(COURIER, at('2027-02-10T10:00:00Z'))).toEqual(['2027-01', '2026-12', '2026-11'])
  })

  test("an unknown rider answers the project's 404", async () => {
    const { service, prisma } = setup()
    prisma.courier.findUnique.mockResolvedValue(null)

    await expect(service.offeredMonths('nobody', NOW)).rejects.toBeInstanceOf(errors.NotFoundException)
  })

  test('monthsBetween lists every month from the last back to the first', () => {
    expect(monthsBetween('2026-11', '2027-02')).toEqual(['2027-02', '2027-01', '2026-12', '2026-11'])
    expect(monthsBetween('2026-10', '2026-10')).toEqual(['2026-10'])
    expect(monthsBetween('2026-11', '2026-10')).toEqual([])
  })
})

describe('StatementService.file (spec 0050 AC-4, AC-5, cross check 15)', () => {
  test('the CSV: text/csv in UTF-8, a download, named for the month only, starting with the byte order mark', async () => {
    const { service } = setup({ records: octoberRecords() })

    const file = await service.file(COURIER, '2026-10', 'csv', 'en', NOW)

    expect(file.contentType).toBe('text/csv; charset=utf-8')
    expect(file.disposition).toBe('attachment')
    expect(file.filename).toBe('statement-2026-10.csv')
    expect(Buffer.isBuffer(file.body)).toBe(true)
    expect([...file.body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const text = file.body.toString('utf8')
    expect(text).toContain('"Souvlaki Bar"')
    expect(text).toContain('"Το Κουτούκι"')
    expect(text).toContain('"Money";"32.00"')
    expect(text).toContain('"Added after 2026-10-31: 0.50"')
  })

  test('the PDF: application/pdf, opened in place, named for the month only', async () => {
    const { service } = setup({ records: octoberRecords() })

    const file = await service.file(COURIER, '2026-10', 'pdf', 'el', NOW)

    expect(file.contentType).toBe('application/pdf')
    expect(file.disposition).toBe('inline')
    expect(file.filename).toBe('statement-2026-10.pdf')
    expect(file.body.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  test("cross check 15: no filename carries the rider's name or id", async () => {
    const { service } = setup()

    for (const format of ['pdf', 'csv'] as const) {
      const { filename } = await service.file(COURIER, '2026-09', format, 'en', NOW)
      expect(filename).toMatch(/^statement-\d{4}-\d{2}\.(pdf|csv)$/)
      expect(filename).not.toMatch(/nikos|rider|courier/i)
    }
  })

  test('the language asked for is the language of the file', async () => {
    const { service } = setup()

    const greek = (await service.file(COURIER, '2026-10', 'csv', 'el', NOW)).body.toString('utf8')
    const english = (await service.file(COURIER, '2026-10', 'csv', 'en', NOW)).body.toString('utf8')

    expect(greek).toContain('Δεν είναι τιμολόγιο')
    expect(english).toContain('It is not an invoice.')
  })

  test("AC-9: a rider's own download is not recorded anywhere", async () => {
    const { service, prisma, accounts } = setup()

    await service.file(COURIER, '2026-10', 'csv', 'el', NOW)

    expect(prisma.statementDownload.create).not.toHaveBeenCalled()
    expect(accounts.record).not.toHaveBeenCalled()
  })

  test('AC-10: a month outside the offered ones answers 400', async () => {
    const { service } = setup()

    await expect(service.file(COURIER, '2026-11', 'pdf', 'el', NOW)).rejects.toBeInstanceOf(BadRequestException)
  })
})

describe('StatementService.fileForAdmin (spec 0050 AC-9, cross check 14)', () => {
  test('the admin gets the very file the rider gets', async () => {
    const { service } = setup({ records: octoberRecords() })

    const forRider = await service.file(COURIER, '2026-10', 'csv', 'en', NOW)
    const forAdmin = await service.fileForAdmin(COURIER, '2026-10', 'csv', 'en', ADMIN, NOW)

    expect(forAdmin.body.equals(forRider.body)).toBe(true)
    expect(forAdmin.filename).toBe(forRider.filename)
    expect(forAdmin.contentType).toBe(forRider.contentType)
    expect(forAdmin.disposition).toBe(forRider.disposition)
  })

  test('AC-9: each admin download writes one StatementDownload row: who, whose, which month, which format', async () => {
    const { service, prisma } = setup()

    await service.fileForAdmin(COURIER, '2026-10', 'pdf', 'el', ADMIN, NOW)

    expect(prisma.statementDownload.create).toHaveBeenCalledTimes(1)
    expect(prisma.statementDownload.create).toHaveBeenCalledWith({
      data: { adminUserId: ADMIN, courierId: COURIER, month: '2026-10', format: 'pdf' },
    })
  })

  test('cross check 14: and one STATEMENT_DOWNLOADED account change, so the rider sees it in "Changes by the co-op"', async () => {
    const { service, accounts } = setup()

    await service.fileForAdmin(COURIER, '2026-09', 'csv', 'el', ADMIN, NOW)

    expect(accounts.record).toHaveBeenCalledTimes(1)
    const [changes] = accounts.record.mock.calls[0]
    expect(changes).toEqual([
      {
        courierId: COURIER,
        actorUserId: ADMIN,
        actorIsRider: false,
        kind: EnumCourierAccountChangeKind.STATEMENT_DOWNLOADED,
        field: 'statement',
        newValue: '2026-09 CSV',
      },
    ])
  })

  test.each([
    ['the current month', '2026-11'],
    ['a month before the rider joined', '2026-07'],
    ['a malformed month', 'last-month'],
  ])('AC-9, AC-10: %s is refused with 400 and nothing is recorded', async (_name, month) => {
    const { service, prisma, accounts } = setup()

    await expect(service.fileForAdmin(COURIER, month, 'pdf', 'el', ADMIN, NOW)).rejects.toBeInstanceOf(
      BadRequestException
    )
    expect(prisma.statementDownload.create).not.toHaveBeenCalled()
    expect(accounts.record).not.toHaveBeenCalled()
  })
})

describe('StatementService.downloads (spec 0050 AC-9)', () => {
  test("this rider's downloads, newest first, each with who and when", async () => {
    const { service, prisma } = setup()
    prisma.statementDownload.findMany.mockResolvedValue([
      {
        id: 'dl-2',
        adminUserId: ADMIN,
        courierId: COURIER,
        month: '2026-10',
        format: 'pdf',
        createdAt: at('2026-11-20T09:00:00Z'),
        admin: { email: 'anna@coop.gr' },
      },
      {
        id: 'dl-1',
        adminUserId: ADMIN,
        courierId: COURIER,
        month: '2026-09',
        format: 'csv',
        createdAt: at('2026-11-01T09:00:00Z'),
        admin: { email: null },
      },
    ])

    const rows = await service.downloads(COURIER)

    expect(rows).toEqual([
      {
        id: 'dl-2',
        month: '2026-10',
        format: 'pdf',
        createdAt: at('2026-11-20T09:00:00Z'),
        adminEmail: 'anna@coop.gr',
      },
      { id: 'dl-1', month: '2026-09', format: 'csv', createdAt: at('2026-11-01T09:00:00Z'), adminEmail: null },
    ])
    const args = prisma.statementDownload.findMany.mock.calls[0][0]
    expect(args.where).toEqual({ courierId: COURIER })
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }])
  })
})

describe('formatOf (spec 0050 AC-9, AC-10)', () => {
  test('pdf and csv pass', () => {
    expect(formatOf('pdf')).toBe('pdf')
    expect(formatOf('csv')).toBe('csv')
  })

  test.each([[undefined], [null], [''], ['PDF'], ['xlsx'], ['pdf,csv'], [['pdf']], [1]])(
    'anything else (%p) answers 400',
    (value) => {
      expect(() => formatOf(value)).toThrow(BadRequestException)
    }
  )
})
