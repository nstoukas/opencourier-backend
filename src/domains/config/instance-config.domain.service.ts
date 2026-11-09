import { Injectable, Logger, BadRequestException } from '@nestjs/common'
import { ConfigRepository } from '../../persistence/repositories/config.repository'
import { isRecordNotFoundError } from 'src/prisma.util'
import {
  DEFAULT_COURIER_COMPENSATION_CALCULATION_TYPE,
  DEFAULT_COURIER_MATCHER_TYPE,
  DEFAULT_CURRENCY,
  DEFAULT_DELIVERY_DURATION_CALCULATION_TYPE,
  DEFAULT_DISTANCE_UNIT,
  DEFAULT_FEE_PERCENTAGE_AMOUNT,
  DEFAULT_GEO_CALCULATION_TYPE,
  DEFAULT_MAX_ASSIGNMENT_DISTANCE,
  DEFAULT_QUOTE_BASE_FEE,
  DEFAULT_QUOTE_CALCULATION_TYPE,
  DEFAULT_QUOTE_RATE_PER_DISTANCE_UNIT,
  DEFAULT_QUOTE_TO_DELIVERY_CONVERSION_TYPE,
  DEFAULT_QUOTE_TO_DELIVERY_MAX_DISTANCE_DRIFT,
  DELIVERY_QUOTE_EXPIRATION_MINUTES,
  DEFAULT_OFFER_EXPIRY_ENABLED,
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
  DEFAULT_RESTAURANT_HISTORY_DAYS,
  RESTAURANT_HISTORY_DAYS_MIN,
  RESTAURANT_HISTORY_DAYS_MAX,
  DEFAULT_SOS_LOCATION_RETENTION_DAYS,
  SOS_LOCATION_RETENTION_DAYS_MIN,
  SOS_LOCATION_RETENTION_DAYS_MAX,
  DEFAULT_HAND_BACK_SECONDS,
  HAND_BACK_SECONDS_MIN,
  HAND_BACK_SECONDS_MAX,
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
    const quoteRatePerDistanceUnit = await this.getQuoteRatePerDistanceUnit()
    // A bad stored base fee must stop quoting (getQuoteBaseFee throws), but not this reader:
    // it feeds the admin settings page, where the value gets fixed, and the public metadata.
    // So here it reads as null, which the admin page shows as an empty box, and a warning is logged.
    // .catch() on a promise turns the error into a fallback value instead of failing the await.
    const quoteBaseFee = await this.getQuoteBaseFee().catch((error: Error) => {
      this.logger.warn(error.message)
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
    const offerTimingEnabled = await this.getOfferTimingEnabled()
    const offerLeadMinutes = await this.getOfferLeadMinutes()
    const offerTimingCandidates = await this.getOfferTimingCandidates()
    const savedCustomerRetentionMonths = await this.getSavedCustomerRetentionMonths()
    const restaurantHistoryDays = await this.getRestaurantHistoryDays()
    const handBackSeconds = await this.getHandBackSeconds()
    const sosLocationRetentionDays = await this.getSosLocationRetentionDays()
    const arrivalRadiusMetres = await this.getArrivalRadiusMetres()
    const shiftsEnabled = await this.getShiftsEnabled()
    const shiftDropNoticeHours = await this.getShiftDropNoticeHours()
    const dispatchPhoneNumber = await this.getDispatchPhoneNumber()
    const cancellationPayoutPolicy = await this.getCancellationPayoutPolicy()

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
      offerTimingEnabled,
      offerLeadMinutes,
      offerTimingCandidates,
      savedCustomerRetentionMonths,
      restaurantHistoryDays,
      handBackSeconds,
      sosLocationRetentionDays,
      arrivalRadiusMetres,
      shiftsEnabled,
      shiftDropNoticeHours,
      dispatchPhoneNumber,
      cancellationPayoutPolicy,
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

  async setInstanceConfigSettings(data: InstanceConfigSettingsInput): Promise<InstanceConfigSettings> {
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
    if (data.offerTimingEnabled !== undefined && typeof data.offerTimingEnabled !== 'boolean') {
      throw new BadRequestException('offerTimingEnabled must be a boolean')
    }
    if (data.offerExpiryEnabled !== undefined && typeof data.offerExpiryEnabled !== 'boolean') {
      throw new BadRequestException('offerExpiryEnabled must be true or false')
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

    // Phase 2 — write validated settings to the database repository.
    // Numeric settings use !== undefined, never `if (data.x)`: see NUMERIC_SETTING_RULES.
    if (data.courierMatcherType) {
      await this.configRepository.saveByKey(ConfigKey.COURIER_MATCHER_TYPE, data.courierMatcherType)
    }
    if (data.quoteCalculationType) {
      await this.configRepository.saveByKey(ConfigKey.QUOTE_CALCULATION_TYPE, data.quoteCalculationType)
    }
    if (data.geoCalculationType) {
      await this.configRepository.saveByKey(ConfigKey.GEO_CALCULATION_TYPE, data.geoCalculationType)
    }
    if (data.deliveryDurationCalculationType) {
      await this.configRepository.saveByKey(
        ConfigKey.DELIVERY_DURATION_CALCULATION_TYPE,
        data.deliveryDurationCalculationType
      )
    }
    if (data.courierCompensationCalculationType) {
      await this.configRepository.saveByKey(
        ConfigKey.COURIER_COMPENSATION_CALCULATION_TYPE,
        data.courierCompensationCalculationType
      )
    }
    if (data.maxAssignmentDistance !== undefined) {
      await this.configRepository.saveByKey(ConfigKey.MAX_ASSIGNMENT_DISTANCE, data.maxAssignmentDistance)
    }
    if (data.quoteExpirationMinutes !== undefined) {
      await this.configRepository.saveByKey(ConfigKey.QUOTE_EXPIRATION_MINUTES, data.quoteExpirationMinutes)
    }
    if (data.feePercentageAmount !== undefined) {
      await this.configRepository.saveByKey(ConfigKey.FEE_PERCENTAGE_AMOUNT, data.feePercentageAmount)
    }
    if (data.quoteRatePerDistanceUnit !== undefined) {
      await this.configRepository.saveByKey(ConfigKey.QUOTE_RATE_PER_DISTANCE_UNIT, data.quoteRatePerDistanceUnit)
    }
    if (data.quoteBaseFee !== undefined) {
      await this.configRepository.saveByKey(ConfigKey.QUOTE_BASE_FEE, data.quoteBaseFee)
    }

    if (data.defaultCourierPayRate !== undefined) {
      await this.configRepository.saveByKey(ConfigKey.DEFAULT_COURIER_PAY_RATE, data.defaultCourierPayRate)
    }
    if (data.defaultMaxWorkingHours !== undefined) {
      await this.configRepository.saveByKey(ConfigKey.DEFAULT_MAX_WORKING_HOURS, data.defaultMaxWorkingHours)
    }
    if (data.defaultDietaryRestrictions) {
      await this.configRepository.saveByKey(ConfigKey.DEFAULT_DIETARY_RESTRICTIONS, data.defaultDietaryRestrictions)
    }
    if (data.distanceUnit) {
      await this.configRepository.saveByKey(ConfigKey.DISTANCE_UNIT, data.distanceUnit)
    }
    if (data.currency) {
      await this.configRepository.saveByKey(ConfigKey.CURRENCY, data.currency)
    }
    if (data.maxDriftDistance !== undefined) {
      await this.configRepository.saveByKey(ConfigKey.MAX_DRIFT_DISTANCE, data.maxDriftDistance)
    }
    if (data.details) {
      await this.configRepository.saveByKey(ConfigKey.DETAILS, JSON.stringify(data.details))
    }
    if (data.registeredRegistries) {
      await this.configRepository.saveByKey(ConfigKey.REGISTERED_REGISTRIES, JSON.stringify(data.registeredRegistries))
    }

    if (data.reassignmentPayoutPolicies !== undefined) {
      await this.configRepository.saveByKey(
        ConfigKey.REASSIGNMENT_PAYOUT_POLICIES,
        JSON.stringify(data.reassignmentPayoutPolicies)
      )
    }
    if (data.reassignmentPayoutDefaultPolicy !== undefined) {
      await this.configRepository.saveByKey(
        ConfigKey.REASSIGNMENT_PAYOUT_DEFAULT_POLICY,
        data.reassignmentPayoutDefaultPolicy
      )
    }
    // !== undefined, never `if (data.offerExpiryEnabled)`: that would silently drop a `false`,
    // and switching expiry off is exactly the save that must never be lost.
    if (data.offerExpiryEnabled !== undefined) {
      await this.configRepository.saveByKey(ConfigKey.OFFER_EXPIRY_ENABLED, data.offerExpiryEnabled)
    }
    if (data.offerExpirySeconds !== undefined) {
      await this.configRepository.saveByKey(ConfigKey.OFFER_EXPIRY_SECONDS, data.offerExpirySeconds)
    }
    if (data.noCourierRetrySeconds !== undefined) {
      await this.configRepository.saveByKey(ConfigKey.NO_COURIER_RETRY_SECONDS, data.noCourierRetrySeconds)
    }
    if (data.offerTimingEnabled !== undefined) {
      await this.configRepository.saveByKey(ConfigKey.OFFER_TIMING_ENABLED, data.offerTimingEnabled)
    }
    if (data.offerLeadMinutes !== undefined) {
      await this.configRepository.saveByKey(ConfigKey.OFFER_LEAD_MINUTES, data.offerLeadMinutes)
    }
    if (data.offerTimingCandidates !== undefined) {
      await this.configRepository.saveByKey(ConfigKey.OFFER_TIMING_CANDIDATES, data.offerTimingCandidates)
    }
    if (data.savedCustomerRetentionMonths !== undefined) {
      await this.configRepository.saveByKey(
        ConfigKey.SAVED_CUSTOMER_RETENTION_MONTHS,
        data.savedCustomerRetentionMonths
      )
    }
    if (data.handBackSeconds !== undefined) {
      await this.configRepository.saveByKey(ConfigKey.HAND_BACK_SECONDS, data.handBackSeconds)
    }
    if (data.arrivalRadiusMetres !== undefined) {
      await this.configRepository.saveByKey(ConfigKey.ARRIVAL_RADIUS_METRES, data.arrivalRadiusMetres)
    }
    // !== undefined, so a `false` (Shifts off) is saved, not dropped (as for offerExpiryEnabled).
    if (data.shiftsEnabled !== undefined) {
      await this.configRepository.saveByKey(ConfigKey.SHIFTS_ENABLED, data.shiftsEnabled)
    }
    if (data.shiftDropNoticeHours !== undefined) {
      await this.configRepository.saveByKey(ConfigKey.SHIFT_DROP_NOTICE_HOURS, data.shiftDropNoticeHours)
    }
    if (data.restaurantHistoryDays !== undefined) {
      await this.configRepository.saveByKey(ConfigKey.RESTAURANT_HISTORY_DAYS, data.restaurantHistoryDays)
    }
    if (data.sosLocationRetentionDays !== undefined) {
      await this.configRepository.saveByKey(ConfigKey.SOS_LOCATION_RETENTION_DAYS, data.sosLocationRetentionDays)
    }

    if (data.cancellationPayoutPolicy !== undefined) {
      await this.configRepository.saveByKey(ConfigKey.CANCELLATION_PAYOUT_POLICY, data.cancellationPayoutPolicy)
    }

    // !== undefined, never a truthy check: '' is how a representative clears the number.
    if (dispatchPhoneNumber !== undefined) {
      await this.configRepository.saveByKey(ConfigKey.DISPATCH_PHONE_NUMBER, dispatchPhoneNumber)
    }

    // Update the updated_at timestamp whenever config is changed
    await this.configRepository.saveByKey(ConfigKey.UPDATED_AT, new Date().toISOString())

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
