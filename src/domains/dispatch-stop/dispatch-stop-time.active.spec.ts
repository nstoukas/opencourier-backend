import { EnumDispatchStopReason } from '@prisma/types'
import {
  athensToUtc,
  reasonWords,
  dayWords,
  clock,
  effectiveEnd,
  restaurantStoppedMessage,
  riderStoppedMessage,
  restaurantNextMessage,
  riderNextMessage,
  adminRefusedMessage,
} from './dispatch-stop-time'

describe('dispatch-stop-time (Spec 0014, AC-1, AC-2, AC-6, AC-7)', () => {
  describe('athensToUtc', () => {
    test('summer conversion: 12:00 Athens in July (UTC+3) is 09:00Z', () => {
      const utc = athensToUtc({ date: '2026-07-15', time: '12:00' })
      expect(utc).not.toBeNull()
      expect(utc?.toISOString()).toBe('2026-07-15T09:00:00.000Z')
    })

    test('winter conversion: 12:00 Athens in January (UTC+2) is 10:00Z', () => {
      const utc = athensToUtc({ date: '2026-01-15', time: '12:00' })
      expect(utc).not.toBeNull()
      expect(utc?.toISOString()).toBe('2026-01-15T10:00:00.000Z')
    })

    test('skipped spring hour: 2027-03-28 03:30 does not exist in Athens and returns null', () => {
      // European daylight saving time in 2027 begins Sunday 2027-03-28 at 03:00 (clocks jump to 04:00)
      const utc = athensToUtc({ date: '2027-03-28', time: '03:30' })
      expect(utc).toBeNull()
    })

    test('repeated autumn hour: 2026-10-25 03:30 resolves to its second occurrence (winter time, UTC+2)', () => {
      // Clocks fall back from 04:00 to 03:00 on Sunday 2026-10-25.
      // Decision 29.5: dayjs timezone resolves repeated hour to second occurrence (UTC+2), so 03:30 is 01:30Z.
      const utc = athensToUtc({ date: '2026-10-25', time: '03:30' })
      expect(utc).not.toBeNull()
      expect(utc?.toISOString()).toBe('2026-10-25T01:30:00.000Z')
    })

    test('invalid date or time text returns null', () => {
      expect(athensToUtc({ date: '2026-7-15', time: '12:00' })).toBeNull()
      expect(athensToUtc({ date: '2026-07-15', time: '9:00' })).toBeNull()
      expect(athensToUtc({ date: 'not-a-date', time: '12:00' })).toBeNull()
      expect(athensToUtc({ date: '2026-07-15', time: '25:00' })).toBeNull()
      expect(athensToUtc({ date: '2026-07-15', time: '12:60' })).toBeNull()
      expect(athensToUtc({ date: '2026-02-30', time: '12:00' })).toBeNull()
    })
  })

  describe('reasonWords', () => {
    test('translates enum values to lower case words for sentences', () => {
      expect(reasonWords(EnumDispatchStopReason.HEAT)).toBe('heat')
      expect(reasonWords(EnumDispatchStopReason.STORM)).toBe('storm')
      expect(reasonWords(EnumDispatchStopReason.OTHER)).toBe('other reasons')
    })
  })

  describe('Messages and effectiveEnd', () => {
    // 2026-07-15 12:00 Athens is 09:00Z
    const nowToday = new Date('2026-07-15T09:00:00.000Z')
    // 2026-07-15 17:00 Athens is 14:00Z
    const endsToday17 = new Date('2026-07-15T14:00:00.000Z')
    // 2026-07-16 09:00 Athens is 06:00Z
    const endsTomorrow09 = new Date('2026-07-16T06:00:00.000Z')

    test('same-day end formats as "until 17:00"', () => {
      const stop = {
        reason: EnumDispatchStopReason.HEAT,
        startsAt: nowToday,
        endsAt: endsToday17,
        endedAt: null,
      }
      expect(restaurantStoppedMessage(stop, nowToday)).toBe('Delivery is stopped until 17:00 (heat).')
      expect(riderStoppedMessage(stop, nowToday)).toBe('Dispatch is stopped until 17:00 (heat).')
      expect(adminRefusedMessage(stop, nowToday)).toBe('Dispatch is stopped until 17:00.')
    })

    test('next-day end formats as "until 09:00 tomorrow"', () => {
      const stop = {
        reason: EnumDispatchStopReason.STORM,
        startsAt: nowToday,
        endsAt: endsTomorrow09,
        endedAt: null,
      }
      expect(restaurantStoppedMessage(stop, nowToday)).toBe('Delivery is stopped until 09:00 tomorrow (storm).')
      expect(riderStoppedMessage(stop, nowToday)).toBe('Dispatch is stopped until 09:00 tomorrow (storm).')
      expect(adminRefusedMessage(stop, nowToday)).toBe('Dispatch is stopped until 09:00 tomorrow.')
    })

    test('no end formats as "until dispatch restarts" / "until the co-op restarts it"', () => {
      const stop = {
        reason: EnumDispatchStopReason.STORM,
        startsAt: nowToday,
        endsAt: null,
        endedAt: null,
      }
      expect(restaurantStoppedMessage(stop, nowToday)).toBe('Delivery is stopped until dispatch restarts (storm).')
      expect(riderStoppedMessage(stop, nowToday)).toBe('Dispatch is stopped until the co-op restarts it (storm).')
      expect(adminRefusedMessage(stop, nowToday)).toBe('Dispatch is stopped until it is restarted.')
    })

    test('upcoming stop formats as "today 12:00 to 17:00"', () => {
      // 08:00 Athens is 05:00Z
      const nowEarlier = new Date('2026-07-15T05:00:00.000Z')
      const stop = {
        reason: EnumDispatchStopReason.HEAT,
        startsAt: nowToday, // 12:00 Athens
        endsAt: endsToday17, // 17:00 Athens
        endedAt: null,
      }
      expect(restaurantNextMessage(stop, nowEarlier)).toBe('Delivery stops today 12:00 to 17:00 (heat).')
      expect(riderNextMessage(stop, nowEarlier)).toBe('Dispatch stops today 12:00 to 17:00 (heat).')
    })

    test('a restart (endedAt) overrides planned endsAt as the effective end', () => {
      // Restarted at 15:30 Athens (12:30Z) instead of planned 17:00
      const restartedAt = new Date('2026-07-15T12:30:00.000Z')
      const stop = {
        reason: EnumDispatchStopReason.OTHER,
        startsAt: nowToday,
        endsAt: endsToday17,
        endedAt: restartedAt,
      }
      expect(effectiveEnd(stop)).toBe(restartedAt)
      expect(restaurantStoppedMessage(stop, nowToday)).toBe('Delivery is stopped until 15:30 (other reasons).')
      expect(riderStoppedMessage(stop, nowToday)).toBe('Dispatch is stopped until 15:30 (other reasons).')
      expect(adminRefusedMessage(stop, nowToday)).toBe('Dispatch is stopped until 15:30.')
    })
  })
})
