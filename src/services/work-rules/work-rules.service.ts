import { Injectable } from '@nestjs/common'
import { PaginatedResult } from 'src/core/models/Pagination'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { RemovalRequestRepository } from 'src/persistence/repositories/removal-request.repository'
import {
  SettingChangeRepository,
  SettingChangeWithAdmin,
} from 'src/persistence/repositories/setting-change.repository'
import { REJECTED_LIST_TTL_SECONDS } from 'src/services/cache/rejected-couriers'
import { InstanceConfigSettings } from 'src/shared-types/config'
import {
  RIDER_FACING_SETTINGS,
  RIDER_FACING_SETTING_KEYS,
  SettingFormatContext,
  distanceUnitName,
  formatCents,
  policyName,
} from 'src/shared-types/rider-facing-settings'

// The "How offers and pay work" page (spec 0038, AC-11): plain sentences built from the settings in
// effect at the moment it is asked for, so it can never go stale. The sentences are fixed text tied
// to how the code behaves: a change to a matcher or to the pay formula must update its sentence here
// in the same change.
export type HowItWorks = {
  offers: string[]
  pay: string[]
  personDecides: string[]
  appRecords: string[]
  reviewAnswerDays: number
}

// One line of the rider's "What changed" list (AC-13). Never names a person.
export type RiderSettingChange = { at: Date; label: string; oldText: string; newText: string }

// One line of the admin's Change history (AC-13), with the person who saved it.
export type AdminSettingChange = {
  id: string
  at: Date
  key: string
  label: string
  subject: string | null
  oldValue: unknown
  newValue: unknown
  changedBy: string | null
}

const nearestSentence = (distance: string) =>
  `Each order is offered to the nearest free rider who is Online or on Last Call, within ${distance} of the restaurant.`

// Checked against the matchers' queries (courier.repository.ts): both offer only to riders who are
// Online or on Last Call, hold no job and no open offer, have no active SOS, and are within the
// distance of the restaurant. STATIC is the admin's override.
const MATCHER_SENTENCES: Record<string, (distance: string) => string> = {
  NEAREST_COURIER: (distance) => nearestSentence(distance),
  COURIER_SENIORITY: (distance) =>
    `Each order is offered to the free rider, Online or on Last Call, whose account is the oldest, within ${distance} of the restaurant.`,
  STATIC: () => 'Dispatch chooses the rider for each order by hand.',
}

export const PERSON_DECIDES = [
  'A person decides every removal from an order, every reassignment, every dispatch stop for heat or storms, every change to your account and every answer to a review request.',
  'The app never ends or limits your account on its own.',
]

export const APP_RECORDS = [
  'Your position is stored only while you are Online or on a job, and it is erased when you go Offline.',
  'There are no ratings, and nothing is counted or ranked per rider.',
  'Every step that affects an offer or your pay is written on that delivery’s record, which a representative can show you.',
]

@Injectable()
export class WorkRulesService {
  constructor(
    private readonly configDomainService: ConfigDomainService,
    private readonly removalRequestRepository: RemovalRequestRepository,
    private readonly settingChangeRepository: SettingChangeRepository
  ) {}

  async howItWorks(): Promise<HowItWorks> {
    const settings = await this.configDomainService.instanceConfig.getInstanceConfigSettings()
    const reasons = await this.removalRequestRepository.findActiveReasons()
    const context = formatContext(settings)
    const unit = distanceUnitName(context.distanceUnit)
    const money = (cents: number | null) => formatCents(cents, context.currency)
    const percentOf = (policy: string) => settings.reassignmentPayoutPolicies[policy]
    const policy = (key: string) => {
      const percent = percentOf(key)
      return percent === undefined ? policyName(key) : `${policyName(key)} (${percent}% of its pay)`
    }

    const matcher = MATCHER_SENTENCES[settings.courierMatcherType] ?? nearestSentence
    const offers = [
      matcher(`${settings.maxAssignmentDistance} ${unit}`),
      'A rider already on a job gets no second offer.',
      settings.offerExpiryEnabled
        ? `You have ${settings.offerExpirySeconds} seconds to answer an offer; then it goes to the next rider.`
        : 'An offer waits for your answer until you accept or decline it.',
      `If you decline or miss an offer, that order is not offered to you again for ${Math.round(
        REJECTED_LIST_TTL_SECONDS / 60
      )} minutes.`,
    ]
    if (settings.offerTimingEnabled) {
      offers.push(`Offers go out about ${settings.offerLeadMinutes} minutes before the restaurant says the food is ready.`)
    }

    const paid = reasons.filter((reason) => reason.paidToRider).map((reason) => reason.label)
    const unpaid = reasons.filter((reason) => !reason.paidToRider).map((reason) => reason.label)
    const pay = [
      `Each delivery pays a base of ${money(settings.quoteBaseFee)} plus ${money(
        settings.quoteRatePerDistanceUnit
      )} per ${unit} of the route from the restaurant to the customer. The amount is fixed when the order is placed.`,
      settings.waitPayEnabled && settings.waitPayCentsPerMinute > 0
        ? `If a restaurant keeps you waiting past the time it promised, the first ${settings.waitPayFreeMinutes} minutes are not paid, then each minute pays ${money(settings.waitPayCentsPerMinute)}.`
        : 'Waiting at a restaurant is not paid at the moment.',
      `You may leave a restaurant that is ${settings.waitLimitMinutes} minutes late.`,
      `If a job you accepted is cancelled, you are paid ${policy(settings.cancellationPayoutPolicy)}.`,
      `If a job is taken off you, you are usually paid ${policy(settings.reassignmentPayoutDefaultPolicy)}.`,
      `Taking food back to the restaurant after a cancellation pays ${settings.returnTripPayPercent}% of the order's distance pay.`,
      settings.handBackSeconds > 0
        ? `You can give an accepted order back for free within ${settings.handBackSeconds} seconds.`
        : 'Giving an accepted order back for free is switched off.',
    ]
    if (paid.length > 0) pay.push(`Being taken off an order pays you for these reasons: ${paid.join(', ')}.`)
    if (unpaid.length > 0) pay.push(`These reasons do not pay: ${unpaid.join(', ')}.`)
    pay.push(
      `When a review finds your pay was wrong, a person can add up to ${money(
        settings.reviewCorrectionMaxCents
      )}. A review never lowers your pay.`
    )

    return {
      offers,
      pay,
      personDecides: PERSON_DECIDES,
      appRecords: APP_RECORDS,
      reviewAnswerDays: settings.reviewAnswerDays,
    }
  }

  // AC-13: the rider facing changes, newest first. Credited to "a representative" by the app, never
  // to a person. A removal reason edit that changed only what the restaurant pays reads the same to a
  // rider on both sides, so it is left out of the page.
  async riderChanges(options: {
    page?: number
    perPage?: number
  }): Promise<PaginatedResult<RiderSettingChange>> {
    const context = formatContext(await this.configDomainService.instanceConfig.getInstanceConfigSettings())
    const page = await this.settingChangeRepository.findPage({ ...options, keys: RIDER_FACING_SETTING_KEYS })
    const lines = page.data
      .map((change) => toRiderLine(change, context))
      .filter((line) => line.oldText !== line.newText)
    return { data: lines, pagination: page.pagination }
  }

  // AC-13: every change, with the person's login.
  async adminChanges(options: {
    page?: number
    perPage?: number
  }): Promise<PaginatedResult<AdminSettingChange> & { recordedSince: Date | null }> {
    const [page, oldest] = await Promise.all([
      this.settingChangeRepository.findPage(options),
      this.settingChangeRepository.findOldest(),
    ])
    return {
      data: page.data.map((change) => ({
        id: change.id,
        at: change.createdAt,
        key: change.key,
        label: RIDER_FACING_SETTINGS[change.key]?.label ?? change.key,
        subject: change.subject,
        oldValue: change.oldValue,
        newValue: change.newValue,
        changedBy: change.changedBy
          ? change.changedBy.email ?? change.changedBy.username ?? change.changedBy.id
          : null,
      })),
      pagination: page.pagination,
      recordedSince: oldest?.createdAt ?? null,
    }
  }
}

function formatContext(settings: InstanceConfigSettings): SettingFormatContext {
  return { distanceUnit: String(settings.distanceUnit), currency: String(settings.currency) }
}

function toRiderLine(change: SettingChangeWithAdmin, context: SettingFormatContext): RiderSettingChange {
  // The list is read by RIDER_FACING_SETTING_KEYS, so every row has an entry; the fallback is a guard.
  const setting = RIDER_FACING_SETTINGS[change.key] ?? { label: change.key, format: (value: unknown) => String(value) }
  return {
    at: change.createdAt,
    label: setting.label,
    oldText: setting.format(change.oldValue, context),
    newText: setting.format(change.newValue, context),
  }
}
