import {
  REMOVAL_REASON_KEY,
  RIDER_FACING_SETTINGS,
  RiderFacingSetting,
  SHIFT_SLOT_KEY,
  SettingFormatContext,
  asNumber,
  isMissing,
} from './rider-facing-settings'

// Row 137 (the review of the Greek "How offers and pay work" page): the rider's "What changed" list in
// Greek. One entry per key of `RIDER_FACING_SETTINGS`, saying what the English entry says, with the
// app's Greek words ("πρόταση", "διανομέας", "κατάστημα", "συντονισμός"). A new rider facing setting
// needs its Greek here too; a test compares the two key lists.

const NO_VALUE = 'δεν έχει οριστεί'
const WEEKDAYS = ['Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο', 'Κυριακή']

const MATCHER_NAMES: Record<string, string> = {
  NEAREST_COURIER: 'ο πιο κοντινός ελεύθερος διανομέας',
  COURIER_SENIORITY: 'ο ελεύθερος διανομέας με τον παλαιότερο λογαριασμό',
  STATIC: 'επιλογή με το χέρι',
  FAIRNESS: 'δίκαιη κατανομή: χρόνος διαδρομής, αποδοχές της ημέρας και αναμονή, με τα βάρη που όρισε ο συνεταιρισμός',
}

// The payout policies by name, as the "How offers and pay work" page names them.
export const POLICY_NAMES_EL: Record<string, string> = {
  FULL_COMPENSATION: 'πλήρης αποζημίωση',
  HALF_COMPENSATION: 'μισή αποζημίωση',
  NO_COMPENSATION: 'καμία αποζημίωση',
}

// "2,50 €": the Greek decimal comma, the symbol after; another currency is written after the amount.
export function formatCentsEl(value: unknown, currency: string): string {
  const cents = asNumber(value)
  if (cents === null) return NO_VALUE
  const amount = (cents / 100).toFixed(2).replace('.', ',')
  return currency === 'EUR' ? `${amount} €` : `${amount} ${currency}`
}

// The unit after a number ("20 km", "20 μίλια").
export function distanceUnitNameEl(unit: string): string {
  return unit === 'MILES' ? 'μίλια' : 'km'
}

// The unit after "ανά" ("ανά km", "ανά μίλι").
function perDistanceUnitEl(unit: string): string {
  return unit === 'MILES' ? 'μίλι' : 'km'
}

// A policy by its Greek name; one this file does not know keeps the English wording.
function policyNameEl(value: unknown): string {
  if (isMissing(value)) return NO_VALUE
  return POLICY_NAMES_EL[String(value)] ?? String(value).toLowerCase().replace(/_/g, ' ')
}

const onOff = (value: unknown) =>
  isMissing(value) ? NO_VALUE : value === true || value === 'true' ? 'ενεργό' : 'ανενεργό'
const withUnit = (unit: string) => (value: unknown) => {
  const number = asNumber(value)
  return number === null ? NO_VALUE : `${number} ${unit}`
}
const money = (value: unknown, context: SettingFormatContext) => formatCentsEl(value, context.currency)
const BOX_SIZE_NAMES: Record<string, string> = { SMALL: 'Μικρή', MEDIUM: 'Μεσαία', LARGE: 'Μεγάλη' }
const boxSizeName = (value: unknown) => (isMissing(value) ? NO_VALUE : BOX_SIZE_NAMES[String(value)] ?? String(value))
const distance = (value: unknown, context: SettingFormatContext) => {
  const number = asNumber(value)
  return number === null ? NO_VALUE : `${number} ${distanceUnitNameEl(context.distanceUnit)}`
}

// {"FULL_COMPENSATION": 100, "HALF": 50} is "πλήρης αποζημίωση 100%, half 50%".
function formatPayoutPolicies(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return NO_VALUE
  const parts = Object.entries(value as Record<string, unknown>).map(([name, percent]) => {
    const number = asNumber(percent)
    return number === null ? policyNameEl(name) : `${policyNameEl(name)} ${number}%`
  })
  return parts.join(', ') || 'κανένας'
}

// "10:00" from 600 minutes after midnight.
function clock(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

// The reason's Greek label when it has one (spec 0054), else its English one.
function formatRemovalReason(value: unknown): string {
  if (isMissing(value) || typeof value !== 'object') return 'κανένας'
  const reason = value as { label?: string; labelEl?: string | null; paidToRider?: boolean }
  return `${reason.labelEl || reason.label || ''}, ${reason.paidToRider ? 'πληρώνει τον διανομέα' : 'δεν πληρώνει'}`
}

function formatShiftSlot(value: unknown): string {
  if (isMissing(value) || typeof value !== 'object') return 'καμία'
  const slot = value as { weekday?: number; startMinute?: number; endMinute?: number; riderCap?: number }
  const day = WEEKDAYS[(slot.weekday ?? 1) - 1] ?? 'Μια μέρα'
  return `${day} ${clock(slot.startMinute ?? 0)} ως ${clock(slot.endMinute ?? 0)}, έως ${slot.riderCap ?? 0} διανομείς`
}

// `typeof RIDER_FACING_SETTINGS` keys: the compiler cannot list them (the English object is a plain
// Record), so the test that compares both key lists is what keeps them together.
export const RIDER_FACING_SETTINGS_EL: Record<string, RiderFacingSetting> = {
  courierMatcherType: {
    label: 'Ποιος παίρνει μια πρόταση',
    format: (value) => (isMissing(value) ? NO_VALUE : MATCHER_NAMES[String(value)] ?? String(value)),
  },
  maxAssignmentDistance: { label: 'Μέγιστη απόσταση από το κατάστημα για μια πρόταση', format: distance },
  distanceUnit: {
    label: 'Μονάδα απόστασης',
    format: (value) => (isMissing(value) ? NO_VALUE : distanceUnitNameEl(String(value))),
  },
  currency: { label: 'Νόμισμα', format: (value) => (isMissing(value) ? NO_VALUE : String(value)) },
  offerExpiryEnabled: { label: 'Οι προτάσεις λήγουν μόνες τους', format: onOff },
  offerExpirySeconds: { label: 'Χρόνος για να απαντήσετε σε μια πρόταση', format: withUnit('δευτερόλεπτα') },
  offerTimingEnabled: { label: 'Προτάσεις συγχρονισμένες με την ώρα που ετοιμάζεται το φαγητό', format: onOff },
  offerLeadMinutes: {
    label: 'Πόσο νωρίτερα από την ετοιμασία του φαγητού βγαίνει μια πρόταση',
    format: withUnit('λεπτά'),
  },
  offerTimingCandidates: {
    label: 'Διανομείς που εξετάζονται για μια συγχρονισμένη πρόταση',
    format: withUnit('διανομείς'),
  },
  stackingEnabled: { label: 'Δύο παραγγελίες προτείνονται μαζί', format: onOff },
  twoOrderPolicy: {
    label: 'Πότε δύο παραγγελίες μπορούν να πάνε μαζί',
    format: (value) =>
      isMissing(value)
        ? NO_VALUE
        : value === 'WHENEVER_FITS'
        ? 'όποτε χωράνε'
        : value === 'SHORTAGE_ONLY'
        ? 'μόνο όταν δεν ταιριάζει κανένας ελεύθερος διανομέας'
        : String(value),
  },
  twoOrderDelayLimitMinutes: {
    label: 'Μέγιστα λεπτά καθυστέρησης για έναν πελάτη από ένα ζευγάρι',
    format: withUnit('λεπτά'),
  },
  addOnOffersEnabled: { label: 'Μία ακόμη παραγγελία προτείνεται ενώ έχετε δουλειά', format: onOff },
  addOnMoment: {
    label: 'Πότε μπορεί να προταθεί μία ακόμη παραγγελία',
    format: (value) =>
      isMissing(value)
        ? NO_VALUE
        : value === 'BEFORE_PICKUP'
        ? 'πριν παραλάβετε την πρώτη παραγγελία'
        : value === 'BEFORE_DROPOFF'
        ? 'οποιαδήποτε στιγμή πριν την πρώτη παράδοση'
        : value === 'SAME_RESTAURANT'
        ? 'μόνο στο ίδιο κατάστημα, πριν την παραλαβή'
        : String(value),
  },
  quoteBaseFee: { label: 'Βασική αμοιβή ανά παράδοση', format: money },
  quoteRatePerDistanceUnit: {
    label: 'Αμοιβή ανά απόσταση',
    format: (value, context) =>
      isMissing(value)
        ? NO_VALUE
        : `${formatCentsEl(value, context.currency)} ανά ${perDistanceUnitEl(context.distanceUnit)}`,
  },
  courierCompensationCalculationType: {
    label: 'Πώς υπολογίζεται η αμοιβή',
    format: (value) => (value === 'FROM_QUOTE_FROM' ? 'βασική αμοιβή συν αμοιβή απόστασης' : policyNameEl(value)),
  },
  waitPayEnabled: { label: 'Αμοιβή για αναμονή σε κατάστημα', format: onOff },
  waitPayFreeMinutes: { label: 'Απλήρωτα λεπτά αναμονής', format: withUnit('λεπτά') },
  waitPayCentsPerMinute: {
    label: 'Αμοιβή ανά λεπτό αναμονής',
    format: (value, context) => (isMissing(value) ? NO_VALUE : `${formatCentsEl(value, context.currency)} ανά λεπτό`),
  },
  waitLimitMinutes: {
    label: 'Λεπτά πριν μπορέσετε να φύγετε από ένα κατάστημα που καθυστερεί',
    format: withUnit('λεπτά'),
  },
  splitAnswerMinutes: {
    label: 'Λεπτά πριν μπορέσετε να φύγετε από μια παραγγελία που ο συντονισμός δεν έχει διαχωρίσει',
    format: withUnit('λεπτά'),
  },
  shiftBreakMinutes: {
    label: 'Μεγαλύτερο διάλειμμα μέσα σε μία βάρδια χρόνου εργασίας',
    format: (value) =>
      asNumber(value) === 0
        ? 'κανένα, κάθε μετάβαση εκτός σύνδεσης χωρίς δουλειά τερματίζει τη βάρδια'
        : withUnit('λεπτά')(value),
  },
  returnTripPayPercent: {
    label: 'Αμοιβή για επιστροφή φαγητού, ως μερίδιο της αμοιβής απόστασης',
    format: withUnit('%'),
  },
  boxUnitsSmall: { label: 'Χώρος που πιάνει μια μικρή παραγγελία στο κουτί', format: withUnit('από 100 μονάδες') },
  boxUnitsMedium: { label: 'Χώρος που πιάνει μια μεσαία παραγγελία στο κουτί', format: withUnit('από 100 μονάδες') },
  boxUnitsLarge: { label: 'Χώρος που πιάνει μια μεγάλη παραγγελία στο κουτί', format: withUnit('από 100 μονάδες') },
  boxDefaultSize: {
    label: 'Μέγεθος που μετρά μια παραγγελία όταν το κατάστημα δεν στέλνει μέγεθος',
    format: boxSizeName,
  },
  fairnessWeightRoadTime: {
    label: 'Βάρος του χρόνου διαδρομής ως το κατάστημα, στην επιλογή του ποιος παίρνει μια πρόταση',
    format: withUnit('από 100'),
  },
  fairnessWeightEarnings: {
    label: 'Βάρος των αποδοχών σας ανά ώρα σήμερα, στην επιλογή του ποιος παίρνει μια πρόταση',
    format: withUnit('από 100'),
  },
  fairnessWeightWaiting: {
    label: 'Βάρος του χρόνου που περιμένετε από την τελευταία σας δουλειά, στην επιλογή του ποιος παίρνει μια πρόταση',
    format: withUnit('από 100'),
  },
  fairnessWeightShift: {
    label:
      'Βάρος του να είστε σε κλεισμένη βάρδια, στην επιλογή του ποιος παίρνει μια πρόταση (μόνο όσο οι βάρδιες είναι ενεργές)',
    format: withUnit('από 100'),
  },
  fairnessCandidateLimit: {
    label: 'Πιο κοντινοί διανομείς που συγκρίνονται για κάθε πρόταση',
    format: withUnit('διανομείς'),
  },
  fairnessMinOnlineMinutes: {
    label: 'Λεπτά σε σύνδεση σήμερα πριν μετρήσουν οι δικές σας αποδοχές (ως τότε, ο μέσος όρος του συνεταιρισμού)',
    format: withUnit('λεπτά'),
  },
  handBackSeconds: {
    label: 'Χρόνος για να επιστρέψετε χωρίς κόστος μια παραγγελία που αποδεχτήκατε',
    format: withUnit('δευτερόλεπτα'),
  },
  offerSkipMinutes: {
    label: 'Χρόνος πριν μπορέσει να σας ξαναπροταθεί μια παραγγελία που απορρίψατε ή χάσατε',
    format: (value) => (asNumber(value) === 1 ? '1 λεπτό' : withUnit('λεπτά')(value)),
  },
  arrivalRadiusMetres: {
    label: 'Απόσταση στην οποία η εφαρμογή σας σημειώνει ότι φτάσατε',
    format: (value) => (asNumber(value) === 0 ? 'ανενεργό' : withUnit('μέτρα')(value)),
  },
  cancellationPayoutPolicy: { label: 'Πληρωμή όταν ακυρώνεται μια δουλειά που αποδεχτήκατε', format: policyNameEl },
  reassignmentPayoutPolicies: {
    label: 'Κανόνες πληρωμής για μια δουλειά από την οποία αποδεσμευτήκατε',
    format: formatPayoutPolicies,
  },
  reassignmentPayoutDefaultPolicy: {
    label: 'Συνήθης πληρωμή όταν αποδεσμεύεστε από μια δουλειά',
    format: policyNameEl,
  },
  shiftsEnabled: { label: 'Βάρδιες', format: onOff },
  shiftDropNoticeHours: { label: 'Προειδοποίηση για να αφήσετε μια βάρδια', format: withUnit('ώρες') },
  reviewAnswerDays: {
    label: 'Ημέρες που έχει ένας άνθρωπος για να απαντήσει σε αίτημα επανεξέτασης',
    format: withUnit('ημέρες'),
  },
  reviewCorrectionMaxCents: {
    label: 'Μεγαλύτερη διόρθωση αμοιβής που μπορεί να προσθέσει μια επανεξέταση',
    format: money,
  },
  addressNoteRetentionDays: {
    label: 'Ημέρες που κρατιέται μια σημείωση διεύθυνσης χωρίς θετική ψήφο από διανομέα',
    format: withUnit('ημέρες'),
  },
  [REMOVAL_REASON_KEY]: { label: 'Λόγος αποδέσμευσης από παραγγελία', format: formatRemovalReason },
  [SHIFT_SLOT_KEY]: { label: 'Βάρδια', format: formatShiftSlot },
}

// The same keys as the English list, in its order; a key with no Greek entry falls back to the English one.
export const riderFacingSettingEl = (key: string): RiderFacingSetting | undefined =>
  RIDER_FACING_SETTINGS_EL[key] ?? RIDER_FACING_SETTINGS[key]
