import { Injectable, Logger, BadRequestException } from '@nestjs/common'
import { ChatPreset } from 'src/shared-types/config'
import { ConfigRepository } from '../../persistence/repositories/config.repository'
import { isRecordNotFoundError } from 'src/prisma.util'
import {
  DEFAULT_COURIER_COMPENSATION_CALCULATION_TYPE,
  DEFAULT_COURIER_MATCHER_TYPE,
  DEFAULT_CURRENCY,
  DEFAULT_DELIVERY_DURATION_CALCULATION_TYPE,
  DEFAULT_DISTANCE_UNIT,
  DEFAULT_FEE_PERCENTAGE_AMOUNT,
  DEFAULT_FEE_PERCENTAGE_CEILING,
  FEE_PERCENTAGE_CEILING_MAX,
  FEE_PERCENTAGE_CEILING_MIN,
  DEFAULT_GEO_CALCULATION_TYPE,
  DEFAULT_MAX_ASSIGNMENT_DISTANCE,
  DEFAULT_QUOTE_BASE_FEE,
  DEFAULT_QUOTE_CALCULATION_TYPE,
  DEFAULT_QUOTE_RATE_PER_DISTANCE_UNIT,
  DEFAULT_QUOTE_TO_DELIVERY_CONVERSION_TYPE,
  DEFAULT_QUOTE_TO_DELIVERY_MAX_DISTANCE_DRIFT,
  DELIVERY_QUOTE_EXPIRATION_MINUTES,
  DEFAULT_OFFER_EXPIRY_ENABLED,
  DEFAULT_WAIT_LIMIT_MINUTES,
  DEFAULT_WAIT_PAY_CENTS_PER_MINUTE,
  DEFAULT_WAIT_PAY_ENABLED,
  DEFAULT_WAIT_PAY_FREE_MINUTES,
  WAIT_LIMIT_MINUTES_MAX,
  WAIT_LIMIT_MINUTES_MIN,
  DEFAULT_SPLIT_ANSWER_MINUTES,
  SPLIT_ANSWER_MINUTES_MAX,
  SPLIT_ANSWER_MINUTES_MIN,
  DEFAULT_RETURN_TRIP_PAY_PERCENT,
  DEFAULT_BOX_UNITS_SMALL,
  DEFAULT_BOX_UNITS_MEDIUM,
  DEFAULT_BOX_UNITS_LARGE,
  DEFAULT_BOX_DEFAULT_SIZE,
  BOX_UNITS_MIN,
  BOX_UNITS_MAX,
  DEFAULT_FAIRNESS_CANDIDATE_LIMIT,
  DEFAULT_FAIRNESS_MIN_ONLINE_MINUTES,
  DEFAULT_FAIRNESS_WEIGHT_EARNINGS,
  DEFAULT_FAIRNESS_WEIGHT_ROAD_TIME,
  DEFAULT_FAIRNESS_WEIGHT_WAITING,
  DEFAULT_FAIRNESS_WEIGHT_SHIFT,
  FAIRNESS_CANDIDATE_LIMIT_MAX,
  FAIRNESS_CANDIDATE_LIMIT_MIN,
  FAIRNESS_MIN_ONLINE_MINUTES_MAX,
  FAIRNESS_MIN_ONLINE_MINUTES_MIN,
  FAIRNESS_WEIGHT_MAX,
  FAIRNESS_WEIGHT_MIN,
  RETURN_TRIP_PAY_PERCENT_MIN,
  RETURN_TRIP_PAY_PERCENT_MAX,
  WAIT_PAY_CENTS_PER_MINUTE_MAX,
  WAIT_PAY_CENTS_PER_MINUTE_MIN,
  WAIT_PAY_FREE_MINUTES_MAX,
  WAIT_PAY_FREE_MINUTES_MIN,
  DEFAULT_SHIFT_BREAK_MINUTES,
  SHIFT_BREAK_MINUTES_MAX,
  SHIFT_BREAK_MINUTES_MIN,
  DEFAULT_OFFER_LEAD_MINUTES,
  DEFAULT_OFFER_TIMING_CANDIDATES,
  DEFAULT_OFFER_TIMING_ENABLED,
  OFFER_LEAD_MINUTES_MAX,
  OFFER_LEAD_MINUTES_MIN,
  OFFER_TIMING_CANDIDATES_MAX,
  OFFER_TIMING_CANDIDATES_MIN,
  DEFAULT_OFFER_EXPIRY_SECONDS,
  DEFAULT_NO_COURIER_RETRY_SECONDS,
  OFFER_EXPIRY_SECONDS_MIN,
  OFFER_EXPIRY_SECONDS_MAX,
  NO_COURIER_RETRY_SECONDS_MIN,
  NO_COURIER_RETRY_SECONDS_MAX,
  DEFAULT_SAVED_CUSTOMER_RETENTION_MONTHS,
  SAVED_CUSTOMER_RETENTION_MONTHS_MIN,
  SAVED_CUSTOMER_RETENTION_MONTHS_MAX,
  DEFAULT_CHAT_RETENTION_DAYS,
  CHAT_RETENTION_DAYS_MIN,
  CHAT_RETENTION_DAYS_MAX,
  DEFAULT_ADDRESS_NOTE_RETENTION_DAYS,
  ADDRESS_NOTE_RETENTION_DAYS_MIN,
  ADDRESS_NOTE_RETENTION_DAYS_MAX,
  DEFAULT_STACKING_ENABLED,
  DEFAULT_TWO_ORDER_POLICY,
  DEFAULT_TWO_ORDER_DELAY_LIMIT_MINUTES,
  TWO_ORDER_DELAY_LIMIT_MINUTES_MIN,
  TWO_ORDER_DELAY_LIMIT_MINUTES_MAX,
  DEFAULT_ADD_ON_OFFERS_ENABLED,
  DEFAULT_ADD_ON_MOMENT,
  DEFAULT_REVIEW_ANSWER_DAYS,
  REVIEW_ANSWER_DAYS_MIN,
  REVIEW_ANSWER_DAYS_MAX,
  DEFAULT_REVIEW_CORRECTION_MAX_CENTS,
  REVIEW_CORRECTION_MAX_CENTS_MIN,
  REVIEW_CORRECTION_MAX_CENTS_MAX,
  DEFAULT_CHAT_QUICK_REPLIES_DISPATCH,
  DEFAULT_CHAT_QUICK_REPLIES_COURIER,
  DEFAULT_RESTAURANT_HISTORY_DAYS,
  RESTAURANT_HISTORY_DAYS_MIN,
  RESTAURANT_HISTORY_DAYS_MAX,
  DEFAULT_SOS_LOCATION_RETENTION_DAYS,
  SOS_LOCATION_RETENTION_DAYS_MIN,
  SOS_LOCATION_RETENTION_DAYS_MAX,
  DEFAULT_HAND_BACK_SECONDS,
  HAND_BACK_SECONDS_MIN,
  HAND_BACK_SECONDS_MAX,
  DEFAULT_OFFER_SKIP_MINUTES,
  OFFER_SKIP_MINUTES_MIN,
  OFFER_SKIP_MINUTES_MAX,
  DEFAULT_SHIFTS_ENABLED,
  DEFAULT_SHIFT_DROP_NOTICE_HOURS,
  SHIFT_DROP_NOTICE_HOURS_MIN,
  SHIFT_DROP_NOTICE_HOURS_MAX,
  DEFAULT_ARRIVAL_RADIUS_METRES,
  ARRIVAL_RADIUS_METRES_MIN,
  ARRIVAL_RADIUS_METRES_MAX,
} from 'src/constants'
import {
  EnumCourierCompensationCalculationType,
  EnumCourierDietaryRestrictions,
  EnumCourierMatcherType,
  EnumCurrency,
  EnumDeliveryDurationCalculationType,
  EnumDistanceUnit,
  EnumGeoCalculationType,
  EnumQuoteCalculationType,
  EnumQuoteToDeliveryConversionServiceType,
  EnumTwoOrderPolicy,
  EnumAddOnMoment,
  InstanceConfigSettingOptions,
  InstanceConfigSettings,
  InstanceDetails,
  convertToKM,
  FALLBACK_REASSIGNMENT_PAYOUT_POLICIES,
  FALLBACK_REASSIGNMENT_PAYOUT_DEFAULT_POLICY,
  FALLBACK_CANCELLATION_PAYOUT_POLICY,
} from 'src/shared-types/index'
import { ConfigService } from '@nestjs/config'
import { ConfigKey } from 'src/shared-types/index'
import { InstanceConfigSettingsInput } from 'src/rest-api/config/admin/queries/instance-config-settings.input'
import { DISPATCH_PHONE_NUMBER_REFUSAL, normalizeDispatchPhoneNumber } from './dispatch-phone-number'
import { checkChatQuickReplies, storedChatQuickReplies } from './chat-quick-replies'
import { writeSettingChange } from 'src/persistence/repositories/setting-change.repository'
import { BoxSize } from '@prisma/types'
import { boxUnitsOrderRefusal } from 'src/domains/delivery/box'
import { errorSummaryForLog } from 'src/utils/errorForLog'

// Every numeric setting admin can save. `whyZeroIsRefused: null` means 0 is a valid value.
// Adding a numeric setting to InstanceConfigSettingsInput? Add it here too, and save it
// below with `!== undefined`, never `if (data.x)`: a truthy check silently drops a 0.
// Also give it @RefuseIfNotSentAsNumber() in InstanceConfigSettingsAdminInput, or an empty value saves as 0.
// Exported so the tests can walk this table: each rule gets its own zero and negative checks.
export const NUMERIC_SETTING_RULES: {
  // keyof = the name of one of the input's fields, so a typo here fails typecheck.
  key: keyof InstanceConfigSettingsInput
  whyZeroIsRefused: string | null
  // `?` = optional; leave it out for settings that may hold a fraction (a rate of 87.5 per km).
  mustBeWholeCents?: boolean
  // A whole number that is not money (seconds, say). Same check as mustBeWholeCents, worded for it.
  mustBeInteger?: boolean
  // Inclusive limits. Each one's message names the setting and the allowed range.
  min?: number
  max?: number
  // What 0 switches off (spec 0021). When set, 0 is valid and skips min and max, and the refusal
  // for a value under min says "or 0 to switch <this> off".
  zeroSwitchesOff?: string
}[] = [
  { key: 'feePercentageAmount', whyZeroIsRefused: null },
  // Spec 0041 (AC-1): 0 is allowed (it holds the fee at 0). The fee itself is checked against it
  // inside the save's transaction, where both values in effect are known (AC-2 to AC-5).
  {
    key: 'feePercentageCeiling',
    whyZeroIsRefused: null,
    mustBeInteger: true,
    min: FEE_PERCENTAGE_CEILING_MIN,
    max: FEE_PERCENTAGE_CEILING_MAX,
  },
  { key: 'quoteRatePerDistanceUnit', whyZeroIsRefused: null },
  // 0 is allowed: a base fee of 0 is a real (if poor) choice the members may vote.
  { key: 'quoteBaseFee', whyZeroIsRefused: null, mustBeWholeCents: true },
  { key: 'defaultCourierPayRate', whyZeroIsRefused: null },
  { key: 'maxDriftDistance', whyZeroIsRefused: null },
  {
    key: 'maxAssignmentDistance',
    // Not "zero km": the courier queries read a 0 limit as no limit at all.
    whyZeroIsRefused: 'the matcher reads 0 as "no limit" and would offer deliveries to couriers at any distance',
  },
  {
    key: 'quoteExpirationMinutes',
    // calculateDeliveryQuoteExpiration throws on 0, so every quote request would fail.
    whyZeroIsRefused: 'a quote would expire the moment it is made, so no delivery could be booked',
  },
  {
    key: 'defaultMaxWorkingHours',
    whyZeroIsRefused: 'a courier given this default would have no time to work',
  },
  // Offer expiry (spec 0002). The 20 s floor gives a rider on a moped time to pull over safely.
  {
    key: 'offerExpirySeconds',
    whyZeroIsRefused: 'an offer would end the moment it reaches the rider',
    mustBeInteger: true,
    min: OFFER_EXPIRY_SECONDS_MIN,
    max: OFFER_EXPIRY_SECONDS_MAX,
  },
  {
    key: 'waitPayFreeMinutes',
    whyZeroIsRefused: null,
    mustBeInteger: true,
    min: WAIT_PAY_FREE_MINUTES_MIN,
    max: WAIT_PAY_FREE_MINUTES_MAX,
  },
  // Spec 0040 (AC-17): 0 is allowed and means every Offline with no job ends the shift.
  {
    key: 'shiftBreakMinutes',
    whyZeroIsRefused: null,
    mustBeInteger: true,
    min: SHIFT_BREAK_MINUTES_MIN,
    max: SHIFT_BREAK_MINUTES_MAX,
  },
  {
    key: 'waitPayCentsPerMinute',
    whyZeroIsRefused: null,
    mustBeInteger: true,
    min: WAIT_PAY_CENTS_PER_MINUTE_MIN,
    max: WAIT_PAY_CENTS_PER_MINUTE_MAX,
  },
  {
    key: 'waitLimitMinutes',
    whyZeroIsRefused: 'a rider could leave the moment they arrive',
    mustBeInteger: true,
    min: WAIT_LIMIT_MINUTES_MIN,
    max: WAIT_LIMIT_MINUTES_MAX,
  },
  {
    // Spec 0047 (AC-2): 0 would let a rider leave the moment they flag a split.
    key: 'splitAnswerMinutes',
    whyZeroIsRefused: 'a rider could leave the moment they flag a split',
    mustBeInteger: true,
    min: SPLIT_ANSWER_MINUTES_MIN,
    max: SPLIT_ANSWER_MINUTES_MAX,
  },
  {
    // Spec 0035: 0 stops paying the trip back, which is a real choice of the members.
    key: 'returnTripPayPercent',
    whyZeroIsRefused: null,
    mustBeInteger: true,
    min: RETURN_TRIP_PAY_PERCENT_MIN,
    max: RETURN_TRIP_PAY_PERCENT_MAX,
  },
  // Spec 0043 (AC-2): the box units each size takes, out of a rider's 100. An order takes some room,
  // so 0 is refused; the Small <= Medium <= Large order is checked inside the save's transaction.
  {
    key: 'boxUnitsSmall',
    whyZeroIsRefused: 'every order takes some room in the box',
    mustBeInteger: true,
    min: BOX_UNITS_MIN,
    max: BOX_UNITS_MAX,
  },
  {
    key: 'boxUnitsMedium',
    whyZeroIsRefused: 'every order takes some room in the box',
    mustBeInteger: true,
    min: BOX_UNITS_MIN,
    max: BOX_UNITS_MAX,
  },
  // Spec 0044 (AC-5): the fairness weights. 0 is allowed for one weight (that factor then does not
  // count); the save refuses all three at 0 inside its transaction.
  {
    key: 'fairnessWeightRoadTime',
    whyZeroIsRefused: null,
    mustBeInteger: true,
    min: FAIRNESS_WEIGHT_MIN,
    max: FAIRNESS_WEIGHT_MAX,
  },
  {
    key: 'fairnessWeightEarnings',
    whyZeroIsRefused: null,
    mustBeInteger: true,
    min: FAIRNESS_WEIGHT_MIN,
    max: FAIRNESS_WEIGHT_MAX,
  },
  {
    key: 'fairnessWeightWaiting',
    whyZeroIsRefused: null,
    mustBeInteger: true,
    min: FAIRNESS_WEIGHT_MIN,
    max: FAIRNESS_WEIGHT_MAX,
  },
  // Spec 0049 (AC-1, cross check 5): the shift weight, 0 to 100, default 0. It never counts toward the
  // "not all three at 0" rule, because it only applies while shifts are on.
  {
    key: 'fairnessWeightShift',
    whyZeroIsRefused: null,
    mustBeInteger: true,
    min: FAIRNESS_WEIGHT_MIN,
    max: FAIRNESS_WEIGHT_MAX,
  },
  {
    key: 'fairnessCandidateLimit',
    whyZeroIsRefused: 'no rider could be compared at all',
    mustBeInteger: true,
    min: FAIRNESS_CANDIDATE_LIMIT_MIN,
    max: FAIRNESS_CANDIDATE_LIMIT_MAX,
  },
  {
    key: 'fairnessMinOnlineMinutes',
    whyZeroIsRefused: null,
    mustBeInteger: true,
    min: FAIRNESS_MIN_ONLINE_MINUTES_MIN,
    max: FAIRNESS_MIN_ONLINE_MINUTES_MAX,
  },
  {
    key: 'boxUnitsLarge',
    whyZeroIsRefused: 'every order takes some room in the box',
    mustBeInteger: true,
    min: BOX_UNITS_MIN,
    max: BOX_UNITS_MAX,
  },
  {
    key: 'offerLeadMinutes',
    whyZeroIsRefused: null,
    mustBeInteger: true,
    min: OFFER_LEAD_MINUTES_MIN,
    max: OFFER_LEAD_MINUTES_MAX,
  },
  {
    key: 'offerTimingCandidates',
    whyZeroIsRefused: 'no rider could be compared at all',
    mustBeInteger: true,
    min: OFFER_TIMING_CANDIDATES_MIN,
    max: OFFER_TIMING_CANDIDATES_MAX,
  },
  {
    key: 'noCourierRetrySeconds',
    whyZeroIsRefused: 'a delivery nobody can take would be matched again without any pause',
    mustBeInteger: true,
    min: NO_COURIER_RETRY_SECONDS_MIN,
    max: NO_COURIER_RETRY_SECONDS_MAX,
  },
  // Saved customers (spec 0005): how long an unused customer's personal data is kept.
  {
    key: 'savedCustomerRetentionMonths',
    whyZeroIsRefused: 'every saved customer would be deleted the day it was saved',
    mustBeInteger: true,
    min: SAVED_CUSTOMER_RETENTION_MONTHS_MIN,
    max: SAVED_CUSTOMER_RETENTION_MONTHS_MAX,
  },
  // Chat (spec 0034, AC-18): how long chat messages are kept.
  {
    key: 'chatRetentionDays',
    whyZeroIsRefused: 'every chat message would be deleted the day it was written',
    mustBeInteger: true,
    min: CHAT_RETENTION_DAYS_MIN,
    max: CHAT_RETENTION_DAYS_MAX,
  },
  // Stacked orders (spec 0048, AC-1): minutes either customer's food may arrive later than alone.
  // 0 is a real choice (only stacks that delay nobody).
  {
    key: 'twoOrderDelayLimitMinutes',
    whyZeroIsRefused: null,
    mustBeInteger: true,
    min: TWO_ORDER_DELAY_LIMIT_MINUTES_MIN,
    max: TWO_ORDER_DELAY_LIMIT_MINUTES_MAX,
  },
  // Address notes (spec 0053, AC-6): days a courier note is kept without an upvote.
  {
    key: 'addressNoteRetentionDays',
    whyZeroIsRefused: 'every address note would be deleted the night it was written',
    mustBeInteger: true,
    min: ADDRESS_NOTE_RETENTION_DAYS_MIN,
    max: ADDRESS_NOTE_RETENTION_DAYS_MAX,
  },
  // Review requests (spec 0038): days to answer (AC-3) and the largest correction (AC-7).
  {
    key: 'reviewAnswerDays',
    whyZeroIsRefused: 'every review request would be overdue the moment it was sent',
    mustBeInteger: true,
    min: REVIEW_ANSWER_DAYS_MIN,
    max: REVIEW_ANSWER_DAYS_MAX,
  },
  {
    key: 'reviewCorrectionMaxCents',
    whyZeroIsRefused: 'no review could ever put a rider\'s pay right',
    mustBeInteger: true,
    min: REVIEW_CORRECTION_MAX_CENTS_MIN,
    max: REVIEW_CORRECTION_MAX_CENTS_MAX,
  },
  // Order history (spec 0017): how far back a restaurant sees its own orders.
  {
    key: 'restaurantHistoryDays',
    whyZeroIsRefused: 'a restaurant would not see the orders it sent today once they ended',
    mustBeInteger: true,
    min: RESTAURANT_HISTORY_DAYS_MIN,
    max: RESTAURANT_HISTORY_DAYS_MAX,
  },
  // SOS (spec 0022): days the position points shared during an SOS are kept, 1 to 365. The spec's
  // sketch had `whyZeroIsRefused: null`, which in this table means 0 is valid; 0 is refused with a
  // reason instead, like restaurantHistoryDays (decision 73.8).
  {
    key: 'sosLocationRetentionDays',
    whyZeroIsRefused: 'the positions shared during an SOS would be deleted the day they were recorded',
    mustBeInteger: true,
    min: SOS_LOCATION_RETENTION_DAYS_MIN,
    max: SOS_LOCATION_RETENTION_DAYS_MAX,
  },
  // The free hand back (spec 0020): seconds after accepting. 0 is valid: it switches the hand back off.
  {
    key: 'handBackSeconds',
    whyZeroIsRefused: null,
    mustBeInteger: true,
    min: HAND_BACK_SECONDS_MIN,
    max: HAND_BACK_SECONDS_MAX,
  },
  // The skip list (row 144): minutes before a rider who declined or missed an offer can be offered it again.
  {
    key: 'offerSkipMinutes',
    whyZeroIsRefused: 'a rider who declined an offer could be offered the same delivery again at once',
    mustBeInteger: true,
    min: OFFER_SKIP_MINUTES_MIN,
    max: OFFER_SKIP_MINUTES_MAX,
  },
  // Arrival detection (spec 0021): 0 switches it off; otherwise 20 to 300 metres.
  {
    key: 'arrivalRadiusMetres',
    whyZeroIsRefused: null,
    mustBeInteger: true,
    min: ARRIVAL_RADIUS_METRES_MIN,
    max: ARRIVAL_RADIUS_METRES_MAX,
    zeroSwitchesOff: 'detection',
  },
  // Shifts (spec 0026): hours before a booked shift's start it may still be dropped; 0 means up to
  // the start, so 0 is a real value, not "off".
  {
    key: 'shiftDropNoticeHours',
    whyZeroIsRefused: null,
    mustBeInteger: true,
    min: SHIFT_DROP_NOTICE_HOURS_MIN,
    max: SHIFT_DROP_NOTICE_HOURS_MAX,
  },
]

// Spec 0041 (AC-2 to AC-4): refuses a fee % above the ceiling. `ceilingOnly` is true when the save
// sent a new ceiling and no new fee (left out, or the same as the fee in effect), so the message tells
// the admin it is the ceiling that is too low. A fee that is not a finite number (a stored value that
// could not be read, so NaN) is not checked: only a real fee can be compared with the ceiling.
// Exported so the tests can call it directly.
export function assertFeeWithinCeiling(fee: number | null, ceiling: number, ceilingOnly: boolean): void {
  if (fee === null || !Number.isFinite(fee) || fee <= ceiling) return
  if (ceilingOnly) {
    throw new BadRequestException(
      `feePercentageCeiling cannot be below the fee % in effect (${fee}). Lower feePercentageAmount first, or in the same save.`
    )
  }
  throw new BadRequestException(
    `feePercentageAmount can be at most ${ceiling}, the co-op's fee ceiling (feePercentageCeiling). Raise the ceiling first if the co-op decided a higher fee.`
  )
}

// One settings write waiting for the save's transaction (spec 0038, AC-12).
// ChatPreset[]: spec 0054's chat presets, stored as JSON like any list.
type StoredSettingValue = string | number | boolean | string[] | ChatPreset[]
type PendingSettingWrite = { key: ConfigKey; stored: StoredSettingValue; value: unknown }

// Writes the value with object keys in a fixed order, so two equal objects give the same text.
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

// Whether a save leaves a setting's value in effect unchanged (spec 0038, AC-12): lists and
// objects compared by content, and an empty text the same as no value (a cleared dispatch phone
// reads back as null).
export function isSameSettingValue(before: unknown, after: unknown): boolean {
  const plain = (value: unknown) => (value === '' || value === undefined ? null : value)
  return stableJson(plain(before)) === stableJson(plain(after))
}

@Injectable()
export class InstanceConfigDomainService {
  private readonly logger = new Logger(InstanceConfigDomainService.name)

  constructor(private configRepository: ConfigRepository, private fileConfigService: ConfigService) {}

  async getInstanceConfigSettings(): Promise<InstanceConfigSettings> {
    // Instance settings
    const courierMatcherType = await this.getCourierMatcherTypeSetting()
    const quoteCalculationType = await this.getQuoteCalculationTypeSetting()
    const geoCalculationType = await this.getGeoCalculationTypeSetting()
    const deliveryDurationCalculationType = await this.getDeliveryDurationCalculationTypeSetting()
    const courierCompensationCalculationType = await this.getCourierCompensationTypeSetting()
    const maxAssignmentDistance = await this.getMaxAssignmentDistance()
    const maxDriftDistance = await this.getMaxDriftDistance()
    const quoteExpirationMinutes = await this.getQuoteExpirationMinutes()
    const feePercentageAmount = await this.getFeePercentageAmount()
    const feePercentageCeiling = await this.getFeePercentageCeiling()
    const quoteRatePerDistanceUnit = await this.getQuoteRatePerDistanceUnit()
    // A bad stored base fee must stop quoting (getQuoteBaseFee throws), but not this reader:
    // it feeds the admin settings page, where the value gets fixed, and the public metadata.
    // So here it reads as null, which the admin page shows as an empty box, and a warning is logged.
    // .catch() on a promise turns the error into a fallback value instead of failing the await.
    const quoteBaseFee = await this.getQuoteBaseFee().catch((error: Error) => {
      this.logger.warn(errorSummaryForLog(error))
      return null
    })
    const distanceUnit = await this.getDistanceUnit()
    const currency = await this.getCurrency()
    const details = await this.getDetails()
    const updatedAt = await this.getUpdatedAt()
    const registeredRegistries = await this.getRegisteredRegistries()
    const reassignmentPayoutPolicies = await this.getReassignmentPayoutPolicies()
    const reassignmentPayoutDefaultPolicy = await this.getReassignmentPayoutDefaultPolicy()
    const offerExpiryEnabled = await this.getOfferExpiryEnabled()
    const offerExpirySeconds = await this.getOfferExpirySeconds()
    const noCourierRetrySeconds = await this.getNoCourierRetrySeconds()
    const waitPayEnabled = await this.getWaitPayEnabled()
    const waitPayFreeMinutes = await this.getWaitPayFreeMinutes()
    const shiftBreakMinutes = await this.getShiftBreakMinutes()
    const waitPayCentsPerMinute = await this.getWaitPayCentsPerMinute()
    const waitLimitMinutes = await this.getWaitLimitMinutes()
    const splitAnswerMinutes = await this.getSplitAnswerMinutes()
    const returnTripPayPercent = await this.getReturnTripPayPercent()
    const boxUnitsSmall = await this.getBoxUnitsSmall()
    const boxUnitsMedium = await this.getBoxUnitsMedium()
    const boxUnitsLarge = await this.getBoxUnitsLarge()
    const boxDefaultSize = await this.getBoxDefaultSize()
    const fairnessWeightRoadTime = await this.getFairnessWeightRoadTime()
    const fairnessWeightEarnings = await this.getFairnessWeightEarnings()
    const fairnessWeightWaiting = await this.getFairnessWeightWaiting()
    const fairnessWeightShift = await this.getFairnessWeightShift()
    const fairnessCandidateLimit = await this.getFairnessCandidateLimit()
    const fairnessMinOnlineMinutes = await this.getFairnessMinOnlineMinutes()
    const offerTimingEnabled = await this.getOfferTimingEnabled()
    const offerLeadMinutes = await this.getOfferLeadMinutes()
    const offerTimingCandidates = await this.getOfferTimingCandidates()
    const stackingEnabled = await this.getStackingEnabled()
    const twoOrderPolicy = await this.getTwoOrderPolicy()
    const twoOrderDelayLimitMinutes = await this.getTwoOrderDelayLimitMinutes()
    const addOnOffersEnabled = await this.getAddOnOffersEnabled()
    const addOnMoment = await this.getAddOnMoment()
    const savedCustomerRetentionMonths = await this.getSavedCustomerRetentionMonths()
    const restaurantHistoryDays = await this.getRestaurantHistoryDays()
    const handBackSeconds = await this.getHandBackSeconds()
    const offerSkipMinutes = await this.getOfferSkipMinutes()
    const sosLocationRetentionDays = await this.getSosLocationRetentionDays()
    const arrivalRadiusMetres = await this.getArrivalRadiusMetres()
    const shiftsEnabled = await this.getShiftsEnabled()
    const shiftDropNoticeHours = await this.getShiftDropNoticeHours()
    const dispatchPhoneNumber = await this.getDispatchPhoneNumber()
    const cancellationPayoutPolicy = await this.getCancellationPayoutPolicy()
    const chatQuickRepliesDispatch = await this.getChatQuickRepliesDispatch()
    const chatQuickRepliesCourier = await this.getChatQuickRepliesCourier()
    const chatRetentionDays = await this.getChatRetentionDays()
    const addressNoteRetentionDays = await this.getAddressNoteRetentionDays()
    const reviewAnswerDays = await this.getReviewAnswerDays()
    const reviewCorrectionMaxCents = await this.getReviewCorrectionMaxCents()

    // Instance courier defaults
    const defaultCourierPayRate = await this.getDefaultCourierPayRate()
    const defaultMaxWorkingHours = await this.getDefaultMaxWorkingHours()
    const defaultDietaryRestrictions = await this.getDefaultDietaryRestrictions()

    return {
      courierMatcherType,
      quoteCalculationType,
      geoCalculationType,
      deliveryDurationCalculationType,
      courierCompensationCalculationType,
      maxAssignmentDistance,
      maxDriftDistance,
      quoteExpirationMinutes,
      feePercentageAmount,
      feePercentageCeiling,
      quoteRatePerDistanceUnit,
      quoteBaseFee,
      defaultCourierPayRate,
      defaultMaxWorkingHours,
      defaultDietaryRestrictions,
      distanceUnit,
      currency,
      details,
      updatedAt,
      registeredRegistries,
      reassignmentPayoutPolicies,
      reassignmentPayoutDefaultPolicy,
      offerExpiryEnabled,
      offerExpirySeconds,
      noCourierRetrySeconds,
      waitPayEnabled,
      waitPayFreeMinutes,
      shiftBreakMinutes,
      waitPayCentsPerMinute,
      waitLimitMinutes,
      splitAnswerMinutes,
      returnTripPayPercent,
      boxUnitsSmall,
      boxUnitsMedium,
      boxUnitsLarge,
      boxDefaultSize,
      fairnessWeightRoadTime,
      fairnessWeightEarnings,
      fairnessWeightWaiting,
      fairnessWeightShift,
      fairnessCandidateLimit,
      fairnessMinOnlineMinutes,
      offerTimingEnabled,
      offerLeadMinutes,
      offerTimingCandidates,
      stackingEnabled,
      twoOrderPolicy,
      twoOrderDelayLimitMinutes,
      addOnOffersEnabled,
      addOnMoment,
      savedCustomerRetentionMonths,
      restaurantHistoryDays,
      handBackSeconds,
      offerSkipMinutes,
      sosLocationRetentionDays,
      arrivalRadiusMetres,
      shiftsEnabled,
      shiftDropNoticeHours,
      dispatchPhoneNumber,
      cancellationPayoutPolicy,
      chatQuickRepliesDispatch,
      chatQuickRepliesCourier,
      chatRetentionDays,
      addressNoteRetentionDays,
      reviewAnswerDays,
      reviewCorrectionMaxCents,
    }
  }

  getInstanceConfigSettingsOptions(): InstanceConfigSettingOptions {
    return {
      courierMatcherType: Object.values(EnumCourierMatcherType),
      quoteCalculationType: Object.values(EnumQuoteCalculationType),
      geoCalculationType: Object.values(EnumGeoCalculationType),
      deliveryDurationCalculationType: Object.values(EnumDeliveryDurationCalculationType),
      courierCompensationCalculationType: Object.values(EnumCourierCompensationCalculationType),
      defaultDietaryRestrictions: Object.values(EnumCourierDietaryRestrictions),
      distanceUnit: Object.values(EnumDistanceUnit),
      currency: Object.values(EnumCurrency),
    }
  }

  // `changedByUserId`: the admin saving, recorded on each SettingChange row (spec 0038, AC-12).
  async setInstanceConfigSettings(
    data: InstanceConfigSettingsInput,
    changedByUserId: string | null = null
  ): Promise<InstanceConfigSettings> {
    // Phase 1 — validate everything first. A rejected write must leave the Config table
    // completely untouched, so no saveByKey may run before this block has passed.

    // Explicit undefined checks permit saving empty objects or falsy policy settings as voted by members
    if (data.reassignmentPayoutPolicies !== undefined) {
      const isObject =
        typeof data.reassignmentPayoutPolicies === 'object' &&
        data.reassignmentPayoutPolicies !== null &&
        !Array.isArray(data.reassignmentPayoutPolicies)
      const validValues =
        isObject &&
        Object.values(data.reassignmentPayoutPolicies).every(
          (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100
        )
      if (!isObject || !validValues) {
        throw new BadRequestException(
          'Invalid reassignmentPayoutPolicies: each policy value must be a finite number between 0 and 100'
        )
      }
    }

    // Case A: A new default policy key was explicitly provided by the caller.
    if (data.reassignmentPayoutDefaultPolicy !== undefined) {
      const activePolicies =
        data.reassignmentPayoutPolicies !== undefined
          ? data.reassignmentPayoutPolicies
          : await this.getReassignmentPayoutPolicies()
      // Object.prototype.hasOwnProperty.call checks if key is an own property on the object, avoiding inherited prototype properties like 'constructor'
      if (!Object.prototype.hasOwnProperty.call(activePolicies, data.reassignmentPayoutDefaultPolicy)) {
        throw new BadRequestException(
          `Invalid default policy '${data.reassignmentPayoutDefaultPolicy}': must be a key in reassignmentPayoutPolicies`
        )
      }
    }

    // Case B: A new menu was provided without specifying a new default policy key.
    if (data.reassignmentPayoutPolicies !== undefined && data.reassignmentPayoutDefaultPolicy === undefined) {
      const storedDefault = await this.getStoredReassignmentPayoutDefaultPolicy()
      // What the system will actually use — the stored row if there is one, otherwise the
      // in-code fallback. This is the same value the old code checked, so accept/reject is unchanged.
      const effectiveDefault = storedDefault ?? FALLBACK_REASSIGNMENT_PAYOUT_DEFAULT_POLICY

      if (!Object.prototype.hasOwnProperty.call(data.reassignmentPayoutPolicies, effectiveDefault)) {
        const allowedKeys = Object.keys(data.reassignmentPayoutPolicies).join(', ')

        // Two different problems, two different fixes: change a row that exists, versus
        // store a default for the first time.
        const explanation =
          storedDefault !== null
            ? `the stored default policy '${storedDefault}' is not a key in the new menu`
            : `this instance has no stored default policy, so the built-in fallback '${FALLBACK_REASSIGNMENT_PAYOUT_DEFAULT_POLICY}' applies, and it is not a key in the new menu`

        throw new BadRequestException(
          `Cannot save reassignmentPayoutPolicies: ${explanation}. Allowed policies: ${allowedKeys}. ` +
            `Send reassignmentPayoutDefaultPolicy together with reassignmentPayoutPolicies to set both in one request.`
        )
      }
    }

    // Spec 0015, AC-4: the cancellation rule must always name a key of the menu that will be in force.
    const menuAfterSave =
      data.reassignmentPayoutPolicies !== undefined
        ? data.reassignmentPayoutPolicies
        : data.cancellationPayoutPolicy !== undefined
          ? await this.getReassignmentPayoutPolicies()
          : null
    if (data.cancellationPayoutPolicy !== undefined && menuAfterSave !== null) {
      // typeof also catches a JSON null, which @IsOptional lets through.
      if (
        typeof data.cancellationPayoutPolicy !== 'string' ||
        !Object.prototype.hasOwnProperty.call(menuAfterSave, data.cancellationPayoutPolicy)
      ) {
        throw new BadRequestException(
          `Invalid cancellationPayoutPolicy '${String(data.cancellationPayoutPolicy)}': must be a key in reassignmentPayoutPolicies. ` +
            `Allowed policies: ${Object.keys(menuAfterSave).join(', ')}`
        )
      }
    }
    // A new menu without a new rule must keep the rule in force (the stored key, or the fallback).
    if (data.reassignmentPayoutPolicies !== undefined && data.cancellationPayoutPolicy === undefined) {
      const storedRule = await this.getStoredCancellationPayoutPolicy()
      const ruleInForce = storedRule ?? FALLBACK_CANCELLATION_PAYOUT_POLICY
      if (!Object.prototype.hasOwnProperty.call(data.reassignmentPayoutPolicies, ruleInForce)) {
        const explanation =
          storedRule !== null
            ? `the stored cancellationPayoutPolicy '${storedRule}' is not a key in the new menu`
            : `this instance has no stored cancellationPayoutPolicy, so the built-in fallback '${FALLBACK_CANCELLATION_PAYOUT_POLICY}' applies, and it is not a key in the new menu`
        throw new BadRequestException(
          `Cannot save reassignmentPayoutPolicies: ${explanation}. Allowed policies: ${Object.keys(data.reassignmentPayoutPolicies).join(', ')}. ` +
            `Send cancellationPayoutPolicy together with reassignmentPayoutPolicies to set both in one request.`
        )
      }
    }

    // Numeric settings: negatives are never valid. Zero is a real co-op choice for some
    // (a 0% fee) and would break quoting or matching for others, so those refuse it and say why.
    for (const rule of NUMERIC_SETTING_RULES) {
      const value = data[rule.key]
      if (value === undefined) {
        continue
      }
      // typeof also catches null: the ValidationPipe's @IsOptional lets a JSON null through.
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new BadRequestException(`${rule.key} must be a number`)
      }
      if (value < 0) {
        throw new BadRequestException(`${rule.key} cannot be negative`)
      }
      if (rule.mustBeWholeCents && !Number.isInteger(value)) {
        throw new BadRequestException(`${rule.key} must be a whole number of cents`)
      }
      if (rule.mustBeInteger && !Number.isInteger(value)) {
        throw new BadRequestException(`${rule.key} must be a whole number`)
      }
      if (value === 0 && rule.whyZeroIsRefused !== null) {
        throw new BadRequestException(`${rule.key} cannot be 0: ${rule.whyZeroIsRefused}`)
      }
      // 0 is the off switch for this setting: the range below is for the "on" values only.
      if (value === 0 && rule.zeroSwitchesOff !== undefined) {
        continue
      }
      if (rule.min !== undefined && value < rule.min) {
        const orOff = rule.zeroSwitchesOff !== undefined ? `, or 0 to switch ${rule.zeroSwitchesOff} off` : ''
        throw new BadRequestException(`${rule.key} must be ${rule.min} or more${orOff}`)
      }
      if (rule.max !== undefined && value > rule.max) {
        throw new BadRequestException(`${rule.key} must be ${rule.max} or less`)
      }
    }

    // The on/off settings. The DTO's @RefuseIfNotSentAsBoolean() already refuses "false" and
    // friends; this repeats it for any caller that does not come through the ValidationPipe.
    if (data.shiftsEnabled !== undefined && typeof data.shiftsEnabled !== 'boolean') {
      throw new BadRequestException('shiftsEnabled must be true or false')
    }
    if (data.waitPayEnabled !== undefined && typeof data.waitPayEnabled !== 'boolean') {
      throw new BadRequestException('waitPayEnabled must be a boolean')
    }
    if (data.offerTimingEnabled !== undefined && typeof data.offerTimingEnabled !== 'boolean') {
      throw new BadRequestException('offerTimingEnabled must be a boolean')
    }
    if (data.offerExpiryEnabled !== undefined && typeof data.offerExpiryEnabled !== 'boolean') {
      throw new BadRequestException('offerExpiryEnabled must be true or false')
    }
    // Spec 0043: repeats the DTO's @IsEnum for any caller that does not come through the ValidationPipe.
    if (data.boxDefaultSize !== undefined && !Object.values(BoxSize).includes(data.boxDefaultSize)) {
      throw new BadRequestException('boxDefaultSize must be SMALL, MEDIUM or LARGE')
    }
    // Spec 0048 (AC-1): the same checks as the DTO's, for any caller that does not come through the ValidationPipe.
    if (data.stackingEnabled !== undefined && typeof data.stackingEnabled !== 'boolean') {
      throw new BadRequestException('stackingEnabled must be true or false')
    }
    if (data.twoOrderPolicy !== undefined && !Object.values(EnumTwoOrderPolicy).includes(data.twoOrderPolicy)) {
      throw new BadRequestException('twoOrderPolicy must be SHORTAGE_ONLY or WHENEVER_FITS')
    }
    // Row 81: the add on settings, checked the same way.
    if (data.addOnOffersEnabled !== undefined && typeof data.addOnOffersEnabled !== 'boolean') {
      throw new BadRequestException('addOnOffersEnabled must be true or false')
    }
    if (data.addOnMoment !== undefined && !Object.values(EnumAddOnMoment).includes(data.addOnMoment)) {
      throw new BadRequestException('addOnMoment must be BEFORE_PICKUP, BEFORE_DROPOFF or SAME_RESTAURANT')
    }

    // The dispatch line (row 72): normalized here so the save below writes what was checked.
    // typeof also catches a JSON null, which @IsOptional lets through.
    let dispatchPhoneNumber: string | undefined
    if (data.dispatchPhoneNumber !== undefined) {
      const normalized =
        typeof data.dispatchPhoneNumber === 'string' ? normalizeDispatchPhoneNumber(data.dispatchPhoneNumber) : null
      if (normalized === null) {
        throw new BadRequestException(DISPATCH_PHONE_NUMBER_REFUSAL)
      }
      dispatchPhoneNumber = normalized
    }

    // Chat presets (spec 0034, AC-13), trimmed here so the save below writes what was checked.
    let chatQuickRepliesDispatch: ChatPreset[] | undefined
    if (data.chatQuickRepliesDispatch !== undefined) {
      const checked = checkChatQuickReplies('chatQuickRepliesDispatch', data.chatQuickRepliesDispatch)
      if ('refusal' in checked) {
        throw new BadRequestException(checked.refusal)
      }
      chatQuickRepliesDispatch = checked.replies
    }
    let chatQuickRepliesCourier: ChatPreset[] | undefined
    if (data.chatQuickRepliesCourier !== undefined) {
      const checked = checkChatQuickReplies('chatQuickRepliesCourier', data.chatQuickRepliesCourier)
      if ('refusal' in checked) {
        throw new BadRequestException(checked.refusal)
      }
      chatQuickRepliesCourier = checked.replies
    }

    // Phase 2 — write validated settings to the database repository. Each `save` only lists the
    // write; they all run below, in one transaction.
    const writes: PendingSettingWrite[] = []
    // `value` is what the setting means (an object for the JSON ones); `stored` is what saveByKey
    // writes, unchanged from before this spec so the stored text and its type stay the same.
    const save = (key: ConfigKey, stored: StoredSettingValue, value: unknown = stored) => {
      writes.push({ key, stored, value })
    }
    // Numeric settings use !== undefined, never `if (data.x)`: see NUMERIC_SETTING_RULES.
    if (data.courierMatcherType) {
      save(ConfigKey.COURIER_MATCHER_TYPE, data.courierMatcherType)
    }
    if (data.quoteCalculationType) {
      save(ConfigKey.QUOTE_CALCULATION_TYPE, data.quoteCalculationType)
    }
    if (data.geoCalculationType) {
      save(ConfigKey.GEO_CALCULATION_TYPE, data.geoCalculationType)
    }
    if (data.deliveryDurationCalculationType) {
      save(
        ConfigKey.DELIVERY_DURATION_CALCULATION_TYPE,
        data.deliveryDurationCalculationType
      )
    }
    if (data.courierCompensationCalculationType) {
      save(
        ConfigKey.COURIER_COMPENSATION_CALCULATION_TYPE,
        data.courierCompensationCalculationType
      )
    }
    if (data.maxAssignmentDistance !== undefined) {
      save(ConfigKey.MAX_ASSIGNMENT_DISTANCE, data.maxAssignmentDistance)
    }
    if (data.quoteExpirationMinutes !== undefined) {
      save(ConfigKey.QUOTE_EXPIRATION_MINUTES, data.quoteExpirationMinutes)
    }
    if (data.feePercentageAmount !== undefined) {
      save(ConfigKey.FEE_PERCENTAGE_AMOUNT, data.feePercentageAmount)
    }
    if (data.feePercentageCeiling !== undefined) {
      save(ConfigKey.FEE_PERCENTAGE_CEILING, data.feePercentageCeiling)
    }
    if (data.quoteRatePerDistanceUnit !== undefined) {
      save(ConfigKey.QUOTE_RATE_PER_DISTANCE_UNIT, data.quoteRatePerDistanceUnit)
    }
    if (data.quoteBaseFee !== undefined) {
      save(ConfigKey.QUOTE_BASE_FEE, data.quoteBaseFee)
    }

    if (data.defaultCourierPayRate !== undefined) {
      save(ConfigKey.DEFAULT_COURIER_PAY_RATE, data.defaultCourierPayRate)
    }
    if (data.defaultMaxWorkingHours !== undefined) {
      save(ConfigKey.DEFAULT_MAX_WORKING_HOURS, data.defaultMaxWorkingHours)
    }
    if (data.defaultDietaryRestrictions) {
      save(ConfigKey.DEFAULT_DIETARY_RESTRICTIONS, data.defaultDietaryRestrictions)
    }
    if (data.distanceUnit) {
      save(ConfigKey.DISTANCE_UNIT, data.distanceUnit)
    }
    if (data.currency) {
      save(ConfigKey.CURRENCY, data.currency)
    }
    if (data.maxDriftDistance !== undefined) {
      save(ConfigKey.MAX_DRIFT_DISTANCE, data.maxDriftDistance)
    }
    if (data.details) {
      save(ConfigKey.DETAILS, JSON.stringify(data.details), data.details)
    }
    if (data.registeredRegistries) {
      save(ConfigKey.REGISTERED_REGISTRIES, JSON.stringify(data.registeredRegistries), data.registeredRegistries)
    }

    if (data.reassignmentPayoutPolicies !== undefined) {
      save(
        ConfigKey.REASSIGNMENT_PAYOUT_POLICIES,
        JSON.stringify(data.reassignmentPayoutPolicies),
        data.reassignmentPayoutPolicies
      )
    }
    if (data.reassignmentPayoutDefaultPolicy !== undefined) {
      save(
        ConfigKey.REASSIGNMENT_PAYOUT_DEFAULT_POLICY,
        data.reassignmentPayoutDefaultPolicy
      )
    }
    // !== undefined, never `if (data.offerExpiryEnabled)`: that would silently drop a `false`,
    // and switching expiry off is exactly the save that must never be lost.
    if (data.offerExpiryEnabled !== undefined) {
      save(ConfigKey.OFFER_EXPIRY_ENABLED, data.offerExpiryEnabled)
    }
    if (data.offerExpirySeconds !== undefined) {
      save(ConfigKey.OFFER_EXPIRY_SECONDS, data.offerExpirySeconds)
    }
    if (data.noCourierRetrySeconds !== undefined) {
      save(ConfigKey.NO_COURIER_RETRY_SECONDS, data.noCourierRetrySeconds)
    }
    // !== undefined, so a `false` (delay pay off) is saved, not dropped.
    if (data.waitPayEnabled !== undefined) {
      save(ConfigKey.WAIT_PAY_ENABLED, data.waitPayEnabled)
    }
    if (data.waitPayFreeMinutes !== undefined) {
      save(ConfigKey.WAIT_PAY_FREE_MINUTES, data.waitPayFreeMinutes)
    }
    if (data.shiftBreakMinutes !== undefined) {
      save(ConfigKey.SHIFT_BREAK_MINUTES, data.shiftBreakMinutes)
    }
    if (data.waitPayCentsPerMinute !== undefined) {
      save(ConfigKey.WAIT_PAY_CENTS_PER_MINUTE, data.waitPayCentsPerMinute)
    }
    if (data.waitLimitMinutes !== undefined) {
      save(ConfigKey.WAIT_LIMIT_MINUTES, data.waitLimitMinutes)
    }
    if (data.splitAnswerMinutes !== undefined) {
      save(ConfigKey.SPLIT_ANSWER_MINUTES, data.splitAnswerMinutes)
    }
    if (data.returnTripPayPercent !== undefined) {
      save(ConfigKey.RETURN_TRIP_PAY_PERCENT, data.returnTripPayPercent)
    }
    if (data.boxUnitsSmall !== undefined) {
      save(ConfigKey.BOX_UNITS_SMALL, data.boxUnitsSmall)
    }
    if (data.boxUnitsMedium !== undefined) {
      save(ConfigKey.BOX_UNITS_MEDIUM, data.boxUnitsMedium)
    }
    if (data.boxUnitsLarge !== undefined) {
      save(ConfigKey.BOX_UNITS_LARGE, data.boxUnitsLarge)
    }
    if (data.boxDefaultSize !== undefined) {
      save(ConfigKey.BOX_DEFAULT_SIZE, data.boxDefaultSize)
    }
    if (data.fairnessWeightRoadTime !== undefined) {
      save(ConfigKey.FAIRNESS_WEIGHT_ROAD_TIME, data.fairnessWeightRoadTime)
    }
    if (data.fairnessWeightEarnings !== undefined) {
      save(ConfigKey.FAIRNESS_WEIGHT_EARNINGS, data.fairnessWeightEarnings)
    }
    if (data.fairnessWeightWaiting !== undefined) {
      save(ConfigKey.FAIRNESS_WEIGHT_WAITING, data.fairnessWeightWaiting)
    }
    if (data.fairnessWeightShift !== undefined) {
      save(ConfigKey.FAIRNESS_WEIGHT_SHIFT, data.fairnessWeightShift)
    }
    if (data.fairnessCandidateLimit !== undefined) {
      save(ConfigKey.FAIRNESS_CANDIDATE_LIMIT, data.fairnessCandidateLimit)
    }
    if (data.fairnessMinOnlineMinutes !== undefined) {
      save(ConfigKey.FAIRNESS_MIN_ONLINE_MINUTES, data.fairnessMinOnlineMinutes)
    }
    if (data.offerTimingEnabled !== undefined) {
      save(ConfigKey.OFFER_TIMING_ENABLED, data.offerTimingEnabled)
    }
    if (data.offerLeadMinutes !== undefined) {
      save(ConfigKey.OFFER_LEAD_MINUTES, data.offerLeadMinutes)
    }
    if (data.offerTimingCandidates !== undefined) {
      save(ConfigKey.OFFER_TIMING_CANDIDATES, data.offerTimingCandidates)
    }
    // Stacked orders (spec 0048, AC-1).
    if (data.stackingEnabled !== undefined) {
      save(ConfigKey.STACKING_ENABLED, data.stackingEnabled)
    }
    if (data.twoOrderPolicy !== undefined) {
      save(ConfigKey.TWO_ORDER_POLICY, data.twoOrderPolicy)
    }
    if (data.twoOrderDelayLimitMinutes !== undefined) {
      save(ConfigKey.TWO_ORDER_DELAY_LIMIT_MINUTES, data.twoOrderDelayLimitMinutes)
    }
    // Mid job add ons (spec 0048, AC-1, row 81).
    if (data.addOnOffersEnabled !== undefined) {
      save(ConfigKey.ADD_ON_OFFERS_ENABLED, data.addOnOffersEnabled)
    }
    if (data.addOnMoment !== undefined) {
      save(ConfigKey.ADD_ON_MOMENT, data.addOnMoment)
    }
    if (data.savedCustomerRetentionMonths !== undefined) {
      save(
        ConfigKey.SAVED_CUSTOMER_RETENTION_MONTHS,
        data.savedCustomerRetentionMonths
      )
    }
    if (data.handBackSeconds !== undefined) {
      save(ConfigKey.HAND_BACK_SECONDS, data.handBackSeconds)
    }
    if (data.offerSkipMinutes !== undefined) {
      save(ConfigKey.OFFER_SKIP_MINUTES, data.offerSkipMinutes)
    }
    if (data.arrivalRadiusMetres !== undefined) {
      save(ConfigKey.ARRIVAL_RADIUS_METRES, data.arrivalRadiusMetres)
    }
    // !== undefined, so a `false` (Shifts off) is saved, not dropped (as for offerExpiryEnabled).
    if (data.shiftsEnabled !== undefined) {
      save(ConfigKey.SHIFTS_ENABLED, data.shiftsEnabled)
    }
    if (data.shiftDropNoticeHours !== undefined) {
      save(ConfigKey.SHIFT_DROP_NOTICE_HOURS, data.shiftDropNoticeHours)
    }
    if (data.restaurantHistoryDays !== undefined) {
      save(ConfigKey.RESTAURANT_HISTORY_DAYS, data.restaurantHistoryDays)
    }
    if (data.sosLocationRetentionDays !== undefined) {
      save(ConfigKey.SOS_LOCATION_RETENTION_DAYS, data.sosLocationRetentionDays)
    }

    if (data.cancellationPayoutPolicy !== undefined) {
      save(ConfigKey.CANCELLATION_PAYOUT_POLICY, data.cancellationPayoutPolicy)
    }

    // !== undefined, never a truthy check: '' is how a representative clears the number.
    if (dispatchPhoneNumber !== undefined) {
      save(ConfigKey.DISPATCH_PHONE_NUMBER, dispatchPhoneNumber)
    }

    // Chat (spec 0034). An empty list is a real choice (no presets), so !== undefined.
    if (chatQuickRepliesDispatch !== undefined) {
      save(ConfigKey.CHAT_QUICK_REPLIES_DISPATCH, chatQuickRepliesDispatch)
    }
    if (chatQuickRepliesCourier !== undefined) {
      save(ConfigKey.CHAT_QUICK_REPLIES_COURIER, chatQuickRepliesCourier)
    }
    if (data.chatRetentionDays !== undefined) {
      save(ConfigKey.CHAT_RETENTION_DAYS, data.chatRetentionDays)
    }
    if (data.addressNoteRetentionDays !== undefined) {
      save(ConfigKey.ADDRESS_NOTE_RETENTION_DAYS, data.addressNoteRetentionDays)
    }

    if (data.reviewAnswerDays !== undefined) {
      save(ConfigKey.REVIEW_ANSWER_DAYS, data.reviewAnswerDays)
    }
    if (data.reviewCorrectionMaxCents !== undefined) {
      save(ConfigKey.REVIEW_CORRECTION_MAX_CENTS, data.reviewCorrectionMaxCents)
    }

    // Spec 0038 (AC-12): the whole save is one transaction, and each key whose value in effect
    // moved gets a SettingChange row in it. "In effect" is what the app used before the save (the
    // stored value, or the default when no row exists), read once here before anything is written,
    // so a form that resends every value records only what changed.
    await this.configRepository.inTransaction(async (tx) => {
      // One save at a time: a second admin's save waits here until this one commits, then reads the
      // values this one wrote, so its "before" is never stale and no change is recorded twice.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('instance-config-save'))`
      const before: Record<string, unknown> = { ...(await this.getInstanceConfigSettings()) }
      // Spec 0041 (AC-2 to AC-5): the fee % may not end up above the ceiling. Checked here, after the
      // lock and before any write, against the values in effect after this save (what it sends, else
      // what is stored), so two saves at once cannot together pass it. A throw rolls back everything.
      // Only a save that sends the fee or the ceiling is checked (decision 53.3): a stored fee above
      // the ceiling must not block a save of an unrelated setting.
      if (data.feePercentageAmount !== undefined || data.feePercentageCeiling !== undefined) {
        // A full form that resends the fee unchanged is lowering the ceiling, not raising the fee
        // (agy review): its message should say so.
        const feeSentAndNew =
          data.feePercentageAmount !== undefined &&
          !isSameSettingValue(before.feePercentageAmount, data.feePercentageAmount)
        assertFeeWithinCeiling(
          data.feePercentageAmount ?? (before.feePercentageAmount as number | null),
          data.feePercentageCeiling ?? (before.feePercentageCeiling as number),
          data.feePercentageCeiling !== undefined && !feeSentAndNew
        )
      }
      // Spec 0043 (AC-2, cross check 6): Small <= Medium <= Large, on the values in effect after this
      // save (what it sends, else what is stored), checked only when the save sends one of the three,
      // so a stored bad order never blocks an unrelated save (as decision 53.3 does for the fee).
      if (data.boxUnitsSmall !== undefined || data.boxUnitsMedium !== undefined || data.boxUnitsLarge !== undefined) {
        const refusal = boxUnitsOrderRefusal({
          boxUnitsSmall: data.boxUnitsSmall ?? (before.boxUnitsSmall as number),
          boxUnitsMedium: data.boxUnitsMedium ?? (before.boxUnitsMedium as number),
          boxUnitsLarge: data.boxUnitsLarge ?? (before.boxUnitsLarge as number),
        })
        if (refusal) {
          throw new BadRequestException(refusal)
        }
      }
      // Spec 0044 (AC-5, cross check 12): at least one of the three core weights must stay above 0, on the
      // values in effect after this save, checked only when the save sends one of them.
      if (
        data.fairnessWeightRoadTime !== undefined ||
        data.fairnessWeightEarnings !== undefined ||
        data.fairnessWeightWaiting !== undefined
      ) {
        const roadTime = data.fairnessWeightRoadTime ?? (before.fairnessWeightRoadTime as number)
        const earnings = data.fairnessWeightEarnings ?? (before.fairnessWeightEarnings as number)
        const waiting = data.fairnessWeightWaiting ?? (before.fairnessWeightWaiting as number)
        if (roadTime === 0 && earnings === 0 && waiting === 0) {
          throw new BadRequestException(
            'fairnessWeightRoadTime, fairnessWeightEarnings and fairnessWeightWaiting cannot all be 0: the fairness matcher would have nothing to weigh'
          )
        }
      }
      for (const write of writes) {
        await this.configRepository.saveByKey(write.key, write.stored, tx)
        if (!isSameSettingValue(before[write.key], write.value)) {
          await writeSettingChange(tx, {
            key: write.key,
            oldValue: before[write.key],
            newValue: write.value,
            changedByUserId,
          })
        }
      }
      // Update the updated_at timestamp whenever config is changed
      await this.configRepository.saveByKey(ConfigKey.UPDATED_AT, new Date().toISOString(), tx)
    })

    return this.getInstanceConfigSettings()
  }

  async getCourierMatcherTypeSetting(): Promise<EnumCourierMatcherType> {
    const courierMatcherType = await this.getConfigValueOrDefault(ConfigKey.COURIER_MATCHER_TYPE, () =>
      this.fileConfigService.get(DEFAULT_COURIER_MATCHER_TYPE).toString()
    )

    return courierMatcherType.value as EnumCourierMatcherType
  }

  async getQuoteCalculationTypeSetting(): Promise<EnumQuoteCalculationType> {
    const quoteCalculationType = await this.getConfigValueOrDefault(ConfigKey.QUOTE_CALCULATION_TYPE, () =>
      this.fileConfigService.get(DEFAULT_QUOTE_CALCULATION_TYPE).toString()
    )

    return quoteCalculationType.value as EnumQuoteCalculationType
  }

  async getQuoteToDeliveryConversionTypeSetting(): Promise<EnumQuoteToDeliveryConversionServiceType> {
    const quoteToDeliveryConversionType = await this.getConfigValueOrDefault(
      ConfigKey.QUOTE_TO_DELIVERY_CONVERSION_TYPE,
      () => this.fileConfigService.get(DEFAULT_QUOTE_TO_DELIVERY_CONVERSION_TYPE).toString()
    )

    return quoteToDeliveryConversionType.value as EnumQuoteToDeliveryConversionServiceType
  }

  async getDeliveryDurationCalculationTypeSetting(): Promise<EnumDeliveryDurationCalculationType> {
    const deliveryDurationCalculationType = await this.getConfigValueOrDefault(
      ConfigKey.DELIVERY_DURATION_CALCULATION_TYPE,
      () => this.fileConfigService.get(DEFAULT_DELIVERY_DURATION_CALCULATION_TYPE).toString()
    )

    return deliveryDurationCalculationType.value as EnumDeliveryDurationCalculationType
  }

  async getGeoCalculationTypeSetting(): Promise<EnumGeoCalculationType> {
    const quoteCalculationType = await this.getConfigValueOrDefault(ConfigKey.GEO_CALCULATION_TYPE, () =>
      this.fileConfigService.get(DEFAULT_GEO_CALCULATION_TYPE).toString()
    )

    return quoteCalculationType.value as EnumGeoCalculationType
  }

  async getDistanceUnit(): Promise<EnumDistanceUnit> {
    const distanceUnit = await this.getConfigValueOrDefault(ConfigKey.DISTANCE_UNIT, () =>
      this.fileConfigService.get(DEFAULT_DISTANCE_UNIT).toString()
    )

    return distanceUnit.value as EnumDistanceUnit
  }

  async getCurrency(): Promise<EnumCurrency> {
    const currency = await this.getConfigValueOrDefault(ConfigKey.CURRENCY, () =>
      this.fileConfigService.get(DEFAULT_CURRENCY).toString()
    )

    return currency.value as EnumCurrency
  }

  async getCourierCompensationTypeSetting(): Promise<EnumCourierCompensationCalculationType> {
    const quoteCalculationType = await this.getConfigValueOrDefault(
      ConfigKey.COURIER_COMPENSATION_CALCULATION_TYPE,
      () => this.fileConfigService.get(DEFAULT_COURIER_COMPENSATION_CALCULATION_TYPE).toString()
    )

    return quoteCalculationType.value as EnumCourierCompensationCalculationType
  }

  async getFeePercentageAmount(): Promise<number> {
    const feePercentageAmount = await this.getConfigValueOrDefault(ConfigKey.FEE_PERCENTAGE_AMOUNT, () =>
      this.fileConfigService.get(DEFAULT_FEE_PERCENTAGE_AMOUNT).toString()
    )

    return typeof feePercentageAmount.value === 'string'
      ? parseInt(feePercentageAmount.value)
      : (feePercentageAmount.value as number)
  }

  async getQuoteRatePerDistanceUnit(): Promise<number> {
    const quoteRate = await this.getConfigValueOrDefault(ConfigKey.QUOTE_RATE_PER_DISTANCE_UNIT, () =>
      this.fileConfigService.get(DEFAULT_QUOTE_RATE_PER_DISTANCE_UNIT)
    )

    // Number(), not parseInt() — a voted rate may legitimately be fractional (e.g. 87.5
    // minor units per km), and parseInt would silently truncate it to 87.
    return Number(quoteRate.value)
  }

  // The base fee every new quote carries, in whole cents. Unlike the rate above it throws on a
  // bad value instead of passing it on: a base fee of NaN or 12.5 would be stored on the quote
  // and paid to the rider, so it is better that the quote fails loudly.
  async getQuoteBaseFee(): Promise<number> {
    const baseFee = await this.getConfigValueOrDefault(ConfigKey.QUOTE_BASE_FEE, () =>
      this.fileConfigService.get(DEFAULT_QUOTE_BASE_FEE)
    )

    // Number('') and Number(null) are both 0, so an empty value is caught before converting.
    const raw = baseFee.value
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN

    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`quoteBaseFee must be a whole number of cents, 0 or more (found ${String(raw)})`)
    }

    return value
  }

  async getMaxAssignmentDistance(): Promise<number | null> {
    const maxAssignmentDistance = await this.getConfigValueOrDefault(
      ConfigKey.MAX_ASSIGNMENT_DISTANCE,
      this.fileConfigService.get(DEFAULT_MAX_ASSIGNMENT_DISTANCE).toString()
    )

    return typeof maxAssignmentDistance.value === 'string'
      ? parseInt(maxAssignmentDistance.value)
      : (maxAssignmentDistance.value as number)
  }

  async getMaxDriftDistance(): Promise<number | null> {
    const maxDriftDistance = await this.getConfigValueOrDefault(ConfigKey.MAX_DRIFT_DISTANCE, () =>
      this.fileConfigService.get(DEFAULT_QUOTE_TO_DELIVERY_MAX_DISTANCE_DRIFT).toString()
    )

    return typeof maxDriftDistance.value === 'string'
      ? parseInt(maxDriftDistance.value)
      : (maxDriftDistance.value as number)
  }

  async getMaxAssignmentDistanceInKM(): Promise<number | null> {
    const maxAssignmentDistance = await this.getMaxAssignmentDistance()

    if (!maxAssignmentDistance) {
      return null
    }

    const distanceUnit = await this.getDistanceUnit()

    const distanceInKM = convertToKM(maxAssignmentDistance, distanceUnit)

    return distanceInKM
  }

  async getDefaultCourierPayRate(): Promise<number | null> {
    const defaultCourierPayRate = await this.getConfigValueOrDefault(ConfigKey.DEFAULT_COURIER_PAY_RATE, null)

    return typeof defaultCourierPayRate.value === 'string'
      ? parseInt(defaultCourierPayRate.value)
      : (defaultCourierPayRate.value as number)
  }

  async getDefaultMaxWorkingHours(): Promise<number | null> {
    const defaultMaxWorkingHours = await this.getConfigValueOrDefault(ConfigKey.DEFAULT_MAX_WORKING_HOURS, null)

    return typeof defaultMaxWorkingHours.value === 'string'
      ? parseInt(defaultMaxWorkingHours.value)
      : (defaultMaxWorkingHours.value as number)
  }

  async getQuoteExpirationMinutes(): Promise<number> {
    const quoteExpirationMinutes = await this.getConfigValueOrDefault(
      ConfigKey.QUOTE_EXPIRATION_MINUTES,
      this.fileConfigService.get(DELIVERY_QUOTE_EXPIRATION_MINUTES)
    )

    return typeof quoteExpirationMinutes.value === 'string'
      ? parseInt(quoteExpirationMinutes.value)
      : (quoteExpirationMinutes.value as number)
  }

  async getDefaultDietaryRestrictions(): Promise<EnumCourierDietaryRestrictions | null> {
    const defaultDietaryRestrictions = await this.getConfigValueOrDefault(ConfigKey.DEFAULT_DIETARY_RESTRICTIONS, null)

    return defaultDietaryRestrictions.value as EnumCourierDietaryRestrictions
  }

  async getDetails(): Promise<InstanceDetails> {
    const details = await this.getConfigValueOrDefault(ConfigKey.DETAILS, null)

    if (!details.value) {
      return {
        name: '',
        link: '',
        websocketLink: '',
        region: null,
        imageUrl: '',
        rulesUrl: '',
        rulesContent: '',
        descriptionUrl: '',
        descriptionContent: '',
        termsOfServiceUrl: '',
        termsOfServiceContent: '',
        privacyPolicyUrl: '',
        privacyPolicyContent: '',
      }
    }

    const parsedDetails = typeof details.value === 'string' ? JSON.parse(details.value) : details.value

    return parsedDetails as InstanceDetails
  }

  async getUpdatedAt(): Promise<string | null> {
    const updatedAt = await this.getConfigValueOrDefault(ConfigKey.UPDATED_AT, null)

    return updatedAt.value as string | null
  }

  async getRegisteredRegistries(): Promise<string[]> {
    const registeredRegistries = await this.getConfigValueOrDefault(ConfigKey.REGISTERED_REGISTRIES, null)

    if (!registeredRegistries.value) {
      return []
    }

    const parsedRegistries =
      typeof registeredRegistries.value === 'string'
        ? JSON.parse(registeredRegistries.value)
        : registeredRegistries.value

    return Array.isArray(parsedRegistries) ? (parsedRegistries as string[]) : []
  }

  async setRegisteredRegistries(registries: string[]): Promise<void> {
    await this.configRepository.saveByKey(ConfigKey.REGISTERED_REGISTRIES, JSON.stringify(registries))
  }

  async getReassignmentPayoutPolicies(): Promise<Record<string, number>> {
    const config = await this.getConfigValueOrDefault(
      ConfigKey.REASSIGNMENT_PAYOUT_POLICIES,
      () => FALLBACK_REASSIGNMENT_PAYOUT_POLICIES
    )
    const val = config.value
    let parsed: unknown = val
    if (typeof val === 'string') {
      try {
        parsed = JSON.parse(val)
      } catch (e) {
        parsed = null
      }
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Object.values(parsed as Record<string, unknown>).every(
        (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100
      )
    ) {
      return parsed as Record<string, number>
    }
    this.logger.warn(`Invalid reassignmentPayoutPolicies in config, falling back to default.`)
    return FALLBACK_REASSIGNMENT_PAYOUT_POLICIES
  }

  // Returns the default policy as actually stored in the Config table, or null when no
  // usable row exists. `private` = only this class can call it; the public getter below
  // keeps its old behaviour for every other caller.
  private async getStoredReassignmentPayoutDefaultPolicy(): Promise<string | null> {
    const config = await this.getConfigValueOrDefault(ConfigKey.REASSIGNMENT_PAYOUT_DEFAULT_POLICY, null)
    return typeof config.value === 'string' ? config.value : null
  }

  async getReassignmentPayoutDefaultPolicy(): Promise<string> {
    const stored = await this.getStoredReassignmentPayoutDefaultPolicy()
    // `??` returns the right-hand side only for null/undefined — an empty stored string is
    // still returned as-is, exactly as before.
    return stored ?? FALLBACK_REASSIGNMENT_PAYOUT_DEFAULT_POLICY
  }

  // Shifts (spec 0026): on only when the stored value is the boolean true; a missing row or a bad value
  // reads as off, which changes nothing for anyone.
  async getShiftsEnabled(): Promise<boolean> {
    const enabled = await this.getConfigValueOrDefault(ConfigKey.SHIFTS_ENABLED, DEFAULT_SHIFTS_ENABLED)
    return enabled.value === true
  }

  async getShiftDropNoticeHours(): Promise<number> {
    return this.getWholeNumberInRange(
      ConfigKey.SHIFT_DROP_NOTICE_HOURS,
      DEFAULT_SHIFT_DROP_NOTICE_HOURS,
      SHIFT_DROP_NOTICE_HOURS_MIN,
      SHIFT_DROP_NOTICE_HOURS_MAX
    )
  }

  // Offer expiry is on only when the stored value is the boolean true. Anything else, including a
  // missing row or a bad value, reads as off: expiry off is the safe state (offers keep ringing).
  async getOfferExpiryEnabled(): Promise<boolean> {
    const enabled = await this.getConfigValueOrDefault(ConfigKey.OFFER_EXPIRY_ENABLED, DEFAULT_OFFER_EXPIRY_ENABLED)

    return enabled.value === true
  }

  // Spec 0033: restaurant delay pay, off until a representative switches it on.
  async getWaitPayEnabled(): Promise<boolean> {
    const enabled = await this.getConfigValueOrDefault(ConfigKey.WAIT_PAY_ENABLED, DEFAULT_WAIT_PAY_ENABLED)

    return enabled.value === true
  }

  // Spec 0041: the highest fee % a save accepts. Read only by the save check and the settings page.
  async getFeePercentageCeiling(): Promise<number> {
    return this.getWholeNumberInRange(
      ConfigKey.FEE_PERCENTAGE_CEILING,
      DEFAULT_FEE_PERCENTAGE_CEILING,
      FEE_PERCENTAGE_CEILING_MIN,
      FEE_PERCENTAGE_CEILING_MAX
    )
  }

  // Spec 0040 (AC-17): the break limit of a worked shift, read once per time worked request.
  async getShiftBreakMinutes(): Promise<number> {
    return this.getWholeNumberInRange(
      ConfigKey.SHIFT_BREAK_MINUTES,
      DEFAULT_SHIFT_BREAK_MINUTES,
      SHIFT_BREAK_MINUTES_MIN,
      SHIFT_BREAK_MINUTES_MAX
    )
  }

  async getWaitPayFreeMinutes(): Promise<number> {
    return this.getWholeNumberInRange(
      ConfigKey.WAIT_PAY_FREE_MINUTES,
      DEFAULT_WAIT_PAY_FREE_MINUTES,
      WAIT_PAY_FREE_MINUTES_MIN,
      WAIT_PAY_FREE_MINUTES_MAX
    )
  }

  async getWaitPayCentsPerMinute(): Promise<number> {
    return this.getWholeNumberInRange(
      ConfigKey.WAIT_PAY_CENTS_PER_MINUTE,
      DEFAULT_WAIT_PAY_CENTS_PER_MINUTE,
      WAIT_PAY_CENTS_PER_MINUTE_MIN,
      WAIT_PAY_CENTS_PER_MINUTE_MAX
    )
  }

  // Spec 0047 (AC-2): minutes after a split flag before the rider may leave.
  async getSplitAnswerMinutes(): Promise<number> {
    return this.getWholeNumberInRange(
      ConfigKey.SPLIT_ANSWER_MINUTES,
      DEFAULT_SPLIT_ANSWER_MINUTES,
      SPLIT_ANSWER_MINUTES_MIN,
      SPLIT_ANSWER_MINUTES_MAX
    )
  }

  async getWaitLimitMinutes(): Promise<number> {
    return this.getWholeNumberInRange(
      ConfigKey.WAIT_LIMIT_MINUTES,
      DEFAULT_WAIT_LIMIT_MINUTES,
      WAIT_LIMIT_MINUTES_MIN,
      WAIT_LIMIT_MINUTES_MAX
    )
  }

  // Spec 0035: the share of the distance fee a return trip pays.
  async getReturnTripPayPercent(): Promise<number> {
    return this.getWholeNumberInRange(
      ConfigKey.RETURN_TRIP_PAY_PERCENT,
      DEFAULT_RETURN_TRIP_PAY_PERCENT,
      RETURN_TRIP_PAY_PERCENT_MIN,
      RETURN_TRIP_PAY_PERCENT_MAX
    )
  }

  // Spec 0043: the box units each size takes, and the size an order sent with none counts as.
  async getBoxUnitsSmall(): Promise<number> {
    return this.getWholeNumberInRange(ConfigKey.BOX_UNITS_SMALL, DEFAULT_BOX_UNITS_SMALL, BOX_UNITS_MIN, BOX_UNITS_MAX)
  }

  async getBoxUnitsMedium(): Promise<number> {
    return this.getWholeNumberInRange(
      ConfigKey.BOX_UNITS_MEDIUM,
      DEFAULT_BOX_UNITS_MEDIUM,
      BOX_UNITS_MIN,
      BOX_UNITS_MAX
    )
  }

  async getBoxUnitsLarge(): Promise<number> {
    return this.getWholeNumberInRange(ConfigKey.BOX_UNITS_LARGE, DEFAULT_BOX_UNITS_LARGE, BOX_UNITS_MIN, BOX_UNITS_MAX)
  }

  async getBoxDefaultSize(): Promise<BoxSize> {
    const stored = await this.getConfigValueOrDefault(ConfigKey.BOX_DEFAULT_SIZE, DEFAULT_BOX_DEFAULT_SIZE)
    const value = stored.value
    if (typeof value === 'string' && (Object.values(BoxSize) as string[]).includes(value)) {
      return value as BoxSize
    }
    this.logger.warn(
      `Invalid ${ConfigKey.BOX_DEFAULT_SIZE} in config (${String(
        value
      )}), using the default ${DEFAULT_BOX_DEFAULT_SIZE}`
    )
    return DEFAULT_BOX_DEFAULT_SIZE as BoxSize
  }

  // Spec 0044: the fairness matcher's settings, read at offer time so a change applies to the next offer.
  async getFairnessWeightRoadTime(): Promise<number> {
    return this.getWholeNumberInRange(
      ConfigKey.FAIRNESS_WEIGHT_ROAD_TIME,
      DEFAULT_FAIRNESS_WEIGHT_ROAD_TIME,
      FAIRNESS_WEIGHT_MIN,
      FAIRNESS_WEIGHT_MAX
    )
  }

  async getFairnessWeightEarnings(): Promise<number> {
    return this.getWholeNumberInRange(
      ConfigKey.FAIRNESS_WEIGHT_EARNINGS,
      DEFAULT_FAIRNESS_WEIGHT_EARNINGS,
      FAIRNESS_WEIGHT_MIN,
      FAIRNESS_WEIGHT_MAX
    )
  }

  async getFairnessWeightWaiting(): Promise<number> {
    return this.getWholeNumberInRange(
      ConfigKey.FAIRNESS_WEIGHT_WAITING,
      DEFAULT_FAIRNESS_WEIGHT_WAITING,
      FAIRNESS_WEIGHT_MIN,
      FAIRNESS_WEIGHT_MAX
    )
  }

  // Spec 0049 (AC-1): the weight of being on a booked shift, used only while shifts are on.
  async getFairnessWeightShift(): Promise<number> {
    return this.getWholeNumberInRange(
      ConfigKey.FAIRNESS_WEIGHT_SHIFT,
      DEFAULT_FAIRNESS_WEIGHT_SHIFT,
      FAIRNESS_WEIGHT_MIN,
      FAIRNESS_WEIGHT_MAX
    )
  }

  async getFairnessCandidateLimit(): Promise<number> {
    return this.getWholeNumberInRange(
      ConfigKey.FAIRNESS_CANDIDATE_LIMIT,
      DEFAULT_FAIRNESS_CANDIDATE_LIMIT,
      FAIRNESS_CANDIDATE_LIMIT_MIN,
      FAIRNESS_CANDIDATE_LIMIT_MAX
    )
  }

  async getFairnessMinOnlineMinutes(): Promise<number> {
    return this.getWholeNumberInRange(
      ConfigKey.FAIRNESS_MIN_ONLINE_MINUTES,
      DEFAULT_FAIRNESS_MIN_ONLINE_MINUTES,
      FAIRNESS_MIN_ONLINE_MINUTES_MIN,
      FAIRNESS_MIN_ONLINE_MINUTES_MAX
    )
  }

  // Spec 0031: three co-op settings, off and quiet until a representative switches it on.
  async getOfferTimingEnabled(): Promise<boolean> {
    const enabled = await this.getConfigValueOrDefault(ConfigKey.OFFER_TIMING_ENABLED, DEFAULT_OFFER_TIMING_ENABLED)

    return enabled.value === true
  }

  async getOfferLeadMinutes(): Promise<number> {
    return this.getWholeNumberInRange(
      ConfigKey.OFFER_LEAD_MINUTES,
      DEFAULT_OFFER_LEAD_MINUTES,
      OFFER_LEAD_MINUTES_MIN,
      OFFER_LEAD_MINUTES_MAX
    )
  }

  // Spec 0048 (AC-1): stacked orders, off and quiet until a representative switches them on. Read at
  // offer time, so a saved change applies to the next offer.
  async getStackingEnabled(): Promise<boolean> {
    const enabled = await this.getConfigValueOrDefault(ConfigKey.STACKING_ENABLED, DEFAULT_STACKING_ENABLED)
    return enabled.value === true
  }

  // An unknown stored value falls back to the worker centred default, never to "whenever it fits".
  async getTwoOrderPolicy(): Promise<EnumTwoOrderPolicy> {
    const stored = await this.getConfigValueOrDefault(ConfigKey.TWO_ORDER_POLICY, DEFAULT_TWO_ORDER_POLICY)
    const value = stored.value
    if (typeof value === 'string' && (Object.values(EnumTwoOrderPolicy) as string[]).includes(value)) {
      return value as EnumTwoOrderPolicy
    }
    this.logger.warn(`Invalid ${ConfigKey.TWO_ORDER_POLICY} in config (${String(value)}), using ${DEFAULT_TWO_ORDER_POLICY}`)
    return DEFAULT_TWO_ORDER_POLICY as EnumTwoOrderPolicy
  }

  // Spec 0048 (AC-1, row 81): mid job add ons, off until a representative switches them on. Read at offer
  // time, like the stacking switch.
  async getAddOnOffersEnabled(): Promise<boolean> {
    const enabled = await this.getConfigValueOrDefault(ConfigKey.ADD_ON_OFFERS_ENABLED, DEFAULT_ADD_ON_OFFERS_ENABLED)
    return enabled.value === true
  }

  // An unknown stored value falls back to the default, before the first pickup (the narrowest moment that
  // still lets food wait for nobody, and never a moment with food already in the box).
  async getAddOnMoment(): Promise<EnumAddOnMoment> {
    const stored = await this.getConfigValueOrDefault(ConfigKey.ADD_ON_MOMENT, DEFAULT_ADD_ON_MOMENT)
    const value = stored.value
    if (typeof value === 'string' && (Object.values(EnumAddOnMoment) as string[]).includes(value)) {
      return value as EnumAddOnMoment
    }
    this.logger.warn(`Invalid ${ConfigKey.ADD_ON_MOMENT} in config (${String(value)}), using ${DEFAULT_ADD_ON_MOMENT}`)
    return DEFAULT_ADD_ON_MOMENT as EnumAddOnMoment
  }

  async getTwoOrderDelayLimitMinutes(): Promise<number> {
    return this.getWholeNumberInRange(
      ConfigKey.TWO_ORDER_DELAY_LIMIT_MINUTES,
      DEFAULT_TWO_ORDER_DELAY_LIMIT_MINUTES,
      TWO_ORDER_DELAY_LIMIT_MINUTES_MIN,
      TWO_ORDER_DELAY_LIMIT_MINUTES_MAX
    )
  }

  async getOfferTimingCandidates(): Promise<number> {
    return this.getWholeNumberInRange(
      ConfigKey.OFFER_TIMING_CANDIDATES,
      DEFAULT_OFFER_TIMING_CANDIDATES,
      OFFER_TIMING_CANDIDATES_MIN,
      OFFER_TIMING_CANDIDATES_MAX
    )
  }

  async getOfferExpirySeconds(): Promise<number> {
    return this.getWholeNumberInRange(
      ConfigKey.OFFER_EXPIRY_SECONDS,
      DEFAULT_OFFER_EXPIRY_SECONDS,
      OFFER_EXPIRY_SECONDS_MIN,
      OFFER_EXPIRY_SECONDS_MAX
    )
  }

  async getNoCourierRetrySeconds(): Promise<number> {
    return this.getWholeNumberInRange(
      ConfigKey.NO_COURIER_RETRY_SECONDS,
      DEFAULT_NO_COURIER_RETRY_SECONDS,
      NO_COURIER_RETRY_SECONDS_MIN,
      NO_COURIER_RETRY_SECONDS_MAX
    )
  }

  async getSavedCustomerRetentionMonths(): Promise<number> {
    return this.getWholeNumberInRange(
      ConfigKey.SAVED_CUSTOMER_RETENTION_MONTHS,
      DEFAULT_SAVED_CUSTOMER_RETENTION_MONTHS,
      SAVED_CUSTOMER_RETENTION_MONTHS_MIN,
      SAVED_CUSTOMER_RETENTION_MONTHS_MAX
    )
  }

  // Spec 0020: how long after accepting a rider may hand an order back for free (0 = off). Read at
  // every accept, so a missing row (an instance seeded before row 71) is read quietly as the default;
  // a bad stored value still warns.
  async getHandBackSeconds(): Promise<number> {
    let value: string | number | boolean | null
    try {
      value = (await this.configRepository.getByKey(ConfigKey.HAND_BACK_SECONDS)).normalizedValue
    } catch (error) {
      if (error instanceof Error && isRecordNotFoundError(error)) {
        return DEFAULT_HAND_BACK_SECONDS
      }
      throw error
    }
    if (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= HAND_BACK_SECONDS_MIN &&
      value <= HAND_BACK_SECONDS_MAX
    ) {
      return value
    }
    this.logger.warn(
      `Invalid ${ConfigKey.HAND_BACK_SECONDS} in config (${String(value)}), using the default ${DEFAULT_HAND_BACK_SECONDS}`
    )
    return DEFAULT_HAND_BACK_SECONDS
  }

  // Row 144: minutes a rider who declined or missed an offer is skipped for that delivery. Read at every
  // decline and missed offer, so a missing row (an instance seeded before row 144, until a representative
  // saves it) is read quietly as the default, the 20 minutes it always was; a bad stored value still warns.
  async getOfferSkipMinutes(): Promise<number> {
    let value: string | number | boolean | null
    try {
      value = (await this.configRepository.getByKey(ConfigKey.OFFER_SKIP_MINUTES)).normalizedValue
    } catch (error) {
      if (error instanceof Error && isRecordNotFoundError(error)) {
        return DEFAULT_OFFER_SKIP_MINUTES
      }
      throw error
    }
    if (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= OFFER_SKIP_MINUTES_MIN &&
      value <= OFFER_SKIP_MINUTES_MAX
    ) {
      return value
    }
    this.logger.warn(
      `Invalid ${ConfigKey.OFFER_SKIP_MINUTES} in config (${String(value)}), using the default ${DEFAULT_OFFER_SKIP_MINUTES}`
    )
    return DEFAULT_OFFER_SKIP_MINUTES
  }

  // Spec 0021: metres from a stop that the rider's app counts as arrived (0 = detection off). Read by
  // every rider's app with the dispatch number, so a missing row (an instance seeded before row 19, until
  // a representative saves it) is read quietly as the default; a bad stored value still warns.
  async getArrivalRadiusMetres(): Promise<number> {
    let value: string | number | boolean | null
    try {
      value = (await this.configRepository.getByKey(ConfigKey.ARRIVAL_RADIUS_METRES)).normalizedValue
    } catch (error) {
      if (error instanceof Error && isRecordNotFoundError(error)) {
        return DEFAULT_ARRIVAL_RADIUS_METRES
      }
      throw error
    }
    if (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      (value === 0 || (value >= ARRIVAL_RADIUS_METRES_MIN && value <= ARRIVAL_RADIUS_METRES_MAX))
    ) {
      return value
    }
    this.logger.warn(
      `Invalid ${ConfigKey.ARRIVAL_RADIUS_METRES} in config (${String(value)}), using the default ${DEFAULT_ARRIVAL_RADIUS_METRES}`
    )
    return DEFAULT_ARRIVAL_RADIUS_METRES
  }

  // Spec 0017: how many days back a restaurant sees its ended orders (open ones always show). Read on
  // every partner list and order call, so a missing row (an instance seeded before row 28, until a
  // representative saves the card) is read quietly as the default; a bad stored value still warns.
  async getRestaurantHistoryDays(): Promise<number> {
    let value: string | number | boolean | null
    try {
      value = (await this.configRepository.getByKey(ConfigKey.RESTAURANT_HISTORY_DAYS)).normalizedValue
    } catch (error) {
      if (error instanceof Error && isRecordNotFoundError(error)) {
        return DEFAULT_RESTAURANT_HISTORY_DAYS
      }
      throw error
    }
    if (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= RESTAURANT_HISTORY_DAYS_MIN &&
      value <= RESTAURANT_HISTORY_DAYS_MAX
    ) {
      return value
    }
    this.logger.warn(
      `Invalid ${ConfigKey.RESTAURANT_HISTORY_DAYS} in config (${String(value)}), using the default ${DEFAULT_RESTAURANT_HISTORY_DAYS}`
    )
    return DEFAULT_RESTAURANT_HISTORY_DAYS
  }

  // SOS (spec 0022): how many days the points shared during an SOS are kept. Read quietly: the row is
  // missing until a representative saves it, and the daily retention job must not warn every day.
  async getSosLocationRetentionDays(): Promise<number> {
    let value: string | number | boolean | null
    try {
      value = (await this.configRepository.getByKey(ConfigKey.SOS_LOCATION_RETENTION_DAYS)).normalizedValue
    } catch (error) {
      if (error instanceof Error && isRecordNotFoundError(error)) {
        return DEFAULT_SOS_LOCATION_RETENTION_DAYS
      }
      throw error
    }
    if (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= SOS_LOCATION_RETENTION_DAYS_MIN &&
      value <= SOS_LOCATION_RETENTION_DAYS_MAX
    ) {
      return value
    }
    this.logger.warn(
      `Invalid ${ConfigKey.SOS_LOCATION_RETENTION_DAYS} in config (${String(value)}), using the default ${DEFAULT_SOS_LOCATION_RETENTION_DAYS}`
    )
    return DEFAULT_SOS_LOCATION_RETENTION_DAYS
  }

  // Chat (spec 0034, AC-18): days a chat message is kept.
  async getChatRetentionDays(): Promise<number> {
    return this.getWholeNumberInRange(
      ConfigKey.CHAT_RETENTION_DAYS,
      DEFAULT_CHAT_RETENTION_DAYS,
      CHAT_RETENTION_DAYS_MIN,
      CHAT_RETENTION_DAYS_MAX
    )
  }

  // Address notes (spec 0053, AC-6): days a courier note is kept without an upvote.
  async getAddressNoteRetentionDays(): Promise<number> {
    return this.getWholeNumberInRange(
      ConfigKey.ADDRESS_NOTE_RETENTION_DAYS,
      DEFAULT_ADDRESS_NOTE_RETENTION_DAYS,
      ADDRESS_NOTE_RETENTION_DAYS_MIN,
      ADDRESS_NOTE_RETENTION_DAYS_MAX
    )
  }

  // Review requests (spec 0038, AC-3): whole days a person has to answer a rider's request.
  async getReviewAnswerDays(): Promise<number> {
    return this.getWholeNumberInRange(
      ConfigKey.REVIEW_ANSWER_DAYS,
      DEFAULT_REVIEW_ANSWER_DAYS,
      REVIEW_ANSWER_DAYS_MIN,
      REVIEW_ANSWER_DAYS_MAX
    )
  }

  // Review requests (spec 0038, AC-7): the largest pay correction an answer may add, in cents.
  async getReviewCorrectionMaxCents(): Promise<number> {
    return this.getWholeNumberInRange(
      ConfigKey.REVIEW_CORRECTION_MAX_CENTS,
      DEFAULT_REVIEW_CORRECTION_MAX_CENTS,
      REVIEW_CORRECTION_MAX_CENTS_MIN,
      REVIEW_CORRECTION_MAX_CENTS_MAX
    )
  }

  // Chat (spec 0034, AC-13): the presets dispatch sees above its message box.
  async getChatQuickRepliesDispatch(): Promise<ChatPreset[]> {
    return this.getChatQuickReplies(ConfigKey.CHAT_QUICK_REPLIES_DISPATCH, DEFAULT_CHAT_QUICK_REPLIES_DISPATCH)
  }

  // Chat (spec 0034, AC-13): the presets a rider sees above their message box.
  async getChatQuickRepliesCourier(): Promise<ChatPreset[]> {
    return this.getChatQuickReplies(ConfigKey.CHAT_QUICK_REPLIES_COURIER, DEFAULT_CHAT_QUICK_REPLIES_COURIER)
  }

  // A missing row (an instance set up before row 111) reads quietly as the defaults, like the dispatch
  // line: riders read the presets every time they open the chat. A stored list that breaks the rule
  // can only come from a hand edit of the table, so it also falls back, with a warning.
  private async getChatQuickReplies(key: ConfigKey, fallback: ChatPreset[]): Promise<ChatPreset[]> {
    let value: unknown
    try {
      value = (await this.configRepository.getByKey(key)).normalizedValue
    } catch (error) {
      if (error instanceof Error && isRecordNotFoundError(error)) {
        return fallback.map((preset) => ({ ...preset }))
      }
      throw error
    }
    const replies = storedChatQuickReplies(value)
    if (replies === null) {
      this.logger.warn(`Invalid ${key} in config, using the default presets`)
      return fallback.map((preset) => ({ ...preset }))
    }
    return replies
  }

  // The co-op's dispatch line (row 72), or null when none is set. Saving already refuses
  // anything that is not a phone number, so a bad stored value means a hand edit of the table:
  // show no dispatch button rather than one that dials nonsense, and log it so it gets fixed.
  // A missing row is the normal state until a representative saves a number, so it is read
  // quietly: getConfigValueOrDefault would log "Missing variable" on every rider's read (row 72 review).
  async getDispatchPhoneNumber(): Promise<string | null> {
    let value: string | number | boolean | null
    try {
      value = (await this.configRepository.getByKey(ConfigKey.DISPATCH_PHONE_NUMBER)).normalizedValue
    } catch (error) {
      if (error instanceof Error && isRecordNotFoundError(error)) {
        return null
      }
      throw error
    }

    if (value === '' || value === null) {
      return null
    }
    if (typeof value === 'string' && normalizeDispatchPhoneNumber(value) === value) {
      return value
    }

    this.logger.warn(`Invalid ${ConfigKey.DISPATCH_PHONE_NUMBER} in config, showing riders no dispatch number`)
    return null
  }

  // Spec 0015: the stored cancellation rule, or null when none is stored (read quietly: no row is
  // the normal state, the fallback FULL_COMPENSATION then applies).
  async getStoredCancellationPayoutPolicy(): Promise<string | null> {
    try {
      const value = (await this.configRepository.getByKey(ConfigKey.CANCELLATION_PAYOUT_POLICY)).normalizedValue
      return typeof value === 'string' && value !== '' ? value : null
    } catch (error) {
      if (error instanceof Error && isRecordNotFoundError(error)) {
        return null
      }
      throw error
    }
  }

  // The rule in force: the stored key, or FULL_COMPENSATION. Whether it is on the menu is checked
  // when it is used (resolveCancellationPayout), so a broken row never stops a rider being paid.
  async getCancellationPayoutPolicy(): Promise<string> {
    return (await this.getStoredCancellationPayoutPolicy()) ?? FALLBACK_CANCELLATION_PAYOUT_POLICY
  }

  // Saving already refuses anything outside the range, so a bad stored value means someone edited
  // the table by hand. Rather than end offers after 0 s, retry in a tight loop or delete every saved
  // customer, use the default and log a warning so it gets fixed.
  private async getWholeNumberInRange(key: ConfigKey, fallback: number, min: number, max: number): Promise<number> {
    const stored = await this.getConfigValueOrDefault(key, fallback)
    const value = stored.value

    if (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max) {
      return value
    }

    this.logger.warn(`Invalid ${key} in config (${String(value)}), using the default ${fallback}`)
    return fallback
  }

  async getConfigValueOrDefault(
    key: ConfigKey,
    fallback: any
  ): Promise<{
    value: string | number | boolean | null
  }> {
    try {
      const config = await this.configRepository.getByKey(key)

      return {
        value: config.normalizedValue,
      }
    } catch (error) {
      if (error instanceof Error && isRecordNotFoundError(error)) {
        this.logger.warn(`Missing variable '${key}' in config table.`)
        if (typeof fallback === 'function') {
          return {
            value: fallback(),
          }
        }

        return {
          value: fallback,
        }
      }
      throw error
    }
  }
}
