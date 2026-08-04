// The two numbers a member vote sets. They are PLACEHOLDERS chosen to be safe, not ratified
// figures — see the plan's "Numbers a vote must set". Seeding never overwrites an existing
// Config row, so changing them here only affects brand-new instances.

/** Price of one Config.distanceUnit, in minor currency units. 150 = EUR 1.50 per kilometre. */
export const SEEDED_QUOTE_RATE_PER_DISTANCE_UNIT = 150

/** Floor under a courier's pay for one delivery, in minor currency units. 250 = EUR 2.50. */
export const SEEDED_MINIMUM_COURIER_PAY = 250
