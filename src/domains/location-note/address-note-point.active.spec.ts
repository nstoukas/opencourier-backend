import {
  ADDRESS_NOTE_MAX_EARLIER_CORRECTIONS,
  ADDRESS_NOTE_MAX_SHOWN,
  ADDRESS_NOTE_RADIUS_METRES,
  boxAround,
  currentDropoffPoint,
  isWithinRadius,
  notesForStop,
  Point,
} from './address-note-point'

describe('Address note point geometry (Spec 0053 AC-2, AC-3, cross check 1, 2, 11)', () => {
  const volosCenter: Point = { latitude: 39.364, longitude: 22.948 }

  describe('Constants', () => {
    it('sets the radius to 30 metres and maximum notes shown to 10 (AC-3)', () => {
      expect(ADDRESS_NOTE_RADIUS_METRES).toBe(30)
      expect(ADDRESS_NOTE_MAX_SHOWN).toBe(10)
      expect(ADDRESS_NOTE_MAX_EARLIER_CORRECTIONS).toBe(20)
    })
  })

  describe('currentDropoffPoint (cross check 1)', () => {
    it('returns the rider corrected pin when both corrected latitude and longitude are set', () => {
      const delivery = {
        dropoffCorrectedLatitude: 39.3655,
        dropoffCorrectedLongitude: 22.9495,
        dropoffLocation: { latitude: 39.364, longitude: 22.948 },
      }

      const point = currentDropoffPoint(delivery)
      expect(point.latitude).toBe(39.3655)
      expect(point.longitude).toBe(22.9495)
    })

    it('falls back to the original dropoff Location when no pin move occurred', () => {
      const delivery = {
        dropoffCorrectedLatitude: null,
        dropoffCorrectedLongitude: null,
        dropoffLocation: { latitude: 39.364, longitude: 22.948 },
      }

      const point = currentDropoffPoint(delivery)
      expect(point.latitude).toBe(39.364)
      expect(point.longitude).toBe(22.948)
    })

    it('falls back to dropoff Location if only one corrected coordinate is present', () => {
      const delivery = {
        dropoffCorrectedLatitude: 39.3655,
        dropoffCorrectedLongitude: null,
        dropoffLocation: { latitude: 39.364, longitude: 22.948 },
      }

      const point = currentDropoffPoint(delivery)
      expect(point.latitude).toBe(39.364)
      expect(point.longitude).toBe(22.948)
    })
  })

  describe('boxAround (cross check 11)', () => {
    it('generates a bounding box enclosing the point with margins wider than radius', () => {
      const box = boxAround(volosCenter, 30)

      expect(box.minLatitude).toBeLessThan(volosCenter.latitude)
      expect(box.maxLatitude).toBeGreaterThan(volosCenter.latitude)
      expect(box.minLongitude).toBeLessThan(volosCenter.longitude)
      expect(box.maxLongitude).toBeGreaterThan(volosCenter.longitude)

      // Margins roughly 30m / 111320m per degree ≈ 0.00027 degrees
      expect(volosCenter.latitude - box.minLatitude).toBeCloseTo(30 / 111320, 4)
      expect(box.maxLatitude - volosCenter.latitude).toBeCloseTo(30 / 111320, 4)
    })
  })

  describe('isWithinRadius', () => {
    it('returns true when note is at the exact same coordinates (0m)', () => {
      expect(isWithinRadius(volosCenter, [volosCenter], 30)).toBe(true)
    })

    it('returns true when note is within 30 metres (e.g. ~15m away)', () => {
      // 0.00013 degrees latitude is about 14.5 metres
      const nearbyNote = { latitude: volosCenter.latitude + 0.00013, longitude: volosCenter.longitude }
      expect(isWithinRadius(nearbyNote, [volosCenter], 30)).toBe(true)
    })

    it('returns false when note is beyond 30 metres (e.g. ~45m away)', () => {
      // 0.00040 degrees latitude is about 44.5 metres
      const farNote = { latitude: volosCenter.latitude + 0.0004, longitude: volosCenter.longitude }
      expect(isWithinRadius(farNote, [volosCenter], 30)).toBe(false)
    })

    it('returns true if note is within 30m of ANY point in the list (cross check 2)', () => {
      const originalLocation = { latitude: 39.364, longitude: 22.948 }
      const earlierMovedPin = { latitude: 39.3648, longitude: 22.948 } // ~89m away from original
      const noteNearMovedPin = { latitude: 39.3649, longitude: 22.948 } // ~11m from moved pin

      // Note is far from original location, but within 30m of earlier moved pin
      expect(isWithinRadius(noteNearMovedPin, [originalLocation, earlierMovedPin], 30)).toBe(true)
    })
  })

  describe('notesForStop (AC-3, cross check 2)', () => {
    it('filters within 30m, sorts newest confirmed first, and limits to 10 notes', () => {
      // Create 15 notes at the same point with different lastConfirmedAt dates
      const baseTime = new Date('2026-11-20T10:00:00Z').getTime()
      const notes = Array.from({ length: 15 }, (_, i) => ({
        id: `note-${i}`,
        latitude: volosCenter.latitude,
        longitude: volosCenter.longitude,
        lastConfirmedAt: new Date(baseTime + i * 1000), // note-14 is newest
      }))

      // Also add a note that is far away (> 30m)
      const farNote = {
        id: 'note-far',
        latitude: volosCenter.latitude + 0.01,
        longitude: volosCenter.longitude + 0.01,
        lastConfirmedAt: new Date(baseTime + 20000),
      }

      const result = notesForStop([...notes, farNote], [volosCenter])

      // Far note is filtered out
      expect(result.some((n) => n.id === 'note-far')).toBe(false)

      // Capped at ADDRESS_NOTE_MAX_SHOWN (10)
      expect(result).toHaveLength(10)

      // Sorted newest confirmed first: note-14, note-13, ..., note-5
      expect(result[0]?.id).toBe('note-14')
      expect(result[1]?.id).toBe('note-13')
      expect(result[9]?.id).toBe('note-5')

      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i]!.lastConfirmedAt.getTime()).toBeGreaterThanOrEqual(
          result[i + 1]!.lastConfirmedAt.getTime()
        )
      }
    })
  })
})
