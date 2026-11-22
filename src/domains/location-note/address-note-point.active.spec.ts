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

    it('returns false when note is ~50m away with default radius (outside 30m, inside 300m)', () => {
      // 0.00045 degrees latitude is about 50.1 metres
      const note50m = { latitude: volosCenter.latitude + 0.00045, longitude: volosCenter.longitude }
      expect(isWithinRadius(note50m, [volosCenter])).toBe(false)
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

    it('excludes notes between 31m and 300m away (catches 300m radius gap: enforces 30m, not 300m)', () => {
      const baseTime = new Date('2026-11-20T10:00:00Z').getTime()
      // Note exactly at stop (0m)
      const noteAtStop = {
        id: 'note-at-stop',
        latitude: volosCenter.latitude,
        longitude: volosCenter.longitude,
        lastConfirmedAt: new Date(baseTime + 5000),
      }
      // Note ~20m away (inside 30m)
      const note20m = {
        id: 'note-20m',
        latitude: volosCenter.latitude + 0.00018, // ~20.0 metres
        longitude: volosCenter.longitude,
        lastConfirmedAt: new Date(baseTime + 4000),
      }
      // Note ~50m away (outside 30m, but inside 300m)
      const note50m = {
        id: 'note-50m',
        latitude: volosCenter.latitude + 0.00045, // ~50.1 metres
        longitude: volosCenter.longitude,
        lastConfirmedAt: new Date(baseTime + 3000),
      }
      // Note ~150m away (outside 30m, but inside 300m)
      const note150m = {
        id: 'note-150m',
        latitude: volosCenter.latitude + 0.00135, // ~150.3 metres
        longitude: volosCenter.longitude,
        lastConfirmedAt: new Date(baseTime + 2000),
      }
      // Note ~1.1km away (outside 300m)
      const note1km = {
        id: 'note-1km',
        latitude: volosCenter.latitude + 0.01,
        longitude: volosCenter.longitude + 0.01,
        lastConfirmedAt: new Date(baseTime + 1000),
      }

      const result = notesForStop([noteAtStop, note20m, note50m, note150m, note1km], [volosCenter])

      // Only notes within 30m are included
      expect(result.map((n) => n.id)).toEqual(['note-at-stop', 'note-20m'])
      // Notes between 31m and 300m MUST NOT be returned!
      expect(result.some((n) => n.id === 'note-50m')).toBe(false)
      expect(result.some((n) => n.id === 'note-150m')).toBe(false)
      expect(result.some((n) => n.id === 'note-1km')).toBe(false)
    })
  })
})
