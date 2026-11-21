import { EnumCourierCompensationReason } from '@prisma/types'
import { summarisePeriod } from 'src/domains/time-worked/period-figures'
import { EnumJobEndLabel } from 'src/domains/time-worked/worked-shifts'
import { StatementSource, buildStatement, jobRow, statementTotals } from './statement-model'
import { compensation, day, workedJob } from './statement-test-fixtures'

// Spec 0050 (row 76): the pure statement model. Written from the spec's acceptance criteria and its
// "Cross check, 2026-11-20" section, not from the code.

const R = EnumCourierCompensationReason
const NOW = new Date('2026-11-21T10:00:00Z')

describe('jobRow (spec 0050 AC-2, cross checks 7, 8, 13)', () => {
  test('cross check 7: a dropped off job splits its money into delivery pay and tips', () => {
    const row = jobRow(workedJob({ droppedOff: true, deliveryMoneyCents: 450 }), 100, NOW)

    expect(row.deliveryPayCents).toBe(350)
    expect(row.tipsCents).toBe(100)
    expect(row.totalCents).toBe(450)
  })

  test('cross check 7: a job that did not end in a drop off shows no tips, whatever the delivery carries', () => {
    const row = jobRow(
      workedJob({ droppedOff: false, deliveryMoneyCents: 0, endLabel: EnumJobEndLabel.REASSIGNED }),
      77,
      NOW
    )

    expect(row.tipsCents).toBe(0)
    expect(row.deliveryPayCents).toBe(0)
    expect(row.totalCents).toBe(0)
  })

  test('cross check 8: each compensation lands in its own fixed column', () => {
    const row = jobRow(
      workedJob({
        deliveryMoneyCents: 450,
        compensations: [
          compensation(R.WAITING, 80),
          compensation(R.CANCELLATION, 200),
          compensation(R.REMOVAL, 30),
          compensation(R.RETURN_TRIP, 110),
          compensation(R.REVIEW, 55),
        ],
      }),
      100,
      NOW
    )

    expect(row.waitingCents).toBe(80)
    expect(row.cancellationCents).toBe(200)
    expect(row.removalCents).toBe(30)
    expect(row.returnTripCents).toBe(110)
    expect(row.reviewCents).toBe(55)
    expect(row.otherCents).toBe(0)
    expect(row.otherReasons).toEqual([])
    expect(row.totalCents).toBe(450 + 80 + 200 + 30 + 110 + 55)
  })

  test('cross check 8: two payments of one kind add up in that column', () => {
    const row = jobRow(
      workedJob({ compensations: [compensation(R.WAITING, 80), compensation(R.WAITING, 40, '2026-10-05T08:05:00Z')] }),
      0,
      NOW
    )

    expect(row.waitingCents).toBe(120)
  })

  test('cross check 8: REASSIGNMENT goes to Other and is named once for the note column', () => {
    const row = jobRow(
      workedJob({
        droppedOff: false,
        deliveryMoneyCents: 0,
        compensations: [compensation(R.REASSIGNMENT, 150), compensation(R.REASSIGNMENT, 25, '2026-10-05T09:00:00Z')],
      }),
      0,
      NOW
    )

    expect(row.otherCents).toBe(175)
    expect(row.otherReasons).toEqual([R.REASSIGNMENT])
    expect(row.waitingCents + row.cancellationCents + row.removalCents + row.returnTripCents + row.reviewCents).toBe(0)
    expect(row.totalCents).toBe(175)
  })

  test('a review correction that takes money back lowers the column and the total', () => {
    const row = jobRow(workedJob({ deliveryMoneyCents: 450, compensations: [compensation(R.REVIEW, -30)] }), 0, NOW)

    expect(row.reviewCents).toBe(-30)
    expect(row.totalCents).toBe(420)
  })

  // Cross check 7, for every shape of job: the pay parts plus tips equal the job total.
  test.each([
    ['delivered with tips', workedJob({ deliveryMoneyCents: 450 }), 100],
    ['delivered, no tips', workedJob({ deliveryMoneyCents: 420 }), 0],
    ['tips the whole of the money', workedJob({ deliveryMoneyCents: 100 }), 100],
    ['a tip larger than the money recorded', workedJob({ deliveryMoneyCents: 100 }), 250],
    ['not dropped off, a tip on the delivery', workedJob({ droppedOff: false, deliveryMoneyCents: 0 }), 90],
    [
      'every kind of compensation',
      workedJob({
        deliveryMoneyCents: 610,
        compensations: [
          compensation(R.WAITING, 80),
          compensation(R.CANCELLATION, 200),
          compensation(R.REMOVAL, 30),
          compensation(R.RETURN_TRIP, 110),
          compensation(R.REVIEW, -55),
          compensation(R.REASSIGNMENT, 150),
        ],
      }),
      60,
    ],
  ])('cross check 7: the pay parts plus tips equal the job total (%s)', (_name, job, tips) => {
    const row = jobRow(job, tips, NOW)

    const parts =
      row.deliveryPayCents +
      row.tipsCents +
      row.waitingCents +
      row.cancellationCents +
      row.removalCents +
      row.returnTripCents +
      row.reviewCents +
      row.otherCents
    expect(parts).toBe(row.totalCents)
    // The total is the job's own money on the screen: its delivery money plus every linked compensation.
    expect(row.totalCents).toBe(job.compensations.reduce((sum, c) => sum + c.amountCents, job.deliveryMoneyCents))
    expect(row.deliveryPayCents).toBeGreaterThanOrEqual(0)
    expect(row.tipsCents).toBeGreaterThanOrEqual(0)
  })

  test('AC-2: carries when, the restaurant, the area, the km and whole minutes from accept to end', () => {
    const row = jobRow(
      workedJob({
        deliveryId: 'del-42',
        pickupName: 'Το Κουτούκι',
        dropoffArea: 'Ιάσονος',
        paidKm: 3.2,
        acceptedAt: new Date('2026-10-05T07:30:00Z'),
        // 25 minutes and 40 seconds: rounds to 26.
        endedAt: new Date('2026-10-05T07:55:40Z'),
      }),
      0,
      NOW
    )

    expect(row.deliveryId).toBe('del-42')
    expect(row.acceptedAt).toEqual(new Date('2026-10-05T07:30:00Z'))
    expect(row.pickupName).toBe('Το Κουτούκι')
    expect(row.dropoffArea).toBe('Ιάσονος')
    expect(row.paidKm).toBe(3.2)
    expect(row.minutes).toBe(26)
  })

  // Review ruling (2026-11-21): km are paid only on a job that ended in the rider's drop off, so any other
  // job shows none, even though its delivery has a distance.
  test.each([
    ['reassigned', EnumJobEndLabel.REASSIGNED],
    ['cancelled before pickup', EnumJobEndLabel.CANCELLED],
    ['cancelled after pickup', EnumJobEndLabel.CANCELLED_AFTER_PICKUP],
    ['removed', EnumJobEndLabel.REMOVED],
    ['handed back', EnumJobEndLabel.HANDED_BACK],
    ['still in progress', EnumJobEndLabel.IN_PROGRESS],
  ])('review fix: a job that was %s carries no km', (_name, endLabel) => {
    const row = jobRow(workedJob({ droppedOff: false, deliveryMoneyCents: 0, paidKm: 3.2, endLabel }), 0, NOW)

    expect(row.paidKm).toBeNull()
  })

  test('review fix: a job that ended in the drop off keeps its km, and one with no distance stored has none', () => {
    expect(jobRow(workedJob({ droppedOff: true, paidKm: 3.2 }), 0, NOW).paidKm).toBe(3.2)
    expect(jobRow(workedJob({ droppedOff: true, paidKm: 0 }), 0, NOW).paidKm).toBe(0)
    expect(jobRow(workedJob({ droppedOff: true, paidKm: null }), 0, NOW).paidKm).toBeNull()
  })

  test('cross check 13: a job still open counts its minutes to the moment the statement is made', () => {
    const row = jobRow(
      workedJob({
        acceptedAt: new Date('2026-11-21T09:15:00Z'),
        endedAt: null,
        droppedOff: false,
        deliveryMoneyCents: 0,
        endLabel: EnumJobEndLabel.IN_PROGRESS,
      }),
      0,
      NOW
    )

    expect(row.minutes).toBe(45)
    expect(row.end).toBe(EnumJobEndLabel.IN_PROGRESS)
  })

  test('cross check 13: a delivered job reads DELIVERED, any other carries its end label', () => {
    expect(jobRow(workedJob({ endLabel: null }), 0, NOW).end).toBe('DELIVERED')
    for (const label of Object.values(EnumJobEndLabel)) {
      expect(jobRow(workedJob({ droppedOff: false, deliveryMoneyCents: 0, endLabel: label }), 0, NOW).end).toBe(label)
    }
  })
})

describe('statementTotals (spec 0050 AC-3, cross checks 3, 6)', () => {
  const jobsInShifts = [
    workedJob({ deliveryId: 'a', deliveryMoneyCents: 450, paidKm: 2.5, compensations: [compensation(R.WAITING, 80)] }),
    workedJob({ deliveryId: 'b', deliveryMoneyCents: 420, paidKm: 3.2, acceptedAt: new Date('2026-10-12T15:00:00Z') }),
  ]
  const source: StatementSource = {
    days: [
      day('2026-10-05', {
        workSeconds: 14400,
        jobSeconds: 3360,
        paidWaitSeconds: 240,
        unpaidSeconds: 10800,
        moneyCents: 530,
        dropOffCount: 1,
        paidKm: 2.5,
      }),
      day('2026-10-12', {
        workSeconds: 10800,
        jobSeconds: 2400,
        paidWaitSeconds: 0,
        unpaidSeconds: 8400,
        moneyCents: 540,
        unlinkedMoneyCents: 120,
        noJobMoneyCents: 120,
        dropOffCount: 1,
        paidKm: 3.2,
      }),
    ],
    jobsInShifts,
    jobsInNoShift: [],
    recordedFrom: new Date('2026-01-01T00:00:00Z'),
    currencyCode: 'EUR',
  }

  test('cross check 6: money, drop offs, paid km and seconds are the sums of the days', () => {
    const totals = statementTotals(source, true)

    expect(totals.moneyCents).toBe(1070)
    expect(totals.dropOffCount).toBe(2)
    expect(totals.paidKm).toBe(2.5 + 3.2)
    expect(totals.workSeconds).toBe(25200)
    expect(totals.jobSeconds).toBe(5760)
    expect(totals.paidWaitSeconds).toBe(240)
    expect(totals.unpaidSeconds).toBe(19200)
  })

  test('cross check 6: € per hour and € per paid km are summarisePeriod over the month, not a sum or mean of days', () => {
    const totals = statementTotals(source, true)
    const month = summarisePeriod(jobsInShifts, source.days)

    // Linked money (1070 - 120) over 7 hours; delivered money (530 + 420) over 5.7 km.
    expect(totals.centsPerHour).toBe(136)
    expect(totals.centsPerPaidKm).toBe(167)
    expect(totals.centsPerHour).toBe(month.centsPerHour)
    expect(totals.centsPerPaidKm).toBe(month.centsPerPaidKm)
  })

  test('cross check 3: with time not recorded every time total and € per hour is null, never 0; money stays', () => {
    const totals = statementTotals(source, false)

    expect(totals.workSeconds).toBeNull()
    expect(totals.jobSeconds).toBeNull()
    expect(totals.paidWaitSeconds).toBeNull()
    expect(totals.unpaidSeconds).toBeNull()
    expect(totals.centsPerHour).toBeNull()
    expect(totals.moneyCents).toBe(1070)
    expect(totals.dropOffCount).toBe(2)
    expect(totals.centsPerPaidKm).toBe(167)
  })

  test('AC-10: a month with no work gives zero totals and no rates', () => {
    const totals = statementTotals({ ...source, days: [day('2026-10-01'), day('2026-10-02')], jobsInShifts: [] }, true)

    expect(totals).toEqual({
      moneyCents: 0,
      dropOffCount: 0,
      paidKm: 0,
      workSeconds: 0,
      jobSeconds: 0,
      paidWaitSeconds: 0,
      unpaidSeconds: 0,
      centsPerHour: null,
      centsPerPaidKm: null,
    })
  })
})

describe('buildStatement (spec 0050 AC-2, cross checks 3, 5, 9, 16)', () => {
  // October 2026 in Athens: starts 30 Sept 21:00 UTC (UTC+3), ends 31 Oct 22:00 UTC (UTC+2 after the clocks change).
  const monthStart = new Date('2026-09-30T21:00:00Z')
  const nextMonthStart = new Date('2026-10-31T22:00:00Z')

  const build = (source: Partial<StatementSource> = {}, tips = new Map<string, number>()) =>
    buildStatement({
      month: '2026-10',
      monthStart,
      monthEnd: '2026-10-31',
      nextMonthStart,
      lang: 'en',
      coopName: 'Volos Riders',
      riderName: 'Nikos Rider',
      madeAt: NOW,
      source: {
        days: [],
        jobsInShifts: [],
        jobsInNoShift: [],
        recordedFrom: new Date('2026-01-01T00:00:00Z'),
        currencyCode: 'EUR',
        ...source,
      },
      tipsByDelivery: tips,
    })

  test('carries the header facts through unchanged', () => {
    const model = build()

    expect(model.month).toBe('2026-10')
    expect(model.lang).toBe('en')
    expect(model.coopName).toBe('Volos Riders')
    expect(model.riderName).toBe('Nikos Rider')
    expect(model.madeAt).toEqual(NOW)
    expect(model.currencyCode).toBe('EUR')
    expect(model.monthEnd).toBe('2026-10-31')
  })

  test('cross check 9: jobs in a shift and jobs in no shift are one list, sorted by accept time', () => {
    const model = build({
      jobsInShifts: [
        workedJob({ deliveryId: 'third', acceptedAt: new Date('2026-10-20T10:00:00Z') }),
        workedJob({ deliveryId: 'first', acceptedAt: new Date('2026-10-02T10:00:00Z') }),
      ],
      jobsInNoShift: [
        workedJob({ deliveryId: 'fourth', acceptedAt: new Date('2026-10-25T10:00:00Z') }),
        workedJob({ deliveryId: 'second', acceptedAt: new Date('2026-10-11T10:00:00Z') }),
      ],
    })

    expect(model.jobs.map((job) => job.deliveryId)).toEqual(['first', 'second', 'third', 'fourth'])
  })

  test('two jobs accepted at the same instant keep one fixed order', () => {
    const at = new Date('2026-10-02T10:00:00Z')
    const one = build({
      jobsInShifts: [workedJob({ deliveryId: 'b', acceptedAt: at }), workedJob({ deliveryId: 'a', acceptedAt: at })],
    })
    const other = build({
      jobsInShifts: [workedJob({ deliveryId: 'a', acceptedAt: at }), workedJob({ deliveryId: 'b', acceptedAt: at })],
    })

    expect(one.jobs.map((job) => job.deliveryId)).toEqual(['a', 'b'])
    expect(other.jobs.map((job) => job.deliveryId)).toEqual(['a', 'b'])
  })

  test('cross check 7: each job takes its own tips from the tips read, and none when it has no entry', () => {
    const model = build(
      {
        jobsInShifts: [
          workedJob({ deliveryId: 'tipped', deliveryMoneyCents: 450 }),
          workedJob({ deliveryId: 'plain', deliveryMoneyCents: 420, acceptedAt: new Date('2026-10-06T07:30:00Z') }),
        ],
      },
      new Map([['tipped', 100]])
    )

    expect(model.jobs.map((job) => [job.deliveryId, job.deliveryPayCents, job.tipsCents])).toEqual([
      ['tipped', 350, 100],
      ['plain', 420, 0],
    ])
  })

  test('cross check 9: money that belongs to no job is listed per day, only on days that have any', () => {
    const model = build({
      days: [
        day('2026-10-01'),
        day('2026-10-20', { moneyCents: 350, unlinkedMoneyCents: 350, noJobMoneyCents: 0 }),
        day('2026-10-22', { moneyCents: 120, unlinkedMoneyCents: 120, noJobMoneyCents: 120 }),
        day('2026-10-23', { moneyCents: -40, unlinkedMoneyCents: -40, noJobMoneyCents: -40 }),
      ],
    })

    // 20 October's unlinked money is a job in no shift: it is a job row, not listed here a second time.
    expect(model.unlinked).toEqual([
      { date: '2026-10-22', amountCents: 120 },
      { date: '2026-10-23', amountCents: -40 },
    ])
  })

  describe('cross check 3: time recorded', () => {
    const days = [day('2026-10-05', { workSeconds: 3600, jobSeconds: 1800, unpaidSeconds: 1800, moneyCents: 450 })]
    const jobsInShifts = [workedJob()]

    test('recording began before the month: time is shown', () => {
      const model = build({ days, jobsInShifts, recordedFrom: new Date('2026-09-01T00:00:00Z') })

      expect(model.timeRecorded).toBe(true)
      expect(model.totals.workSeconds).toBe(3600)
      expect(model.totals.centsPerHour).toBe(450)
    })

    test('recording began at the very first moment of the month: time is shown', () => {
      expect(build({ days, jobsInShifts, recordedFrom: monthStart }).timeRecorded).toBe(true)
    })

    test.each([
      ['never (recordedFrom is null)', null],
      ['a second after the month began', new Date(monthStart.getTime() + 1000)],
      ['in the middle of the month (it straddles)', new Date('2026-10-15T09:00:00Z')],
      ['after the month', new Date('2026-11-10T09:00:00Z')],
    ])('recording began %s: every time total is null, the money is still there', (_name, recordedFrom) => {
      const model = build({ days, jobsInShifts, recordedFrom })

      expect(model.timeRecorded).toBe(false)
      expect(model.totals.workSeconds).toBeNull()
      expect(model.totals.jobSeconds).toBeNull()
      expect(model.totals.paidWaitSeconds).toBeNull()
      expect(model.totals.unpaidSeconds).toBeNull()
      expect(model.totals.centsPerHour).toBeNull()
      expect(model.totals.moneyCents).toBe(450)
    })
  })

  describe('cross check 5: money added after the month ended', () => {
    test('sums the compensations written on or after the next month began, on jobs in and out of a shift', () => {
      const model = build({
        jobsInShifts: [
          workedJob({
            deliveryId: 'a',
            compensations: [
              compensation(R.WAITING, 80, '2026-10-05T08:00:00Z'),
              // The last millisecond of October in Athens: not added later.
              compensation(R.REVIEW, 11, '2026-10-31T21:59:59.999Z'),
              // The first moment of November in Athens.
              compensation(R.REVIEW, 50, '2026-10-31T22:00:00.000Z'),
            ],
          }),
        ],
        jobsInNoShift: [
          workedJob({
            deliveryId: 'b',
            acceptedAt: new Date('2026-10-20T12:00:00Z'),
            compensations: [compensation(R.CANCELLATION, 200, '2026-11-03T09:00:00Z')],
          }),
        ],
      })

      expect(model.addedLaterCents).toBe(250)
    })

    test('is 0 when everything was written inside the month', () => {
      const model = build({
        jobsInShifts: [workedJob({ compensations: [compensation(R.WAITING, 80, '2026-10-05T08:00:00Z')] })],
      })

      expect(model.addedLaterCents).toBe(0)
    })

    test('a late correction that takes money back shows as a negative amount', () => {
      const model = build({
        jobsInShifts: [workedJob({ compensations: [compensation(R.REVIEW, -30, '2026-11-02T09:00:00Z')] })],
      })

      expect(model.addedLaterCents).toBe(-30)
    })
  })

  test('AC-10: a month with no work is still a statement: no rows, nothing unlinked, zero totals', () => {
    const model = build({ days: [day('2026-10-01'), day('2026-10-02')] })

    expect(model.jobs).toEqual([])
    expect(model.unlinked).toEqual([])
    expect(model.totals.moneyCents).toBe(0)
    expect(model.totals.dropOffCount).toBe(0)
    expect(model.addedLaterCents).toBe(0)
  })

  // Value 5 and cross check 16: the model has no place for another rider's figure or a co-op average.
  // A new field must be added here on purpose, where a reviewer sees it.
  test('cross check 16 (value 5): the model holds exactly these fields, none of them a comparison', () => {
    const model = build({
      days: [day('2026-10-05', { moneyCents: 450, noJobMoneyCents: 10, unlinkedMoneyCents: 10 })],
      jobsInShifts: [workedJob()],
    })

    expect(Object.keys(model).sort()).toEqual(
      [
        'addedLaterCents',
        'coopName',
        'currencyCode',
        'jobs',
        'lang',
        'madeAt',
        'month',
        'monthEnd',
        'riderName',
        'timeRecorded',
        'totals',
        'unlinked',
      ].sort()
    )
    expect(Object.keys(model.totals).sort()).toEqual(
      [
        'centsPerHour',
        'centsPerPaidKm',
        'dropOffCount',
        'jobSeconds',
        'moneyCents',
        'paidKm',
        'paidWaitSeconds',
        'unpaidSeconds',
        'workSeconds',
      ].sort()
    )
    expect(Object.keys(model.jobs[0] ?? {}).sort()).toEqual(
      [
        'acceptedAt',
        'cancellationCents',
        'deliveryId',
        'deliveryPayCents',
        'dropoffArea',
        'end',
        'minutes',
        'otherCents',
        'otherReasons',
        'paidKm',
        'pickupName',
        'removalCents',
        'returnTripCents',
        'reviewCents',
        'tipsCents',
        'totalCents',
        'waitingCents',
      ].sort()
    )
    expect(Object.keys(model.unlinked[0] ?? {}).sort()).toEqual(['amountCents', 'date'])
    expect(JSON.stringify(model)).not.toMatch(/average|median|rank|coop(?!Name)|rating|score/i)
  })
})
