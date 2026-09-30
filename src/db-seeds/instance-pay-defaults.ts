// The two numbers a member vote sets. They are PLACEHOLDERS chosen to be safe, not ratified
// figures — see the plan's "Numbers a vote must set". Seeding never overwrites an existing
// Config row, so changing them here only affects brand-new instances.

/** Price of one Config.distanceUnit, in minor currency units. 150 = EUR 1.50 per kilometre. */
export const SEEDED_QUOTE_RATE_PER_DISTANCE_UNIT = 150

/** Base fee per delivery, paid to the rider in full, in whole cents. 200 = EUR 2.00 (spec 0001). */
export const SEEDED_QUOTE_BASE_FEE = 200
