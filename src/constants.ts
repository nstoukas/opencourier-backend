import { Throttle } from '@nestjs/throttler/dist/throttler.decorator'

export const PLATFORM_NAME = 'PLATFORM_NAME'
export const PLATFORM_NAME_SHORT = 'PLATFORM_NAME_SHORT'
export const NOSH_ENV = 'NOSH_ENV'
export const PUBLIC_API_URL = 'PUBLIC_API_URL'
export const MERCHANT_HELP_PHONE_NUMBER = '9708185603'
export const ADMIN_URL = 'ADMIN_URL'

export const ENABLE_PUB_SUB = 'ENABLE_PUB_SUB'
export const REDIS_URL = 'REDIS_URL'
export const MESSAGE_BUS_QUEUE = 'messageBus'

// Slack
export const SLACK_NOTIFICATION_BOT_TOKEN = 'SLACK_NOTIFICATION_BOT_TOKEN'
export const SLACK_ALERT_NOTIFICATION_CHANNEL_ID = 'SLACK_ALERT_NOTIFICATION_CHANNEL_ID'
export const SLACK_CUSTOMER_CHAT_CHANNEL_ID = 'SLACK_CUSTOMER_CHAT_CHANNEL_ID'

// GCP specific
export const GCP_PROJECT_NAME = 'GCP_PROJECT_NAME'
export const GCP_BUCKET_NAME = 'GCP_BUCKET_NAME'
export const GCP_LOCATION = 'GCP_LOCATION'

// Row 94: the shared secret an outside task runner sends to `api/tasks/v1/execute`. Unset: the route refuses everyone.
export const TASK_RUNNER_SECRET = 'TASK_RUNNER_SECRET'

// Minio specific
export const MINIO_USER = 'MINIO_USER'
export const MINIO_PASSWORD = 'MINIO_PASSWORD'
// Spec 0052 (slice 2): where complaint photos are kept. MINIO_ENDPOINT unset turns photos off; the bucket
// defaults to `complaints` and is made private at startup when missing.
export const MINIO_ENDPOINT = 'MINIO_ENDPOINT'
export const MINIO_BUCKET_COMPLAINTS = 'MINIO_BUCKET_COMPLAINTS'

//Used by providers/secrets/secretsManager.module
export const JWT_SECRET_KEY = 'JWT_SECRET_KEY'
export const JWT_REFRESH_SECRET_KEY = 'JWT_REFRESH_SECRET_KEY'
export const JWT_EXPIRATION = 'JWT_EXPIRATION'
export const JWT_REFRESH_EXPIRATION = 'JWT_REFRESH_EXPIRATOPM'

//Used by config service for modules in the /integrations folder
//chowly
export const CHOWLY_API_KEY = 'CHOWLY_API_KEY'
export const CHOWLY_BASE_URL = 'CHOWLY_BASE_URL'

//checkmate
export const CHECKMATE_CLIENT_ID = 'CHECKMATE_CLIENT_ID'
export const CHECKMATE_CLIENT_SECRET = 'CHECKMATE_CLIENT_SECRET'
export const CHECKMATE_REDIRECT_URL = 'CHECKMATE_REDIRECT_URL'
export const CHECKMATE_BASE_URL = 'CHECKMATE_BASE_URL'

//shipday
export const SHIPDAY_API_KEY = 'SHIPDAY_API_KEY'
export const SHIPDAY_BASE_URL = 'SHIPDAY_BASE_URL'

//twilio
export const TWILIO_ACCOUNT_SID = 'TWILIO_ACCOUNT_SID'
export const TWILIO_AUTH_TOKEN = 'TWILIO_AUTH_TOKEN'
export const TWILIO_VERIFICATIONS_SERVICE_SID = 'TWILIO_VERIFICATIONS_SERVICE_SID'
export const TWILIO_API_KEY_SID = 'TWILIO_API_KEY_SID'
export const TWILIO_API_KEY_SECRET = 'TWILIO_API_KEY_SECRET'
export const TWILIO_CONVERSATIONS_SERVICE_SID = 'TWILIO_CONVERSATIONS_SERVICE_SID'
export const TWILIO_PHONE_NUMBER = 'TWILIO_PHONE_NUMBER'

// Firebase Cloud Messaging (offer push, spec 0003): the path to the co-op's service account JSON
// on the backend host. Unset means push is off. The file itself never goes into git or a log.
export const FIREBASE_SERVICE_ACCOUNT_PATH = 'FIREBASE_SERVICE_ACCOUNT_PATH'

// Mail (row 17, spec 0039): the SMTP server reset codes go out through. SMTP_HOST unset means mail
// is off and "forgot password" answers 503. Mailpit in dev (docker-compose.db.yml).
export const SMTP_HOST = 'SMTP_HOST'
export const SMTP_PORT = 'SMTP_PORT'
export const SMTP_SECURE = 'SMTP_SECURE'
export const SMTP_USER = 'SMTP_USER'
export const SMTP_PASS = 'SMTP_PASS'
export const MAIL_FROM = 'MAIL_FROM'

// Shovel
export const SHOVEL_DATABASE_CONNECTION_HOST_STRING = 'SHOVEL_DATABASE_CONNECTION_HOST_STRING'

// AGORA
export const AGORA_CHAIN = 'AGORA_CHAIN'
export const AGORA_API_PRIVATE_KEY = 'AGORA_API_PRIVATE_KEY'
export const AGORA_API_L1_RPC_WS = 'AGORA_API_L1_RPC_WS'
export const AGORA_API_L2_RPC_WS = 'AGORA_API_L2_RPC_WS'
export const AGORA_BUNDLER_RPC = 'AGORA_BUNDLER_RPC'

//Stripe
export const STRIPE_CLIENT = 'STRIPE_CLIENT'
export const STRIPE_SECRET_KEY = 'STRIPE_SECRET_KEY'
export const STRIPE_WEBHOOK_SECRET = 'STRIPE_WEBHOOK_SECRET'
export const STRIPE_TEST_MERCHANT_CONNECT_ID = 'STRIPE_TEST_MERCHANT_CONNECT_ID'

//Delivery
export const DEFAULT_QUOTE_TO_DELIVERY_MAX_DISTANCE_DRIFT = 'DEFAULT_QUOTE_TO_DELIVERY_MAX_DISTANCE_DRIFT'
export const DEFAULT_MAX_ASSIGNMENT_DISTANCE = 'DEFAULT_MAX_ASSIGNMENT_DISTANCE'
export const DEFAULT_DISTANCE_UNIT = 'DEFAULT_DISTANCE_UNIT'
export const DEFAULT_QUOTE_RATE_PER_DISTANCE_UNIT = 'DEFAULT_QUOTE_RATE_PER_DISTANCE_UNIT'
export const DEFAULT_QUOTE_BASE_FEE = 'DEFAULT_QUOTE_BASE_FEE'
export const DEFAULT_CURRENCY = 'DEFAULT_CURRENCY'
export const DEFAULT_COURIER_COMPENSATION_CALCULATION_TYPE = 'DEFAULT_COURIER_COMPENSATION_CALCULATION_TYPE'

export const DEFAULT_QUOTE_CALCULATION_TYPE = 'DEFAULT_QUOTE_CALCULATION_TYPE'
export const DEFAULT_GEO_CALCULATION_TYPE = 'DEFAULT_GEO_CALCULATION_TYPE'
export const DEFAULT_COURIER_MATCHER_TYPE = 'DEFAULT_COURIER_MATCHER_TYPE'
export const DEFAULT_QUOTE_TO_DELIVERY_CONVERSION_TYPE = 'DEFAULT_QUOTE_TO_DELIVERY_CONVERSION_TYPE'
export const DEFAULT_DELIVERY_DURATION_CALCULATION_TYPE = 'DEFAULT_DELIVERY_DURATION_CALCULATION_TYPE'
export const DELIVERY_QUOTE_EXPIRATION_MINUTES = 'DELIVERY_QUOTE_EXPIRATION_MINUTES'
export const DEFAULT_FEE_PERCENTAGE_AMOUNT = 'DEFAULT_FEE_PERCENTAGE_AMOUNT'

// Spec 0041: the highest co-op fee % a save accepts, so a typo (100 for 10) cannot multiply every
// customer's price. A co-op setting (feePercentageCeiling); these are its fallback and its range.
export const DEFAULT_FEE_PERCENTAGE_CEILING = 25
export const FEE_PERCENTAGE_CEILING_MIN = 0
export const FEE_PERCENTAGE_CEILING_MAX = 100

// Offer expiry (spec 0002). Unlike the DEFAULT_* names above, which are env var names, these are
// the fallback VALUES used only when the Config row is missing. The operative values are co-op
// settings in the Config table (offerExpiryEnabled, offerExpirySeconds, noCourierRetrySeconds).
export const DEFAULT_OFFER_EXPIRY_ENABLED = false
// Restaurant delay pay (spec 0033). Off until the co-op switches it on; fallbacks only.
export const DEFAULT_WAIT_PAY_ENABLED = false
export const DEFAULT_WAIT_PAY_FREE_MINUTES = 10
export const WAIT_PAY_FREE_MINUTES_MIN = 0
export const WAIT_PAY_FREE_MINUTES_MAX = 60
export const DEFAULT_WAIT_PAY_CENTS_PER_MINUTE = 10
export const WAIT_PAY_CENTS_PER_MINUTE_MIN = 0
export const WAIT_PAY_CENTS_PER_MINUTE_MAX = 200
export const DEFAULT_WAIT_LIMIT_MINUTES = 10
export const WAIT_LIMIT_MINUTES_MIN = 1
export const WAIT_LIMIT_MINUTES_MAX = 60
// Spec 0047 (AC-2): minutes after a split flag before the rider may leave, if no admin answered.
export const DEFAULT_SPLIT_ANSWER_MINUTES = 10
export const SPLIT_ANSWER_MINUTES_MIN = 1
export const SPLIT_ANSWER_MINUTES_MAX = 60

// Spec 0040 (AC-17): an Offline with no job shorter than this is a break inside the same worked shift;
// this long or longer ends the shift. 0 means every Offline with no job ends it. A co-op setting.
export const DEFAULT_SHIFT_BREAK_MINUTES = 30
export const SHIFT_BREAK_MINUTES_MIN = 0
export const SHIFT_BREAK_MINUTES_MAX = 240

// Spec 0035: what share of the quote's distance fee a return trip pays. 0 stops paying it.
export const DEFAULT_RETURN_TRIP_PAY_PERCENT = 100
export const RETURN_TRIP_PAY_PERCENT_MIN = 0
export const RETURN_TRIP_PAY_PERCENT_MAX = 100
// Spec 0043 (row 9): how many of a rider's 100 box units each size takes. Placeholders until the
// field study (row 7) replaces them from Instance configuration; fallbacks only.
export const DEFAULT_BOX_UNITS_SMALL = 30
export const DEFAULT_BOX_UNITS_MEDIUM = 50
export const DEFAULT_BOX_UNITS_LARGE = 100
export const BOX_UNITS_MIN = 1
export const BOX_UNITS_MAX = 100
// The size an order with no size sent counts as (AC-3).
export const DEFAULT_BOX_DEFAULT_SIZE = 'MEDIUM'
// Spec 0044 (rows 12 and 13): the fairness matcher's weights (whole numbers 0 to 100, only their ratio
// matters), how many of the nearest riders it scores, and the time online today below which a rider's
// earnings count as the co-op's mean. Starting values from the operator (2026-11-20); the assembly sets them.
export const DEFAULT_FAIRNESS_WEIGHT_ROAD_TIME = 50
export const DEFAULT_FAIRNESS_WEIGHT_EARNINGS = 30
export const DEFAULT_FAIRNESS_WEIGHT_WAITING = 20
// Spec 0049 (row 79): the shift weight starts at 0, so nothing changes until the assembly sets it.
export const DEFAULT_FAIRNESS_WEIGHT_SHIFT = 0
export const FAIRNESS_WEIGHT_MIN = 0
export const FAIRNESS_WEIGHT_MAX = 100
export const DEFAULT_FAIRNESS_CANDIDATE_LIMIT = 10
export const FAIRNESS_CANDIDATE_LIMIT_MIN = 1
export const FAIRNESS_CANDIDATE_LIMIT_MAX = 50
export const DEFAULT_FAIRNESS_MIN_ONLINE_MINUTES = 30
export const FAIRNESS_MIN_ONLINE_MINUTES_MIN = 0
export const FAIRNESS_MIN_ONLINE_MINUTES_MAX = 240
// Offers timed to food readiness (spec 0031). Off until the assembly decides; fallbacks only.
export const DEFAULT_OFFER_TIMING_ENABLED = false
export const DEFAULT_OFFER_LEAD_MINUTES = 3
export const OFFER_LEAD_MINUTES_MIN = 0
export const OFFER_LEAD_MINUTES_MAX = 30
export const DEFAULT_OFFER_TIMING_CANDIDATES = 5
export const OFFER_TIMING_CANDIDATES_MIN = 1
export const OFFER_TIMING_CANDIDATES_MAX = 20
// Stacked orders (spec 0048, AC-1): two orders offered together to one rider. Off until the assembly
// decides; fallbacks only. The delay limit is how much later either customer's food may arrive than
// it would alone, in whole minutes (0 to 30).
export const DEFAULT_STACKING_ENABLED = false
export const DEFAULT_TWO_ORDER_POLICY = 'SHORTAGE_ONLY'
export const DEFAULT_TWO_ORDER_DELAY_LIMIT_MINUTES = 10
export const TWO_ORDER_DELAY_LIMIT_MINUTES_MIN = 0
export const TWO_ORDER_DELAY_LIMIT_MINUTES_MAX = 30
// Mid job add ons (spec 0048, AC-1, AC-6, row 81): one more order offered to a rider already on a job. Off
// until the assembly decides, like stacking; the moment defaults to before the first pickup.
export const DEFAULT_ADD_ON_OFFERS_ENABLED = false
export const DEFAULT_ADD_ON_MOMENT = 'BEFORE_PICKUP'
// Spec 0048 (cross check 9): after a stack is declined or missed, the same two orders are not stacked
// together again for this long (the skip list's 20 minutes). A network rule, not a co-op number.
export const STACK_PAIR_BLOCK_SECONDS = 60 * 20
// Review of row 80: a stack accept whose second ACCEPTED keeps failing is given back to waiting after this
// long (ten tries of the minute sweep), so the sweep never retries one row for ever. A technical limit, not a
// co-op number.
export const STACK_ACCEPT_GIVE_UP_MS = 10 * 60 * 1000
export const DEFAULT_OFFER_EXPIRY_SECONDS = 60
export const DEFAULT_NO_COURIER_RETRY_SECONDS = 30
// Allowed ranges, enforced on save (NUMERIC_SETTING_RULES) and on read. The 20 s floor gives a
// rider on a moped time to pull over safely before looking at the phone (value 3).
export const OFFER_EXPIRY_SECONDS_MIN = 20
export const OFFER_EXPIRY_SECONDS_MAX = 300
export const NO_COURIER_RETRY_SECONDS_MIN = 10
export const NO_COURIER_RETRY_SECONDS_MAX = 300
// Extra seconds the server waits past an offer's deadline before ending it, so an answer sent
// at the last second still arrives in time. A network allowance, not a co-op number.
export const OFFER_EXPIRY_GRACE_SECONDS = 3

// Saved customers (spec 0005). A restaurant's saved customer is deleted once nobody has ordered for
// it in this many months. The operative value is the co-op setting savedCustomerRetentionMonths;
// this is its fallback when the Config row is missing, and the range it must stay in.
export const DEFAULT_SAVED_CUSTOMER_RETENTION_MONTHS = 12
export const SAVED_CUSTOMER_RETENTION_MONTHS_MIN = 1
export const SAVED_CUSTOMER_RETENTION_MONTHS_MAX = 36

// Chat (spec 0034, chat). A message is deleted once it is this many days old (AC-18). The operative value
// is the co-op setting chatRetentionDays; this is its fallback when the Config row is missing, and its range.
export const DEFAULT_CHAT_RETENTION_DAYS = 90
export const CHAT_RETENTION_DAYS_MIN = 7
export const CHAT_RETENTION_DAYS_MAX = 365
// Address notes (spec 0053, AC-6): a courier note nobody upvotes for this many days is deleted by the
// nightly job. The operative value is the co-op setting addressNoteRetentionDays; row 46's lawyer
// confirms the number. 30 to 730 whole days, default 182 (about 6 months).
export const DEFAULT_ADDRESS_NOTE_RETENTION_DAYS = 182
export const ADDRESS_NOTE_RETENTION_DAYS_MIN = 30
export const ADDRESS_NOTE_RETENTION_DAYS_MAX = 730

// Review requests (spec 0038). A person must answer a rider's request within this many whole days
// (AC-3), and may add a pay correction of at most this many cents (AC-7). The operative values are
// the co-op settings reviewAnswerDays and reviewCorrectionMaxCents; these are their fallbacks when
// the Config row is missing, and their ranges. 14 days is the most the directive's spirit allows.
export const DEFAULT_REVIEW_ANSWER_DAYS = 14
export const REVIEW_ANSWER_DAYS_MIN = 1
export const REVIEW_ANSWER_DAYS_MAX = 14
export const DEFAULT_REVIEW_CORRECTION_MAX_CENTS = 5000
export const REVIEW_CORRECTION_MAX_CENTS_MIN = 1
export const REVIEW_CORRECTION_MAX_CENTS_MAX = 100000
// The one tap presets (AC-13): at most this many, each this many characters at most.
export const CHAT_QUICK_REPLIES_MAX_ENTRIES = 8
export const CHAT_QUICK_REPLY_MAX_LENGTH = 100
// Fallbacks when the Config row is missing, in Greek like the riders' and dispatchers' own words.
// No photo wording: the courier app takes no photos (row 18).
export const DEFAULT_CHAT_QUICK_REPLIES_DISPATCH = [
  'Περίμενε 5 λεπτά ακόμα',
  'Άφησέ το στην πόρτα',
  'Πήγαινέ το πίσω στο κατάστημα',
]
export const DEFAULT_CHAT_QUICK_REPLIES_COURIER = [
  'Είμαι στην πόρτα, δεν απαντούν',
  'Το φαγητό δεν είναι έτοιμο',
  'Θα αργήσω λίγο',
]
// A chat message is text only, 1 to this many characters after trimming (AC-4).
export const CHAT_MESSAGE_MAX_LENGTH = 1000
// How long Firebase keeps trying to deliver a chat push (AC-11). A network allowance, not a co-op number.
export const CHAT_PUSH_TTL_SECONDS = 3600

// Order history (spec 0017). A restaurant sees its deliveries from this many days back (rolling, 24 h days),
// plus any still open. The operative value is the co-op setting restaurantHistoryDays; this is its fallback
// when the Config row is missing, and the range it must stay in.
export const DEFAULT_RESTAURANT_HISTORY_DAYS = 30
export const RESTAURANT_HISTORY_DAYS_MIN = 1
export const RESTAURANT_HISTORY_DAYS_MAX = 365
// The free hand back (spec 0020): a rider can give an accepted order back for this many seconds after
// accepting it. The operative value is the co-op setting handBackSeconds; 0 switches the hand back off.
export const DEFAULT_HAND_BACK_SECONDS = 60
export const HAND_BACK_SECONDS_MIN = 0
export const HAND_BACK_SECONDS_MAX = 300

// Shifts (spec 0026, row 77): a co-op switch, off until the assembly decides to run shifts, and how
// many hours before its start a rider may still drop a booked shift (used from row 78).
export const DEFAULT_SHIFTS_ENABLED = false
export const DEFAULT_SHIFT_DROP_NOTICE_HOURS = 12
export const SHIFT_DROP_NOTICE_HOURS_MIN = 0
export const SHIFT_DROP_NOTICE_HOURS_MAX = 168
// SOS (spec 0022): the position points shared during an SOS are deleted this many days after the
// incident's newest point. The operative value is the co-op setting sosLocationRetentionDays; row 46
// sets the real period. 1 to 365 whole days.
export const DEFAULT_SOS_LOCATION_RETENTION_DAYS = 30
export const SOS_LOCATION_RETENTION_DAYS_MIN = 1
export const SOS_LOCATION_RETENTION_DAYS_MAX = 365
// Arrival detection (spec 0021): the app records an arrival when the rider is within this many metres
// of the restaurant or the customer. The operative value is the co-op setting arrivalRadiusMetres; 0
// switches detection off. 20 m is about the floor of a phone's GPS; 300 m is the most that still means
// "at the door".
export const DEFAULT_ARRIVAL_RADIUS_METRES = 50
export const ARRIVAL_RADIUS_METRES_MIN = 20
export const ARRIVAL_RADIUS_METRES_MAX = 300
// Phones are read as Greek numbers unless they start with a country code: this instance serves Volos.
export const DEFAULT_PHONE_REGION = 'GR'

// Offer push (spec 0003). Not co-op settings: how long FCM may hold a message for a phone that is
// out of reach, and when an offer with no deadline rings again louder (AC-7).
// A push with no deadline to measure against (no-deadline offers, OFFER_ENDED) lives this long.
export const PUSH_DEFAULT_TTL_SECONDS = 300
// An offer with no deadline is pushed again, on the insistent channel, after this long unanswered.
export const OFFER_INSIST_AFTER_SECONDS = 120
// The most phones one rider keeps registered for push. Registering an 11th deletes the rider's
// oldest token, so a rider who reinstalls often never piles up dead tokens, and one push never goes
// past FCM's limit of 500 tokens per send.
export const MAX_PUSH_DEVICES_PER_COURIER = 10

// OSRM road routing engine (see docs/osrm-routing.md)
export const OSRM_URL = 'OSRM_URL'
export const OSRM_REQUEST_TIMEOUT_MS = 'OSRM_REQUEST_TIMEOUT_MS'
export const OSRM_CACHE_TTL_SECONDS = 'OSRM_CACHE_TTL_SECONDS'

// API
export const ADMIN_API_V1_PREFIX = 'api/admin/v1'
export const COURIER_API_V1_PREFIX = 'api/courier/v1'
export const PARTNER_API_V1_PREFIX = 'api/partner/v1'
export const PARTNER_ADMIN_API_V1_PREFIX = 'api/partner-admin/v1'
export const COMMON_API_V1_PREFIX = 'api/common/v1'
export const PUBLIC_API_V1_PREFIX = 'api/public/v1'

export const ABLY_API_KEY = 'ABLY_API_KEY'

export const FORWARD_ORDERS_TO_INTEGRATIONS = 'FORWARD_ORDERS_TO_INTEGRATIONS'
export const ALLOW_ROBOCALLS = 'ALLOW_ROBOCALLS'
export const KNOWN_INTEGRATION_TEST_MERCHANTS = [
  'ae8dc93fd8430f46', // Chowly
  '225594', // Checkmate
]

export const CO_TAX_API_KEY = 'CO_TAX_API_KEY'

// TODO: Nick suggested to make it a configurable item per restaurant, but for now we will keep it simple as a global setting.
export const MERCHANT_CATALOG_PREPARATION_MINUTES = 45

export const PREPARATION_BUFFER_MINUTES = 15

// TODO: Mike suggested this should be calculated as a function of addresses and available drivers.
export const DELIVERY_DURATION_MINUTES = 30

export const CHAT_ADMIN_ID = 'NOSH_ADMIN'

export const PUBLIC_DEFAULT_THROTTLE: Parameters<typeof Throttle>[0] = {
  default: {
    limit: 3,
    ttl: 60000,
  },
}

export const SEARCH_THROTTLE: Parameters<typeof Throttle>[0] = {
  default: {
    limit: 120,
    ttl: 60000,
  },
}

// Minutes to wait between order confirmation and us force fulfilling order due to restaurants being lazy
export const PICKUP_ORDER_FORCED_FULFILL_DELAY_MINUTES = 90

// Minutes to wait to cancel order in cases when order can still be recovered
export const ORDER_PAYMENT_CANCELLATION_DELAY_MINUTES = 60

// The instance's time zone (spec 0014): admins enter dispatch stops in it, and riders and restaurants
// read every stop time in it. Volos is the only instance; a setting is a follow up if another one
// ever serves outside Greece.
export const INSTANCE_TIMEZONE = 'Europe/Athens'

// A stop that starts within this many hours shows in the riders' and restaurants' banners (spec 0014).
export const DISPATCH_STOP_LOOKAHEAD_HOURS = 12

// The dispatch map leaves out a rider whose last position is older than this (spec 0034, AC-12).
// A dead phone must not look like a rider standing still.
export const DISPATCH_MAP_POSITION_MAX_AGE_MINUTES = 5

// The most rows the board's Needs attention list sends, to protect the response (spec 0034).
export const DISPATCH_ATTENTION_ROW_LIMIT = 100
