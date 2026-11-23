import { EnumCourierMatcherType } from 'src/shared-types/courier-matching'
import { EnumAddOnMoment, EnumTwoOrderPolicy } from 'src/shared-types/stacking'
import { Injectable } from '@nestjs/common'
import { PaginatedResult } from 'src/core/models/Pagination'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { RemovalRequestRepository } from 'src/persistence/repositories/removal-request.repository'
import { SettingChangeRepository, SettingChangeWithAdmin } from 'src/persistence/repositories/setting-change.repository'
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
import { RIDER_REACH_MONTHS } from 'src/services/time-worked/time-worked.service'

// The "How offers and pay work" page (spec 0038, AC-11): plain sentences built from the settings in
// effect at the moment it is asked for, so it can never go stale. The sentences are fixed text tied
// to how the code behaves: a change to a matcher or to the pay formula must update its sentence here
// in the same change.
export type HowItWorks = {
  offers: string[]
  pay: string[]
  personDecides: string[]
  appRecords: string[]
  // Spec 0040 (AC-13): how time worked is counted, and who can see it.
  timeWorked: string[]
  // Spec 0042 (AC-14): how the Earnings figures are counted, and who can see them.
  earningsFigures: string[]
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

// Spec 0044 (rows 12 and 13): the fairness matcher, worded from the live settings, so a change the
// assembly votes shows here at once. Tips never count (cross check 1).
export function fairnessSentences(
  settings: {
    fairnessWeightRoadTime: number
    fairnessWeightEarnings: number
    fairnessWeightWaiting: number
    fairnessCandidateLimit: number
    fairnessMinOnlineMinutes: number
    // Spec 0049: the shift factor is worded only while shifts are on.
    shiftsEnabled?: boolean
    fairnessWeightShift?: number
  },
  distance: string
): string[] {
  // Spec 0049 (cross check 6): the shift factor is a fixed yes or no, so its weight moves a rider's place
  // by the same amount every time, unlike the other three.
  const shift = settings.shiftsEnabled
    ? [
        `While shifts are on, being on a booked shift counts too (weight ${settings.fairnessWeightShift ?? 0}). It is a fixed yes or no, so it moves your place by the same amount every time, while the other three depend on how different the riders are. Going Offline during a booked shift is written on that shift, for you and a representative to see; it changes nothing about your offers or pay.`,
      ]
    : []
  return [
    `Each order is offered among the ${settings.fairnessCandidateLimit} nearest free riders who are Online or on Last Call, within ${distance} of the restaurant.`,
    `Among them, the co-op weighs three things: road time to the restaurant (weight ${settings.fairnessWeightRoadTime}), what the co-op has paid you per hour online today (weight ${settings.fairnessWeightEarnings}, the less you have earned, the sooner you are offered), and how long you have waited since your last job (weight ${settings.fairnessWeightWaiting}, the longer, the sooner).`,
    `Until you have been online ${settings.fairnessMinOnlineMinutes} minutes today, your pay per hour counts as the co-op's average. Tips never affect who gets offers, and the day starts again at midnight.`,
    ...shift,
    'Each offer records the figures that chose its rider. See why a job came to you on its page in Earnings.',
  ]
}

export const PERSON_DECIDES = [
  'A person decides every removal from an order, every reassignment, every dispatch stop for heat or storms, every change to your account, every deactivation of an account and every answer to a review request.',
  'The app never ends or limits your account on its own.',
]

export const APP_RECORDS = [
  'Your position is stored only while you are Online or on a job, and it is erased when you go Offline.',
  // Spec 0044 (decision 12.4): the fairness matcher compares riders for each offer, so this says how.
  'There are no ratings and no running score about you. Riders are compared only to choose who gets each offer, by what the offer rules above say, never by behaviour; each offer keeps the figures it used.',
  'Every step that affects an offer or your pay is written on that delivery’s record, which a representative can show you.',
]

// Spec 0053 (AC-6, cross check 10): the address note rules, with the co-op's retention period.
export function addressNotesSentence(retentionDays: number): string {
  return `Address notes describe the place, never the person, and show without their author. A note no rider upvotes for ${retentionDays} days (${aboutMonths(
    retentionDays
  )}) is deleted on its own; any rider can flag a note and an admin can delete it.`
}

// "about 6 months" for 182 days; whole months, at least one.
export function aboutMonths(days: number): string {
  const months = Math.max(1, Math.round(days / 30.44))
  return `about ${months} ${months === 1 ? 'month' : 'months'}`
}

// Spec 0040 (AC-13): who sees a rider's time worked, and why. Fixed text, tied to AC-15 and AC-16.
export const TIME_WORKED_ADMIN_VIEW =
  'Admins can see your time worked on your own page, to answer your questions and review requests. No one ranks riders by it. When the co-op uses the fairness offer rules, today’s pay per hour is compared for each offer, so that work goes first to whoever has earned least; the co-op totals never name a rider.'

// Spec 0040 (AC-13): the time worked sentences, from the live break setting.
export function timeWorkedSentences(shiftBreakMinutes: number): string[] {
  return [
    'Your time worked runs from when you go Online until you go Offline, and keeps going while you still hold a job.',
    shiftBreakMinutes > 0
      ? `An Offline shorter than ${shiftBreakMinutes} minutes is a break inside the same shift: it is marked "Break" and is not counted as time worked. ${shiftBreakMinutes} minutes or longer ends the shift.`
      : 'Every Offline with no job ends the shift.',
    'Each shift is split into job time (from accepting a job until it ends), paid waiting at restaurants, and unpaid time (Online with no job).',
    'The money of a shift is the pay of each job you accepted in it, with any pay added later, such as a review correction.',
    'Day totals reset at midnight. A shift that crosses midnight stays one shift.',
    TIME_WORKED_ADMIN_VIEW,
  ]
}

// Spec 0042 (AC-14): the Earnings figures, one sentence each, the day rule, the reach and who sees
// them. Fixed text tied to summarisePeriod (period-figures.ts) and TimeWorkedService.riderMonth: a
// change to how a figure is counted must update its sentence here in the same change.
export function earningsFigureSentences(): string[] {
  return [
    '€ per hour worked is the money of a day or week divided by its time worked.',
    '€ per hour on a job is the same money divided by your job time plus your paid waiting.',
    '€ per paid km is the money of the jobs you delivered divided by their km from the restaurant to the customer. The ride to the restaurant is not in it.',
    'The pickup wait is the typical time from arriving at a restaurant to picking up the food: the middle value of that period’s waits.',
    'A job’s money counts on the day you accepted it, in Greek time, even when you deliver it after midnight. Pay added later, such as a review correction, counts on its job’s day too.',
    `You can open your work from the last ${RIDER_REACH_MONTHS} months. For older work, ask the co-op.`,
    'Admins can see these figures and your jobs on your own page. No one ranks or compares riders by them.',
  ]
}

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
    const distance = `${settings.maxAssignmentDistance} ${unit}`
    const offers = [
      ...(settings.courierMatcherType === EnumCourierMatcherType.FAIRNESS
        ? fairnessSentences(settings, distance)
        : // Review fix (AC-4): every matcher records why; the link back is not the fairness matcher's alone.
          [matcher(distance), 'See why a job came to you on its page in Earnings.']),
      'A rider already on a job gets no second offer.',
      settings.offerExpiryEnabled
        ? `You have ${settings.offerExpirySeconds} seconds to answer an offer; then it goes to the next rider.`
        : 'An offer waits for your answer until you accept or decline it.',
      `If you decline or miss an offer, that order is not offered to you again for ${Math.round(
        REJECTED_LIST_TTL_SECONDS / 60
      )} minutes.`,
    ]
    if (settings.offerTimingEnabled) {
      offers.push(
        `Offers go out about ${settings.offerLeadMinutes} minutes before the restaurant says the food is ready.`
      )
    }
    // Spec 0048 (AC-1): stacked orders, said only while the co-op has them on. Decision 128.0: auto accept takes a pair.
    if (settings.stackingEnabled) {
      offers.push(
        `Two orders may be offered to you together: two from the same restaurant, or one each from two restaurants once both have marked the food ready. This happens ${
          settings.twoOrderPolicy === EnumTwoOrderPolicy.WHENEVER_FITS
            ? 'whenever the two fit'
            : 'only when one of them found no free rider'
        }. You take or decline both at once, and with auto accept on your phone takes a pair just as it takes a single order. Each order pays in full, exactly as it would alone. Neither customer's food arrives more than ${
          settings.twoOrderDelayLimitMinutes
        } minutes later than it would alone, and both orders always fit in your box.`
      )
    }
    // Spec 0048 (AC-1, row 81): mid job add ons, said only while the co-op has them on. Cross check 2: the
    // rider reads that an add on is answered only when stopped, and that one offered with food in the box
    // never rings insistently and gets twice the usual time. Review fixes: WHENEVER_FITS says plainly that an
    // add on can come while a free rider is available, and the add on's own deadline (decision 81.14) is
    // given in seconds, since it applies whether Offer expiry is on or off. Not said while dispatch chooses
    // every rider by hand (STATIC), when no add on is ever offered (review fix, the locked override).
    if (settings.addOnOffersEnabled && settings.courierMatcherType !== EnumCourierMatcherType.STATIC) {
      const moment =
        settings.addOnMoment === EnumAddOnMoment.BEFORE_DROPOFF
          ? 'any time before you drop off your current order'
          : settings.addOnMoment === EnumAddOnMoment.SAME_RESTAURANT
            ? 'before you pick up your current order, and only from the same restaurant'
            : 'before you pick up your current order'
      offers.push(
        `While you are on a job, you may be offered one more order on the way, ${moment}. This happens ${
          settings.twoOrderPolicy === EnumTwoOrderPolicy.WHENEVER_FITS
            ? 'whenever it fits, even when a free rider is available'
            : 'only when that order found no free rider'
        }. The offer shows how many km and minutes it adds. Declining it is free and changes nothing about your current order, and it is never accepted automatically. It pays in full, exactly as it would alone, your current customer's food arrives at most ${
          settings.twoOrderDelayLimitMinutes
        } minutes later, and both orders always fit in your box. Answer an add on only when you are stopped. You have ${
          settings.offerExpirySeconds
        } seconds to answer one; while you carry food you have ${
          settings.offerExpirySeconds * 2
        } seconds and it never rings insistently. An unanswered add on goes back to matching.`
      )
    }

    const paid = reasons.filter((reason) => reason.paidToRider).map((reason) => reason.label)
    const unpaid = reasons.filter((reason) => !reason.paidToRider).map((reason) => reason.label)
    const pay = [
      `Each delivery pays a base of ${money(settings.quoteBaseFee)} plus ${money(
        settings.quoteRatePerDistanceUnit
      )} per ${unit} of the route from the restaurant to the customer. The amount is fixed when the order is placed.`,
      settings.waitPayEnabled && settings.waitPayCentsPerMinute > 0
        ? `If a restaurant keeps you waiting past the time it promised, the first ${
            settings.waitPayFreeMinutes
          } minutes are not paid, then each minute pays ${money(settings.waitPayCentsPerMinute)}.`
        : 'Waiting at a restaurant is not paid at the moment.',
      `You may leave a restaurant that is ${settings.waitLimitMinutes} minutes late.`,
      `If an order does not fit one box, tell dispatch from the restaurant: you are paid while you wait for the split, and may leave after ${settings.splitAnswerMinutes} minutes without an answer.`,
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
      appRecords: [...APP_RECORDS, addressNotesSentence(settings.addressNoteRetentionDays)],
      timeWorked: timeWorkedSentences(settings.shiftBreakMinutes),
      earningsFigures: earningsFigureSentences(),
      reviewAnswerDays: settings.reviewAnswerDays,
    }
  }

  // AC-13: the rider facing changes, newest first. Credited to "a representative" by the app, never
  // to a person. A removal reason edit that changed only what the restaurant pays reads the same to a
  // rider on both sides, so it is left out of the page.
  async riderChanges(options: { page?: number; perPage?: number }): Promise<PaginatedResult<RiderSettingChange>> {
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
        changedBy: change.changedBy ? change.changedBy.email ?? change.changedBy.username ?? change.changedBy.id : null,
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
