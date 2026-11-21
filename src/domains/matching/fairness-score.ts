// Spec 0044 (rows 12 and 13): the fairness score. Pure: no database, no clock, no routing. Given the
// riders that passed every filter (busy, SOS, skip list, distance, a full box) and the co-op's weights,
// it says who is offered the delivery and why. The weights are the co-op's, set on Instance
// configuration (binding value 2); this file holds no pay numbers, only the scoring rule.

// One rider in range, with the three raw values the score reads (AC-2).
export interface FairnessCandidate {
  courierId: string
  // Straight line to the pickup, for the record and the shortlist.
  straightMetres: number
  // Road time to the pickup from the co-op's OSRM, or estimated at 20 km/h when it could not answer.
  roadSeconds: number
  roadEstimated: boolean
  // What the co-op paid this rider per hour online today (tips never count). When the rider has too
  // little time online today, the co-op's mean (earningsAssumed); when nobody has enough, every rider
  // counts as equal on this factor (earningsEqual) and the value is not used.
  centsPerHour: number
  earningsAssumed: boolean
  earningsEqual: boolean
  // Since the later of the rider's last job end today and the start of their current Online spell.
  waitingSeconds: number
  // Spec 0049 (AC-2): on a BOOKED shift covering now. Set only while shifts are on and the weight applies.
  onShift?: boolean
}

// The three core weights (AC-5), whole numbers 0 to 100. Only their ratio matters.
// `shift` (spec 0049) is present only while shifts are on; absent, it is out of the score and its sum.
export interface FairnessWeights {
  roadTime: number
  earnings: number
  waiting: number
  shift?: number
}

// Each factor scaled 0 to 1 across the candidates; lower is better on every factor.
export interface FairnessScaled {
  roadTime: number
  earnings: number
  waiting: number
  shift?: number
}

export interface ScoredCandidate extends FairnessCandidate {
  scaled: FairnessScaled
  score: number
}

// Cross check 6: dead bands. With few riders, min to max scaling would give a 5 second difference the
// whole weight. A rider within these of the best value on a factor counts as equal to the best. These are
// noise thresholds, not pay numbers, so they are constants here rather than co-op settings.
export const ROAD_TIME_DEAD_BAND_SECONDS = 60
export const WAITING_DEAD_BAND_SECONDS = 5 * 60
export const EARNINGS_DEAD_BAND_CENTS_PER_HOUR = 50

// Spec 0044 (AC-2): the road time estimate when OSRM cannot answer, a moped at 20 km/h.
export const ESTIMATE_SPEED_METRES_PER_SECOND = 20000 / 3600

export function estimatedRoadSeconds(straightMetres: number): number {
  return Math.round(straightMetres / ESTIMATE_SPEED_METRES_PER_SECOND)
}

// How far each value is from the best one, scaled 0 to 1 across the candidates. `distances` are
// already "how much worse than the best" (0 for the best); a distance within the dead band counts as 0,
// and the rest is scaled by the largest distance left (never by less than the band). All within the
// band: everyone 0 (all equal).
// agy review: the excess over the band is scaled by at least the band itself, so a rider 1 s past it is
// not given the whole weight when everyone else sits inside it (60 s inside, 61 s: about 0.02, not 1).
function scaleWithDeadBand(distances: number[], deadBand: number): number[] {
  const shifted = distances.map((distance) => Math.max(0, distance - deadBand))
  const largest = Math.max(0, ...shifted)
  if (largest === 0) return distances.map(() => 0)
  const scale = Math.max(largest, deadBand)
  return shifted.map((value) => value / scale)
}

// AC-4: scales each factor (shorter road time is better, lower earnings is better, longer waiting is
// better), sums weight times scaled value divided by the sum of the weights, and sorts lowest score
// first. Ties go to the shorter road time, then the longer wait, then the courier id, so the same
// input always gives the same order.
export function scoreCandidates(candidates: FairnessCandidate[], weights: FairnessWeights): ScoredCandidate[] {
  if (candidates.length === 0) return []

  const minRoad = Math.min(...candidates.map((c) => c.roadSeconds))
  const road = scaleWithDeadBand(
    candidates.map((c) => c.roadSeconds - minRoad),
    ROAD_TIME_DEAD_BAND_SECONDS
  )

  // Longer waiting is better: the distance is how much shorter than the longest wait.
  const maxWaiting = Math.max(...candidates.map((c) => c.waitingSeconds))
  const waiting = scaleWithDeadBand(
    candidates.map((c) => maxWaiting - c.waitingSeconds),
    WAITING_DEAD_BAND_SECONDS
  )

  // Lower earnings is better. When nobody had enough time online, the factor is equal for everyone.
  const earningsEqual = candidates.every((c) => c.earningsEqual)
  const minCents = Math.min(...candidates.map((c) => c.centsPerHour))
  const earnings = earningsEqual
    ? candidates.map(() => 0)
    : scaleWithDeadBand(
        candidates.map((c) => c.centsPerHour - minCents),
        EARNINGS_DEAD_BAND_CENTS_PER_HOUR
      )

  // Spec 0049 (AC-2, cross check 6): the shift factor is already 0 or 1 (0 on a booked shift), never
  // scaled across the riders, so its weight moves a score by the same amount every time.
  const shiftWeight = weights.shift
  const weightSum = weights.roadTime + weights.earnings + weights.waiting + (shiftWeight ?? 0)
  const scored = candidates.map((candidate, index) => {
    // `?? 0`: the three lists have one entry per candidate; TypeScript cannot know that.
    const scaled: FairnessScaled = {
      roadTime: road[index] ?? 0,
      earnings: earnings[index] ?? 0,
      waiting: waiting[index] ?? 0,
    }
    if (shiftWeight !== undefined) scaled.shift = candidate.onShift ? 0 : 1
    const score =
      weightSum === 0
        ? 0
        : (weights.roadTime * scaled.roadTime +
            weights.earnings * scaled.earnings +
            weights.waiting * scaled.waiting +
            (shiftWeight ?? 0) * (scaled.shift ?? 0)) /
          weightSum
    return { ...candidate, scaled, score }
  })

  return scored.sort(
    (a, b) =>
      a.score - b.score ||
      a.roadSeconds - b.roadSeconds ||
      b.waitingSeconds - a.waitingSeconds ||
      (a.courierId < b.courierId ? -1 : a.courierId > b.courierId ? 1 : 0)
  )
}

// AC-3, cross check 3: the co-op mean is the mean of the qualifying riders' rates (not total money over
// total hours). null when nobody qualified: the earnings factor is then equal for everyone.
export function coopMeanCentsPerHour(qualifyingRates: number[]): number | null {
  if (qualifyingRates.length === 0) return null
  return qualifyingRates.reduce((sum, rate) => sum + rate, 0) / qualifyingRates.length
}
