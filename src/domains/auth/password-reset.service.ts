import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { DEFAULT_LANGUAGE, Language, translate } from 'src/localization/translate'
import { ConfigService } from '@nestjs/config'
import { EnumUserRole } from '@prisma/types'
import { createHmac, randomInt, timingSafeEqual } from 'crypto'
import { JWT_SECRET_KEY } from 'src/constants'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { CourierDomainService } from 'src/domains/courier/courier.domain.service'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import { UserDomainService } from 'src/domains/user/user.domain.service'
import * as errors from 'src/errors'
import { isRecordNotFoundError } from 'src/prisma.util'
import { CacheService } from 'src/services/cache/cache.service'
import { MailService } from 'src/services/mail/mail.service'
import { describeError } from 'src/utils/errorForLog'
import { PartnerRepository } from 'src/persistence/repositories/partner.repository'

// The sentences a rider reads (spec 0039, AC-11 and AC-12). One sentence for every bad code, so an
// answer never tells a wrong code from an unknown email.
export const RESET_CODE_REFUSED_MESSAGE = 'That code is wrong or has expired. Ask for a new one.'
export const RESET_PASSWORD_LENGTH_MESSAGE = 'The new password must be 8 to 72 characters.'
export const RESET_BY_EMAIL_OFF_MESSAGE = "Reset by email isn't set up yet. Ask the co-op to set a new password."

// The limits of AC-8 and AC-11. Constants, not co-op settings: they protect accounts, not pay.
export const RESET_CODE_TTL_SECONDS = 900 // a code works for 15 minutes
export const RESET_RESEND_WAIT_SECONDS = 60 // one code per minute per account
export const RESET_CODES_PER_HOUR = 5
export const RESET_TRIES_PER_CODE = 5
// Decision 17.21: at most 10 tries per account per day, whatever the number of codes, so a patient
// guesser gets about 3650 guesses a year out of a million codes instead of about 219000.
export const RESET_TRIES_PER_DAY = 10
const HOUR_SECONDS = 3600
const DAY_SECONDS = 86400

// The Redis keys of spec 0039's data model table. Each holds one account's state, by user id.
export const resetKeys = (userId: string) => ({
  code: `password-reset:${userId}`,
  tries: `password-reset-tries:${userId}`,
  wait: `password-reset-wait:${userId}`,
  count: `password-reset-count:${userId}`,
  dayTries: `password-reset-day-tries:${userId}`,
})

// What is stored for a pending code: never the code itself, only its keyed hash.
interface PendingCode {
  codeHash: string
}

// A rider the reset may act on: a COURIER login that is not also an ADMIN, with a Courier row.
export interface ResetRider {
  user: UserEntity
  courier: CourierEntity
}

// Row 153: a restaurant the reset may act on: a PARTNER login that is not also an ADMIN, with a Partner row.
export interface ResetRestaurant {
  user: UserEntity
  partnerId: string
}

// Rider password reset by an emailed 6 digit code (row 17, spec 0039): making, mailing and checking
// codes, and the guards around them. No HTTP and no cut off: the courier auth REST service calls this,
// then saves the password and cuts the old phones off.
//
// Every guard is one atomic Redis command (CacheService's setIfAbsent, increment, take), so parallel
// requests from any number of addresses cannot pass one twice.
// `@Injectable()` lets NestJS build this class and hand it the services in its constructor (DI).
@Injectable()
export class PasswordResetService implements OnModuleInit {
  private readonly logger = new Logger(PasswordResetService.name)
  private hmacKey = ''

  constructor(
    private readonly cacheService: CacheService,
    private readonly mailService: MailService,
    private readonly userDomainService: UserDomainService,
    private readonly courierDomainService: CourierDomainService,
    private readonly configDomainService: ConfigDomainService,
    private readonly configService: ConfigService,
    // Row 153: finds a restaurant's Partner row. Optional only so tests that build this service by hand keep
    // compiling; Nest injects it, and without it no restaurant is ever found (the rider reset is unchanged).
    private readonly partnerRepository?: PartnerRepository
  ) {}

  onModuleInit() {
    this.hmacKey = this.configService.get<string>(JWT_SECRET_KEY) ?? ''
    if (!this.hmacKey) {
      // Without the key there is nothing to hash codes with, so the reset is off (AC-12).
      this.logger.log(`Mail is off: ${JWT_SECRET_KEY} is empty, so reset codes cannot be made`)
    }
  }

  // AC-12: false means "forgot password" answers 503 before it looks anything up.
  isAvailable(): boolean {
    return this.mailService.isConfigured() && this.hmacKey !== ''
  }

  // AC-7: the rider an email belongs to, or null. Looked up as typed first, then trimmed and lower
  // cased, by the same rule as loginWithEmail (the second form only when no account has the first).
  async findRider(email: string): Promise<ResetRider | null> {
    const user = await this.findUserByEmail(email)
    if (!user) return null
    // Riders only (decision 17.14): this route never changes an admin's or a restaurant's password.
    if (!user.role.includes(EnumUserRole.COURIER) || user.role.includes(EnumUserRole.ADMIN)) return null
    // getByUserId throws when the login has no Courier row (a dev script account): no rider then.
    let courier: CourierEntity
    try {
      courier = await this.courierDomainService.getByUserId(user.id)
    } catch (error) {
      if (error instanceof Error && isRecordNotFoundError(error)) return null
      throw error
    }
    // Spec 0051 (cross check 2): a deactivated rider gets no code, the same silent 202 as an unknown email.
    if (courier.deactivatedAt) return null
    return { user, courier }
  }

  // Row 153: the restaurant an email belongs to, or null: a PARTNER login, never an ADMIN's (the reset never
  // changes an admin's password), with a Partner row. Restaurants have no deactivation.
  async findRestaurant(email: string): Promise<ResetRestaurant | null> {
    const user = await this.findUserByEmail(email)
    if (!user || !this.partnerRepository) return null
    if (!user.role.includes(EnumUserRole.PARTNER) || user.role.includes(EnumUserRole.ADMIN)) return null
    const partner = await this.partnerRepository.findByUserId(user.id)
    return partner ? { user, partnerId: partner.id } : null
  }

  // The login an email belongs to, looked up as typed first, then trimmed and lower cased, by the same rule as
  // loginWithEmail (the second form only when no account has the first). Null without a stored email.
  private async findUserByEmail(email: string): Promise<UserEntity | null> {
    let user = await this.userDomainService.findUserWithEmail(email)
    const normalised = email.trim().toLowerCase()
    if (!user && normalised !== email) {
      user = await this.userDomainService.findUserWithEmail(normalised)
    }
    return user && user.email ? user : null
  }

  // The work behind "forgot password", run after the 202 has been sent (AC-7). Finds the rider, passes
  // the two guards (AC-8), stores a new code and mails it (AC-9). Every refusal is silent: the answer
  // already went out, and it was the same whatever happens here.
  async sendCodeIfRider(email: string): Promise<void> {
    await this.sendCodeTo(await this.findRider(email))
  }

  // Row 153: the same for a restaurant, from request-web's sign in card. Same limits, same mail.
  async sendCodeIfRestaurant(email: string): Promise<void> {
    await this.sendCodeTo(await this.findRestaurant(email))
  }

  private async sendCodeTo(account: { user: UserEntity } | null): Promise<void> {
    if (!account) return
    try {
      await this.makeAndSendCode(account)
    } catch (error) {
      // Redis or the settings failed. The user id and the kind of error, never its message (AC-13).
      this.logger.error(`Password reset for user ${account.user.id} failed: ${describeError(error)}`)
    }
  }

  private async makeAndSendCode(account: { user: UserEntity }): Promise<void> {
    const userId = account.user.id
    const keys = resetKeys(userId)

    // One code a minute: of two requests at once, only the one that sets this key goes on.
    if (!(await this.cacheService.setIfAbsent(keys.wait, 1, RESET_RESEND_WAIT_SECONDS))) return
    // At most five codes an hour, counted from the first.
    if ((await this.cacheService.increment(keys.count, HOUR_SECONDS)) > RESET_CODES_PER_HOUR) return

    const code = this.makeCode()
    // A new code replaces the old one and gets its own five tries. The old count goes first: a try
    // landing in between then counts against the new code (1 of 5) instead of finding the old count
    // past five and deleting the code just saved. The day's count is never reset (decision 17.21).
    await this.cacheService.delete(keys.tries)
    await this.cacheService.save<PendingCode>(
      keys.code,
      { codeHash: this.hashCode(userId, code) },
      RESET_CODE_TTL_SECONDS
    )

    // getDetails returns the stored JSON unchecked, so `name` can be missing although its type says
    // string; `as string | undefined` widens the type to what can really arrive. Missing, the email
    // says "the co-op" (AC-9) instead of failing.
    const storedName = (await this.configDomainService.instanceConfig.getDetails()).name as string | undefined
    const name = (storedName ?? '').trim()
    try {
      // Sent to the stored address, never the typed one (they can differ in capitals).
      await this.mailService.send({
        to: account.user.email as string,
        ...buildResetEmail(code, name, account.user.language),
      })
    } catch (error) {
      // AC-12 and AC-13: the user id and what kind of failure, never the error's message, which can
      // quote the recipient's address. The rider can ask again after the minute's wait.
      this.logger.error(`Could not send a password reset code to user ${userId}: ${describeError(error)}`)
      return
    }
    this.logger.log(`Password reset code sent to user ${userId}`)
  }

  // AC-10 and AC-11: checks a code and, on a match, claims it so it works once. Returns the rider, or
  // throws the one code sentence. The caller has already refused a malformed email, code or password,
  // so none of those spends a try.
  async claimCode(email: string, code: string): Promise<ResetRider> {
    return this.claimFor(await this.findRider(email), code)
  }

  // Row 153: the same check for a restaurant's code.
  async claimRestaurantCode(email: string, code: string): Promise<ResetRestaurant> {
    return this.claimFor(await this.findRestaurant(email), code)
  }

  // `<T extends { user: UserEntity }>`: whichever account type comes in (a rider, a restaurant) goes back out,
  // and all this needs from it is its login.
  private async claimFor<T extends { user: UserEntity }>(account: T | null, code: string): Promise<T> {
    if (!account) throw new errors.BadRequestException(RESET_CODE_REFUSED_MESSAGE)
    const userId = account.user.id
    const keys = resetKeys(userId)

    // The try is counted before comparing, against this code (5) and against the day (10, decision
    // 17.21); past either limit the code is gone and nothing is compared.
    const triesOnCode = await this.cacheService.increment(keys.tries, RESET_CODE_TTL_SECONDS)
    const triesToday = await this.cacheService.increment(keys.dayTries, DAY_SECONDS)
    if (triesOnCode > RESET_TRIES_PER_CODE || triesToday > RESET_TRIES_PER_DAY) {
      await this.cacheService.delete(keys.code)
      throw new errors.BadRequestException(RESET_CODE_REFUSED_MESSAGE)
    }

    const expected = this.hashCode(userId, code)
    const pending = await this.cacheService.get<PendingCode>(keys.code)
    if (!pending || !hashesMatch(pending.codeHash, expected)) {
      throw new errors.BadRequestException(RESET_CODE_REFUSED_MESSAGE)
    }

    // Claimed with GETDEL: of two right answers at once, only one gets the code back. If a new code
    // replaced it between the read and the claim, the claimed hash no longer matches and this refuses;
    // that new code is gone too (GETDEL removed it), so the rider asks again after the minute's wait.
    const claimed = await this.cacheService.take<PendingCode>(keys.code)
    if (!claimed || !hashesMatch(claimed.codeHash, expected)) {
      throw new errors.BadRequestException(RESET_CODE_REFUSED_MESSAGE)
    }
    await this.cacheService.delete(keys.tries)
    return account
  }

  // Six digits from the crypto random source, leading zeros kept ("004219").
  private makeCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0')
  }

  // HMAC SHA-256 of "<userId>:<code>", keyed with the JWT secret (AC-8): a Redis dump alone cannot
  // be turned back into codes, and the user id stops one hash from matching another account.
  private hashCode(userId: string, code: string): string {
    return createHmac('sha256', this.hmacKey).update(`${userId}:${code}`).digest('hex')
  }
}

// Constant time comparison (AC-11): how long it takes never tells how much of the code was right.
// Both are hex SHA-256 digests; a stored value of another length simply does not match.
function hashesMatch(stored: string, expected: string): boolean {
  const a = Buffer.from(stored, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

// AC-9: the reset email in both languages, the rider's own first (spec 0054, cross check 8: User.language;
// Greek first when they never chose). Both stay, because a rider who forgot a password may also have a
// phone in the other language. The words are in src/localization (server.mail). The code is never in the
// subject (it shows on lock screens and in mail lists).
export function buildResetEmail(
  code: string,
  coopName: string,
  language: Language = DEFAULT_LANGUAGE
): { subject: string; text: string; html: string } {
  const other: Language = language === 'el' ? 'en' : 'el'
  const subjectIn = (lang: Language) =>
    translate(lang, 'server.mail.resetSubject', { coop: coopName || translate(lang, 'server.mail.coopFallback') })
  const subject = `${subjectIn(language)} / ${subjectIn(other)}`
  const first = translate(language, 'server.mail.resetBody')
  const second = translate(other, 'server.mail.resetBody')

  const text = `${code}\n\n${first}\n\n${second}\n`
  // The code in large type first (AC-9), then the two sentences. Only fixed text goes in the HTML.
  const html =
    '<div style="font-family: sans-serif; font-size: 16px; line-height: 1.5">' +
    `<p style="font-size: 32px; font-weight: bold; letter-spacing: 6px; margin: 0 0 24px">${code}</p>` +
    `<p>${escapeHtml(first)}</p>` +
    `<p>${escapeHtml(second)}</p>` +
    '</div>'
  return { subject, text, html }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
