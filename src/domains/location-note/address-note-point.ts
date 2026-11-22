import { haversineDistanceInMetres } from 'src/core/utils/distance'

// Spec 0053 (AC-3): a note shows to a rider at a stop within this many metres of the note's point.
// A fixed number documented in the spec, not a pay or matching value, so not a co-op setting.
export const ADDRESS_NOTE_RADIUS_METRES = 30

// AC-3: at most this many notes per stop, newest confirmed first.
export const ADDRESS_NOTE_MAX_SHOWN = 10

// Cross check 2: how many earlier riders' moved pins for the same address are looked at (the newest).
export const ADDRESS_NOTE_MAX_EARLIER_CORRECTIONS = 20

export type Point = { latitude: number; longitude: number }

export type LatLngBox = { minLatitude: number; maxLatitude: number; minLongitude: number; maxLongitude: number }

// Metres in one degree of latitude, near enough everywhere.
const METRES_PER_DEGREE = 111_320

// "The current drop off point" (cross check 1): where the rider moved the pin, else the drop off
// Location the restaurant sent. Both corrected columns are written together, so one without the
// other is treated as no move.
export function currentDropoffPoint(delivery: {
  dropoffCorrectedLatitude: number | null
  dropoffCorrectedLongitude: number | null
  dropoffLocation: Point
}): Point {
  if (delivery.dropoffCorrectedLatitude !== null && delivery.dropoffCorrectedLongitude !== null) {
    return { latitude: delivery.dropoffCorrectedLatitude, longitude: delivery.dropoffCorrectedLongitude }
  }
  return { latitude: delivery.dropoffLocation.latitude, longitude: delivery.dropoffLocation.longitude }
}

// A square around the point a little wider than the radius, for the database to narrow the notes to
// look at (cross check 11); the exact distance is then checked in code with haversine.
export function boxAround(point: Point, metres: number = ADDRESS_NOTE_RADIUS_METRES): LatLngBox {
  const latitudeDelta = metres / METRES_PER_DEGREE
  // A degree of longitude shrinks towards the poles; the floor keeps it from dividing by zero.
  const longitudeDelta = metres / (METRES_PER_DEGREE * Math.max(Math.cos((point.latitude * Math.PI) / 180), 0.01))
  return {
    minLatitude: point.latitude - latitudeDelta,
    maxLatitude: point.latitude + latitudeDelta,
    minLongitude: point.longitude - longitudeDelta,
    maxLongitude: point.longitude + longitudeDelta,
  }
}

export function isWithinRadius(note: Point, points: Point[], metres: number = ADDRESS_NOTE_RADIUS_METRES): boolean {
  return points.some(
    (point) => haversineDistanceInMetres(note.latitude, note.longitude, point.latitude, point.longitude) <= metres
  )
}

// The notes a stop shows (AC-3): within the radius of any of the stop's points, newest confirmed
// first, at most ADDRESS_NOTE_MAX_SHOWN.
export function notesForStop<T extends Point & { lastConfirmedAt: Date }>(notes: T[], points: Point[]): T[] {
  return notes
    .filter((note) => isWithinRadius(note, points))
    .sort((a, b) => b.lastConfirmedAt.getTime() - a.lastConfirmedAt.getTime())
    .slice(0, ADDRESS_NOTE_MAX_SHOWN)
}
