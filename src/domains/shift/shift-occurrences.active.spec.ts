import {
  SHIFT_SCHEDULE_DAYS,
  athensDate,
  athensInstant,
  clockText,
  dropDeadline,
  dropUntilText,
  isoWeekday,
  occurrenceTimes,
  scheduleDates,
} from './shift-occurrences'

// Spec 0027 (row 78), "Times": the pure Athens time rules behind the schedule. Athens is UTC+2 in winter
// and UTC+3 in summer; summer time starts 2027-03-28 03:00 (to 04:00) and ends 2026-10-25 04:00 (to 03:00).
describe('shift occurrences (spec 0027, AC-2 times)', () => {
  // Every expected instant is written in UTC, so a rule that leaned on the server process's own zone
  // (a raw `new Date('YYYY-MM-DD HH:mm')`) fails here on any machine not in Athens, and the autumn
  // repeated hour fails it even in Athens. Setting process.env.TZ inside a test does not work under Jest
  // (each test file gets a copy of process.env), so the zone is not switched here; run the file with
  // TZ=UTC to check it from another zone.

  describe('scheduleDates', () => {
    it('has 14 entries (SHIFT_SCHEDULE_DAYS)', () => {
      expect(SHIFT_SCHEDULE_DAYS).toBe(14)
      expect(scheduleDates(new Date('2026-11-03T10:00:00.000Z'))).toHaveLength(14)
    })

    it('lists the 14 Athens dates starting today, across a month end', () => {
      expect(scheduleDates(new Date('2026-11-25T10:00:00.000Z'))).toEqual([
        '2026-11-25',
        '2026-11-26',
        '2026-11-27',
        '2026-11-28',
        '2026-11-29',
        '2026-11-30',
        '2026-12-01',
        '2026-12-02',
        '2026-12-03',
        '2026-12-04',
        '2026-12-05',
        '2026-12-06',
        '2026-12-07',
        '2026-12-08',
      ])
    })

    it('starts at the Athens date, not the UTC date, just after Athens midnight', () => {
      // 23:30 UTC on 3 Nov is 01:30 on 4 Nov in Athens.
      const dates = scheduleDates(new Date('2026-11-03T23:30:00.000Z'))
      expect(dates[0]).toBe('2026-11-04')
      expect(dates[13]).toBe('2026-11-17')
      // 22:00 UTC is exactly Athens midnight (winter): already the next day.
      expect(scheduleDates(new Date('2026-11-03T22:00:00.000Z'))[0]).toBe('2026-11-04')
      // One millisecond before Athens midnight is still the 3rd.
      expect(scheduleDates(new Date('2026-11-03T21:59:59.999Z'))[0]).toBe('2026-11-03')
    })

    it('uses summer time near midnight UTC in July (Athens is UTC+3)', () => {
      expect(scheduleDates(new Date('2026-07-15T21:30:00.000Z'))[0]).toBe('2026-07-16')
      expect(scheduleDates(new Date('2026-07-15T20:59:00.000Z'))[0]).toBe('2026-07-15')
    })

    it('neither skips nor repeats a date across the autumn and spring clock changes', () => {
      const autumn = scheduleDates(new Date('2026-10-20T10:00:00.000Z'))
      expect(autumn).toEqual([
        '2026-10-20',
        '2026-10-21',
        '2026-10-22',
        '2026-10-23',
        '2026-10-24',
        '2026-10-25',
        '2026-10-26',
        '2026-10-27',
        '2026-10-28',
        '2026-10-29',
        '2026-10-30',
        '2026-10-31',
        '2026-11-01',
        '2026-11-02',
      ])
      const spring = scheduleDates(new Date('2027-03-27T21:30:00.000Z'))
      expect(spring[0]).toBe('2027-03-27')
      expect(spring[1]).toBe('2027-03-28')
      expect(spring[2]).toBe('2027-03-29')
      expect(new Set(spring).size).toBe(14)
    })
  })

  describe('athensDate', () => {
    it('is the Athens calendar date of an instant', () => {
      expect(athensDate(new Date('2026-11-03T21:59:00.000Z'))).toBe('2026-11-03')
      expect(athensDate(new Date('2026-11-03T22:00:00.000Z'))).toBe('2026-11-04')
    })
  })

  describe('isoWeekday', () => {
    it.each([
      ['2026-11-02', 1], // Monday
      ['2026-11-03', 2],
      ['2026-11-06', 5], // Friday
      ['2026-11-07', 6],
      ['2026-11-08', 7], // Sunday is 7, never 0
      ['2026-10-25', 7], // the autumn clock change day
      ['2027-03-28', 7], // the spring clock change day
    ])('%s is ISO weekday %i', (date, weekday) => {
      expect(isoWeekday(date)).toBe(weekday)
    })
  })

  describe('athensInstant', () => {
    it('winter: 19:00 on 6 Nov 2026 is 17:00 UTC', () => {
      expect(athensInstant('2026-11-06', 1140).toISOString()).toBe('2026-11-06T17:00:00.000Z')
      expect(athensInstant('2026-11-06', 0).toISOString()).toBe('2026-11-05T22:00:00.000Z')
    })

    it('summer: 19:00 on 17 Jul 2026 is 16:00 UTC', () => {
      expect(athensInstant('2026-07-17', 1140).toISOString()).toBe('2026-07-17T16:00:00.000Z')
    })

    it('spring forward: a time in the skipped hour (03:30 on 28 Mar 2027) comes out one hour later, 04:30 summer time', () => {
      const skipped = athensInstant('2027-03-28', 210)
      // 04:30 EEST = 01:30 UTC.
      expect(skipped.toISOString()).toBe('2027-03-28T01:30:00.000Z')
      // 03:00 does not exist either: it is 04:00 summer time, the same instant as 04:00.
      expect(athensInstant('2027-03-28', 180).toISOString()).toBe('2027-03-28T01:00:00.000Z')
      expect(athensInstant('2027-03-28', 240).toISOString()).toBe('2027-03-28T01:00:00.000Z')
      // Just before the gap is still winter time.
      expect(athensInstant('2027-03-28', 179).toISOString()).toBe('2027-03-28T00:59:00.000Z')
    })

    it('fall back: the repeated hour (03:30 on 25 Oct 2026) is its second, winter time occurrence', () => {
      // 03:30 EET (+2) = 01:30 UTC; the first occurrence (03:30 EEST) would be 00:30 UTC.
      expect(athensInstant('2026-10-25', 210).toISOString()).toBe('2026-10-25T01:30:00.000Z')
      expect(athensInstant('2026-10-25', 180).toISOString()).toBe('2026-10-25T01:00:00.000Z')
      // 02:59 is before the repeat: still summer time.
      expect(athensInstant('2026-10-25', 179).toISOString()).toBe('2026-10-24T23:59:00.000Z')
      expect(athensInstant('2026-10-25', 240).toISOString()).toBe('2026-10-25T02:00:00.000Z')
    })

    it('1440 is the next Athens midnight', () => {
      expect(athensInstant('2026-11-06', 1440).toISOString()).toBe('2026-11-06T22:00:00.000Z')
      // Across a month and a year end.
      expect(athensInstant('2026-11-30', 1440).toISOString()).toBe('2026-11-30T22:00:00.000Z')
      expect(athensInstant('2026-12-31', 1440).toISOString()).toBe('2026-12-31T22:00:00.000Z')
      // The day before the autumn change ends at a summer midnight; the change day at a winter one.
      expect(athensInstant('2026-10-24', 1440).toISOString()).toBe('2026-10-24T21:00:00.000Z')
      expect(athensInstant('2026-10-25', 1440).toISOString()).toBe('2026-10-25T22:00:00.000Z')
      // The spring change day ends at a summer midnight.
      expect(athensInstant('2027-03-28', 1440).toISOString()).toBe('2027-03-28T21:00:00.000Z')
      // The same instant as minute 0 of the next date.
      expect(athensInstant('2026-11-06', 1440).getTime()).toBe(athensInstant('2026-11-07', 0).getTime())
    })

    it('a slot on the clock change days is an hour shorter or longer', () => {
      const autumn = occurrenceTimes('2026-10-25', { weekday: 7, startMinute: 0, endMinute: 1440 })
      expect(autumn.endsAt.getTime() - autumn.startsAt.getTime()).toBe(25 * 3600_000)
      const spring = occurrenceTimes('2027-03-28', { weekday: 7, startMinute: 0, endMinute: 1440 })
      expect(spring.endsAt.getTime() - spring.startsAt.getTime()).toBe(23 * 3600_000)
    })
  })

  describe('occurrenceTimes', () => {
    it('gives the start and end instants of a slot on a date', () => {
      expect(occurrenceTimes('2026-11-06', { weekday: 5, startMinute: 1140, endMinute: 1380 })).toEqual({
        startsAt: new Date('2026-11-06T17:00:00.000Z'),
        endsAt: new Date('2026-11-06T21:00:00.000Z'),
      })
    })
  })

  describe('clockText', () => {
    it.each([
      [0, '00:00'],
      [5, '00:05'],
      [65, '01:05'],
      [600, '10:00'],
      [1140, '19:00'],
      [1439, '23:59'],
      [1440, '24:00'],
    ])('%i minutes is %s', (minute, text) => {
      expect(clockText(minute)).toBe(text)
    })
  })

  describe('dropUntilText', () => {
    // Friday 6 Nov 2026, 10:00 in Athens.
    const now = new Date('2026-11-06T08:00:00.000Z')

    it('"HH:mm today" for a deadline later today in Athens', () => {
      expect(dropUntilText(new Date('2026-11-06T16:00:00.000Z'), now)).toBe('18:00 today')
      // A deadline already passed today still reads "today".
      expect(dropUntilText(new Date('2026-11-06T05:00:00.000Z'), now)).toBe('07:00 today')
    })

    it('"HH:mm tomorrow" for a deadline tomorrow in Athens', () => {
      expect(dropUntilText(new Date('2026-11-07T05:00:00.000Z'), now)).toBe('07:00 tomorrow')
    })

    it('"ddd D MMM, HH:mm" for a later deadline', () => {
      expect(dropUntilText(new Date('2026-11-09T16:00:00.000Z'), now)).toBe('Mon 9 Nov, 18:00')
      expect(dropUntilText(new Date('2026-11-13T05:00:00.000Z'), now)).toBe('Fri 13 Nov, 07:00')
    })

    it('decides today and tomorrow by the Athens date near midnight, not the UTC date', () => {
      // 23:30 Friday in Athens.
      const late = new Date('2026-11-06T21:30:00.000Z')
      // 00:30 Saturday in Athens, still Friday in UTC.
      expect(dropUntilText(new Date('2026-11-06T22:30:00.000Z'), late)).toBe('00:30 tomorrow')
      expect(dropUntilText(new Date('2026-11-06T21:45:00.000Z'), late)).toBe('23:45 today')
    })
  })

  describe('dropDeadline', () => {
    const startsAt = new Date('2026-11-06T17:00:00.000Z')

    it('is the start minus the notice hours', () => {
      expect(dropDeadline(startsAt, 12)).toEqual(new Date('2026-11-06T05:00:00.000Z'))
      expect(dropDeadline(startsAt, 24)).toEqual(new Date('2026-11-05T17:00:00.000Z'))
      expect(dropDeadline(startsAt, 168)).toEqual(new Date('2026-10-30T17:00:00.000Z'))
    })

    it('is the start itself with a notice of 0', () => {
      expect(dropDeadline(startsAt, 0).getTime()).toBe(startsAt.getTime())
    })

    it('does not change the start it was given', () => {
      dropDeadline(startsAt, 12)
      expect(startsAt.toISOString()).toBe('2026-11-06T17:00:00.000Z')
    })
  })
})
