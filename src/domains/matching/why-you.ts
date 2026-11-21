// Spec 0045 (row 14): what a rider may read of the reason an offer came to them. Pure, and an allow list:
// only the rider's own raw values, never the scaled values, the score, how many riders were compared or
// how many were in range (cross check 1: a scaled 0 or 1 would tell them their place in line), and never
// another rider's figures (the reason's `candidates` are not even read on this path, AC-5).

export interface StoredOfferReason {
  strategy: string
  kind: string
  values: unknown
  weights: unknown
}

export interface WhyYou {
  strategy: string
  kind: string
  values: Record<string, number | boolean | string | null>
  // Only the weights that applied and are above 0 (cross check 3).
  weights: Record<string, number>
  // The road time was estimated (OSRM did not answer, spec 0044 AC-2).
  estimated: boolean
}

// The raw keys a rider may read, per strategy. Anything else in `values` is dropped.
const OWN_KEYS: Record<string, string[]> = {
  FAIRNESS: [
    'roadSeconds',
    'roadEstimated',
    'centsPerHour',
    'earningsAssumed',
    'earningsEqual',
    'waitingSeconds',
    'straightMetres',
    // Spec 0049 (AC-3): whether this rider was on a booked shift, recorded only while shifts are on.
    'onShift',
  ],
  NEAREST_COURIER: ['straightMetres', 'roadSeconds'],
  COURIER_SENIORITY: ['memberSince'],
  // An admin's choice or the testing matcher: the rider reads only who chose (no admin id).
  ADMIN: [],
  STATIC: [],
}

const WEIGHT_ORDER = ['roadTime', 'earnings', 'waiting', 'shift']

function isPlainValue(value: unknown): value is number | boolean | string | null {
  return value === null || ['number', 'boolean', 'string'].includes(typeof value)
}

export function whyYouFrom(reason: StoredOfferReason | null): WhyYou | null {
  if (!reason) return null
  const stored = (reason.values ?? {}) as Record<string, unknown>
  const values: WhyYou['values'] = {}
  for (const key of OWN_KEYS[reason.strategy] ?? []) {
    const value = stored[key]
    if (isPlainValue(value)) values[key] = value
  }
  // Review fix (AC-5): when the rider's pay counted as the co-op average (or counted equal for all), the
  // stored centsPerHour is that average, made of other riders' pay (with one qualifying rider, exactly
  // theirs). It is never sent then; the flags say what counted.
  if (stored.earningsAssumed === true || stored.earningsEqual === true) delete values.centsPerHour
  const storedWeights = (reason.weights ?? {}) as Record<string, unknown>
  const weights: Record<string, number> = {}
  for (const key of WEIGHT_ORDER) {
    const weight = storedWeights[key]
    if (typeof weight === 'number' && weight > 0) weights[key] = weight
  }
  return { strategy: reason.strategy, kind: reason.kind, values, weights, estimated: stored.roadEstimated === true }
}
