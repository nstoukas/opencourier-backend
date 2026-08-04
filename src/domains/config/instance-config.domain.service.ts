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
  DEFAULT_QUOTE_CALCULATION_TYPE,
  DEFAULT_QUOTE_RATE_PER_DISTANCE_UNIT,
  DEFAULT_QUOTE_TO_DELIVERY_CONVERSION_TYPE,
  DEFAULT_QUOTE_TO_DELIVERY_MAX_DISTANCE_DRIFT,
  DELIVERY_QUOTE_EXPIRATION_MINUTES,
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
} from 'src/shared-types/index'
import { ConfigService } from '@nestjs/config'
import { ConfigKey } from 'src/shared-types/index'
import { InstanceConfigSettingsInput } from 'src/rest-api/config/admin/queries/instance-config-settings.input'

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
    const distanceUnit = await this.getDistanceUnit()
    const currency = await this.getCurrency()
    const details = await this.getDetails()
    const updatedAt = await this.getUpdatedAt()
    const registeredRegistries = await this.getRegisteredRegistries()
    const reassignmentPayoutPolicies = await this.getReassignmentPayoutPolicies()
    const reassignmentPayoutDefaultPolicy = await this.getReassignmentPayoutDefaultPolicy()

    // Instance courier defaults
    const defaultCourierPayRate = await this.getDefaultCourierPayRate()
    const defaultMinimumCourierPay = await this.getDefaultMinimumCourierPay()
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
      defaultCourierPayRate,
      defaultMinimumCourierPay,
      defaultMaxWorkingHours,
      defaultDietaryRestrictions,
      distanceUnit,
      currency,
      details,
      updatedAt,
      registeredRegistries,
      reassignmentPayoutPolicies,
      reassignmentPayoutDefaultPolicy,
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

    // Phase 2 — write validated settings to the database repository.
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
    if (data.maxAssignmentDistance) {
      await this.configRepository.saveByKey(ConfigKey.MAX_ASSIGNMENT_DISTANCE, data.maxAssignmentDistance)
    }
    if (data.quoteExpirationMinutes) {
      await this.configRepository.saveByKey(ConfigKey.QUOTE_EXPIRATION_MINUTES, data.quoteExpirationMinutes)
    }
    if (data.feePercentageAmount) {
      await this.configRepository.saveByKey(ConfigKey.FEE_PERCENTAGE_AMOUNT, data.feePercentageAmount)
    }
    // !== undefined, not a truthy check: 0 is a legitimate voted rate (a flat minimum with no
    // distance component), and `if (data.x)` would silently discard it.
    if (data.quoteRatePerDistanceUnit !== undefined) {
      await this.configRepository.saveByKey(ConfigKey.QUOTE_RATE_PER_DISTANCE_UNIT, data.quoteRatePerDistanceUnit)
    }

    if (data.defaultCourierPayRate) {
      await this.configRepository.saveByKey(ConfigKey.DEFAULT_COURIER_PAY_RATE, data.defaultCourierPayRate)
    }
    // !== undefined, not a truthy check: 0 is a legitimate voted floor (no floor), and `if (data.x)` would silently discard it.
    if (data.defaultMinimumCourierPay !== undefined) {
      await this.configRepository.saveByKey(ConfigKey.DEFAULT_MINIMUM_COURIER_PAY, data.defaultMinimumCourierPay)
    }
    if (data.defaultMaxWorkingHours) {
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
    if (data.maxDriftDistance) {
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

  async getDefaultMinimumCourierPay(): Promise<number | null> {
    const defaultMinimumCourierPay = await this.getConfigValueOrDefault(ConfigKey.DEFAULT_MINIMUM_COURIER_PAY, null)

    return typeof defaultMinimumCourierPay.value === 'string'
      ? Number(defaultMinimumCourierPay.value)
      : (defaultMinimumCourierPay.value as number)
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
