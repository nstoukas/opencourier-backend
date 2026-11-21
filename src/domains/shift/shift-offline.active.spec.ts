import {
  ADMIN_CAUSE_WORDS,
  FOLLOWED_UP_SHOWN_DAYS,
  NO_EFFECT_SENTENCE,
  RIDER_CAUSE_WORDS,
  SHIFT_END_GRACE_MINUTES,
  offlineCountsMidShift,
  riderOfflineSentence,
} from './shift-offline'

// Spec 0049 (row 79; AC-4, AC-5, cross check 1 and 2): when an Offline change during a booked shift is
// recorded, and the words for it. Written from the spec. Pure: no database.
describe('Offline during a booked shift: the rule and the words (spec 0049)', () => {
  // A shift from 20:00 to 24:00 Athens on Fri 20 Nov 2026 (UTC+2).
  const booking = { startsAt: new Date('2026-11-20T18:00:00.000Z'), endsAt: new Date('2026-11-20T22:00:00.000Z') }
  const at = (iso: string) => new Date(iso)

  describe('offlineCountsMidShift (cross check 1)', () => {
    test('Offline in the middle of a booked shift, still Offline after the break limit: recorded', () => {
      expect(
        offlineCountsMidShift({ offlineAt: at('2026-11-20T19:10:00.000Z'), booking, cameBackWithinBreak: false })
      ).toBe(true)
    })

    test('a break leaves nothing: back within the break limit is not recorded', () => {
      expect(
        offlineCountsMidShift({ offlineAt: at('2026-11-20T19:10:00.000Z'), booking, cameBackWithinBreak: true })
      ).toBe(false)
    })

    test('no booking covering the moment: not recorded', () => {
      expect(
        offlineCountsMidShift({ offlineAt: at('2026-11-20T19:10:00.000Z'), booking: null, cameBackWithinBreak: false })
      ).toBe(false)
    })

    test('the last 10 minutes of the shift leave nothing', () => {
      expect(SHIFT_END_GRACE_MINUTES).toBe(10)
    })

    // startsAt <= moment < endsAt - 10 minutes.
    test.each([
      ['1 ms before the shift starts', '2026-11-20T17:59:59.999Z', false],
      ['exactly at the start', '2026-11-20T18:00:00.000Z', true],
      ['1 ms after the start', '2026-11-20T18:00:00.001Z', true],
      ['11 minutes before the end', '2026-11-20T21:49:00.000Z', true],
      ['1 ms before the last 10 minutes', '2026-11-20T21:49:59.999Z', true],
      ['exactly 10 minutes before the end', '2026-11-20T21:50:00.000Z', false],
      ['5 minutes before the end', '2026-11-20T21:55:00.000Z', false],
      ['1 ms before the end', '2026-11-20T21:59:59.999Z', false],
      ['exactly at the end', '2026-11-20T22:00:00.000Z', false],
      ['an hour after the end', '2026-11-20T23:00:00.000Z', false],
      ['the day before', '2026-11-19T19:10:00.000Z', false],
    ])('%s: %s -> %p', (_name, moment, expected) => {
      expect(offlineCountsMidShift({ offlineAt: at(moment), booking, cameBackWithinBreak: false })).toBe(expected)
    })

    test('coming back within the break wins over every moment inside the shift', () => {
      for (const moment of ['2026-11-20T18:00:00.000Z', '2026-11-20T20:00:00.000Z', '2026-11-20T21:49:59.999Z']) {
        expect(offlineCountsMidShift({ offlineAt: at(moment), booking, cameBackWithinBreak: true })).toBe(false)
      }
    })

    test('a shift of 10 minutes or less never leaves a record', () => {
      const short = { startsAt: at('2026-11-20T18:00:00.000Z'), endsAt: at('2026-11-20T18:10:00.000Z') }
      for (const moment of ['2026-11-20T18:00:00.000Z', '2026-11-20T18:05:00.000Z', '2026-11-20T18:09:59.999Z']) {
        expect(offlineCountsMidShift({ offlineAt: at(moment), booking: short, cameBackWithinBreak: false })).toBe(false)
      }
    })
  })

  describe('the causes in plain words (cross check 2)', () => {
    const CAUSES = ['RIDER', 'ADMIN', 'CUT_OFF', 'LAST_CALL_ACCEPTED', 'SYSTEM_START']

    test('every status change cause has words for the rider and for an admin', () => {
      expect(Object.keys(RIDER_CAUSE_WORDS).sort()).toEqual([...CAUSES].sort())
      expect(Object.keys(ADMIN_CAUSE_WORDS).sort()).toEqual([...CAUSES].sort())
      for (const cause of CAUSES) {
        expect(RIDER_CAUSE_WORDS[cause as keyof typeof RIDER_CAUSE_WORDS].length).toBeGreaterThan(5)
        expect(ADMIN_CAUSE_WORDS[cause as keyof typeof ADMIN_CAUSE_WORDS].length).toBeGreaterThan(5)
      }
    })

    test('the words name who or what set the rider Offline', () => {
      expect(RIDER_CAUSE_WORDS.RIDER).toBe('you switched to Offline')
      expect(RIDER_CAUSE_WORDS.ADMIN).toBe('an admin set you Offline')
      expect(RIDER_CAUSE_WORDS.CUT_OFF).toMatch(/password change/)
      expect(RIDER_CAUSE_WORDS.LAST_CALL_ACCEPTED).toMatch(/Last Call/)
      expect(ADMIN_CAUSE_WORDS.RIDER).toBe('The rider switched to Offline')
      expect(ADMIN_CAUSE_WORDS.ADMIN).toBe('An admin set the rider Offline')
      expect(ADMIN_CAUSE_WORDS.CUT_OFF).toMatch(/password change/)
      expect(ADMIN_CAUSE_WORDS.LAST_CALL_ACCEPTED).toMatch(/Last Call/)
    })

    // Value 5: a record, never a judgement of the rider.
    test('no wording judges the rider', () => {
      const all = [...Object.values(RIDER_CAUSE_WORDS), ...Object.values(ADMIN_CAUSE_WORDS), NO_EFFECT_SENTENCE]
      for (const words of all) {
        expect(words).not.toMatch(/abandon|left early|no.?show|penal|warning|strike|violation|missed|fail/i)
      }
    })
  })

  describe('what the rider reads (AC-5)', () => {
    test("the no effect line is the spec's sentence", () => {
      expect(NO_EFFECT_SENTENCE).toBe('This changes nothing about your offers or pay.')
    })

    test('the sentence gives the Athens time, the shift and the cause', () => {
      expect(
        riderOfflineSentence({
          offlineAt: at('2026-11-20T19:10:00.000Z'),
          cause: 'RIDER',
          shiftStartsAt: booking.startsAt,
          startTime: '20:00',
          endTime: '24:00',
        })
      ).toBe('You went Offline at 21:10 during your shift on Fri 20 Nov, 20:00 to 24:00: you switched to Offline.')
    })

    test('the time is Athens wall time in summer too (UTC+3)', () => {
      const sentence = riderOfflineSentence({
        offlineAt: at('2026-07-10T18:10:00.000Z'),
        cause: 'ADMIN',
        shiftStartsAt: at('2026-07-10T17:00:00.000Z'),
        startTime: '20:00',
        endTime: '23:00',
      })
      expect(sentence).toBe(
        'You went Offline at 21:10 during your shift on Fri 10 Jul, 20:00 to 23:00: an admin set you Offline.'
      )
    })

    test('with no cause recorded the sentence ends after the shift', () => {
      expect(
        riderOfflineSentence({
          offlineAt: at('2026-11-20T19:10:00.000Z'),
          cause: null,
          shiftStartsAt: booking.startsAt,
          startTime: '20:00',
          endTime: '24:00',
        })
      ).toBe('You went Offline at 21:10 during your shift on Fri 20 Nov, 20:00 to 24:00.')
    })
  })

  test('a followed up item stays on the admin screen for 7 days (cross check 3)', () => {
    expect(FOLLOWED_UP_SHOWN_DAYS).toBe(7)
  })
})
