// Spec 0038 (AC-13): the settings that affect a rider's work, each with a plain label and a way to
// write its value in plain units. Riders see changes to these keys, and to removal reasons and shift
// slots, on the "What changed" list; every other key (chat, the dispatch phone, retention periods,
// the fee %, app versions, registries, region details) stays admin only. A test fails if a key here
// has no label or formatter.

// What a formatter may need besides the value: the instance's distance unit and currency, as now.
export type SettingFormatContext = { distanceUnit: string; currency: string }

export type RiderFacingSetting = {
  label: string
  format: (value: unknown, context: SettingFormatContext) => string
}

// The two record keys that are not Config keys (setting-change.repository.ts names them too).
export const REMOVAL_REASON_KEY = 'removalReason'
export const SHIFT_SLOT_KEY = 'shiftSlot'

const NO_VALUE = 'not set'
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const MATCHER_NAMES: Record<string, string> = {
  NEAREST_COURIER: 'the nearest free rider',
  COURIER_SENIORITY: 'the free rider with the oldest account',
  STATIC: 'chosen by hand',
}

function isMissing(value: unknown): boolean {
  return value === null || value === undefined || value === ''
}

function asNumber(value: unknown): number | null {
  if (isMissing(value)) return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

// 250 cents in EUR is "€2.50"; another currency is written after the amount ("2.50 USD").
export function formatCents(value: unknown, currency: string): string {
  const cents = asNumber(value)
  if (cents === null) return NO_VALUE
  const amount = (cents / 100).toFixed(2)
  return currency === 'EUR' ? `€${amount}` : `${amount} ${currency}`
}

export function distanceUnitName(unit: string): string {
  return unit === 'MILES' ? 'miles' : 'km'
}

// "FULL_COMPENSATION" is "full compensation".
export function policyName(value: unknown): string {
  if (isMissing(value)) return NO_VALUE
  return String(value).toLowerCase().replace(/_/g, ' ')
}

const onOff = (value: unknown) => (isMissing(value) ? NO_VALUE : value === true || value === 'true' ? 'on' : 'off')
const withUnit = (unit: string) => (value: unknown) => {
  const number = asNumber(value)
  return number === null ? NO_VALUE : `${number} ${unit}`
}
const money = (value: unknown, context: SettingFormatContext) => formatCents(value, context.currency)
const distance = (value: unknown, context: SettingFormatContext) => {
  const number = asNumber(value)
  return number === null ? NO_VALUE : `${number} ${distanceUnitName(context.distanceUnit)}`
}

// {"FULL_COMPENSATION": 100, "HALF": 50} is "full compensation 100%, half 50%".
function formatPayoutPolicies(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return NO_VALUE
  const parts = Object.entries(value as Record<string, unknown>).map(([name, percent]) => {
    const number = asNumber(percent)
    return number === null ? policyName(name) : `${policyName(name)} ${number}%`
  })
  return parts.join(', ') || 'none'
}

// "10:00" from 600 minutes after midnight.
function clock(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function formatRemovalReason(value: unknown): string {
  if (isMissing(value) || typeof value !== 'object') return 'none'
  const reason = value as { label?: string; paidToRider?: boolean }
  return `${reason.label ?? ''}, ${reason.paidToRider ? 'pays the rider' : 'does not pay'}`
}

function formatShiftSlot(value: unknown): string {
  if (isMissing(value) || typeof value !== 'object') return 'none'
  const slot = value as { weekday?: number; startMinute?: number; endMinute?: number; riderCap?: number }
  const day = WEEKDAYS[(slot.weekday ?? 1) - 1] ?? 'A day'
  return `${day} ${clock(slot.startMinute ?? 0)} to ${clock(slot.endMinute ?? 0)}, up to ${slot.riderCap ?? 0} riders`
}

export const RIDER_FACING_SETTINGS: Record<string, RiderFacingSetting> = {
  courierMatcherType: {
    label: 'Who gets an offer',
    format: (value) => (isMissing(value) ? NO_VALUE : MATCHER_NAMES[String(value)] ?? String(value)),
  },
  maxAssignmentDistance: { label: 'Farthest distance to the restaurant for an offer', format: distance },
  distanceUnit: { label: 'Distance unit', format: (value) => (isMissing(value) ? NO_VALUE : distanceUnitName(String(value))) },
  currency: { label: 'Currency', format: (value) => (isMissing(value) ? NO_VALUE : String(value)) },
  offerExpiryEnabled: { label: 'Offers end on their own', format: onOff },
  offerExpirySeconds: { label: 'Time to answer an offer', format: withUnit('seconds') },
  offerTimingEnabled: { label: 'Offers timed to when the food is ready', format: onOff },
  offerLeadMinutes: { label: 'How early before the food is ready an offer goes out', format: withUnit('minutes') },
  // A count of riders (a whole number), not a list.
  offerTimingCandidates: { label: 'Riders considered for a timed offer', format: withUnit('riders') },
  quoteBaseFee: { label: 'Base pay per delivery', format: money },
  quoteRatePerDistanceUnit: {
    label: 'Pay per distance',
    format: (value, context) =>
      isMissing(value) ? NO_VALUE : `${formatCents(value, context.currency)} per ${distanceUnitName(context.distanceUnit)}`,
  },
  courierCompensationCalculationType: {
    label: 'How pay is worked out',
    format: (value) => (value === 'FROM_QUOTE_FROM' ? 'base pay plus distance pay' : policyName(value)),
  },
  waitPayEnabled: { label: 'Pay for waiting at a restaurant', format: onOff },
  waitPayFreeMinutes: { label: 'Unpaid minutes of waiting', format: withUnit('minutes') },
  waitPayCentsPerMinute: {
    label: 'Pay per minute of waiting',
    format: (value, context) => (isMissing(value) ? NO_VALUE : `${formatCents(value, context.currency)} per minute`),
  },
  waitLimitMinutes: { label: 'Minutes before you may leave a late restaurant', format: withUnit('minutes') },
  // Spec 0040 (AC-13): 0 reads as its meaning, not as a length of break.
  shiftBreakMinutes: {
    label: 'Longest break inside one shift of time worked',
    format: (value) =>
      asNumber(value) === 0 ? 'none, every Offline with no job ends the shift' : withUnit('minutes')(value),
  },
  returnTripPayPercent: { label: 'Pay for taking food back, as a share of the distance pay', format: withUnit('%') },
  handBackSeconds: { label: 'Time to give an accepted order back for free', format: withUnit('seconds') },
  arrivalRadiusMetres: {
    label: 'Distance at which the app marks you arrived',
    format: (value) => (asNumber(value) === 0 ? 'off' : withUnit('metres')(value)),
  },
  cancellationPayoutPolicy: { label: 'Pay when a job you accepted is cancelled', format: policyName },
  // Each policy with its percentage ("full compensation 100%"): a change of percentage alone must read
  // differently, or the What changed list would drop it as unchanged (decision 30.7).
  reassignmentPayoutPolicies: { label: 'Pay rules for a job taken off you', format: formatPayoutPolicies },
  reassignmentPayoutDefaultPolicy: { label: 'Usual pay when a job is taken off you', format: policyName },
  shiftsEnabled: { label: 'Shifts', format: onOff },
  shiftDropNoticeHours: { label: 'Notice needed to drop a shift', format: withUnit('hours') },
  reviewAnswerDays: { label: 'Days a person has to answer a review request', format: withUnit('days') },
  reviewCorrectionMaxCents: { label: 'Largest pay correction a review can add', format: money },
  [REMOVAL_REASON_KEY]: { label: 'Reason to be taken off an order', format: formatRemovalReason },
  [SHIFT_SLOT_KEY]: { label: 'Shift', format: formatShiftSlot },
}

export const RIDER_FACING_SETTING_KEYS = Object.keys(RIDER_FACING_SETTINGS)
