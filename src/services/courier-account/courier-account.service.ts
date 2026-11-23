import { describeErrorForLog, errorSummaryForLog } from 'src/utils/errorForLog'
import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common'
import { languageOf, translate } from 'src/localization/translate'
import {
  EnumCourierAccountChangeKind,
  EnumCourierDeliverySetting,
  EnumCourierStatus,
  EnumCourierStatusChangeCause,
  EnumUserRole,
} from '@prisma/types'
import * as errors from 'src/errors'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { AuthDomainService } from 'src/domains/auth/auth.domain.service'
import { resetKeys } from 'src/domains/auth/password-reset.service'
import { PasswordService } from 'src/domains/auth/password.service'
import { ACCOUNT_SENTENCES, RIDER_DEACTIVATED_SENTENCE } from 'src/domains/courier/account-upkeep'
import { CourierDomainService } from 'src/domains/courier/courier.domain.service'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { UserDomainService } from 'src/domains/user/user.domain.service'
import {
  AccountChangeInput,
  AccountChangeWithActor,
  CourierAccountRepository,
} from 'src/persistence/repositories/courier-account.repository'
import { CourierDeviceRepository } from 'src/persistence/repositories/courier-device.repository'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import { PrismaService } from 'src/services/prisma/prisma.service'
import { CacheService } from 'src/services/cache/cache.service'
import { CourierCutOffService } from 'src/services/courier-cut-off/courier-cut-off.service'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { MailService } from 'src/services/mail/mail.service'
// A mail error is logged without its message, which can name the recipient (spec 0039).
import { describeError } from 'src/domains/auth/password-reset.service'
import { WebsocketDispatcher } from 'src/services/websocket/models/WebsocketDispatcher'

// The fields an admin may edit (AC-4, cross check 11): node_uri and the Stripe fields are not here.
export interface CourierAccountEdit {
  firstName?: string
  lastName?: string
  phoneNumber?: string | null
  email?: string
  emergencyContactName?: string | null
  emergencyContactPhone?: string | null
  deliverySetting?: EnumCourierDeliverySetting
  status?: EnumCourierStatus
}

// Cross check 13: at most this many wrong current passwords an hour, per rider.
const WRONG_PASSWORD_TRIES_PER_HOUR = 5
const HOUR_SECONDS = 3600

// Spec 0051 (row 108): rider account upkeep. Deactivating and reactivating a rider, an admin's edit of
// any detail, a rider's own password change and emergency contact, and the record of all of it, which
// the rider and admins read (AC-5). A person decides each of these; the app never does on its own.
@Injectable()
export class CourierAccountService {
  private readonly logger = new Logger(CourierAccountService.name)

  constructor(
    private readonly accounts: CourierAccountRepository,
    private readonly courierRepository: CourierRepository,
    private readonly courierDomainService: CourierDomainService,
    private readonly userDomainService: UserDomainService,
    private readonly passwordService: PasswordService,
    private readonly authDomainService: AuthDomainService,
    private readonly courierCutOffService: CourierCutOffService,
    private readonly deliveryEventService: DeliveryEventService,
    private readonly courierDeviceRepository: CourierDeviceRepository,
    private readonly websocketDispatcher: WebsocketDispatcher,
    private readonly cacheService: CacheService,
    private readonly mailService: MailService,
    private readonly configDomainService: ConfigDomainService,
    private readonly prisma: PrismaService
  ) {}

  // AC-1, cross checks 1, 4, 6, 8. The checks and writes commit together; then the rider is cut off
  // (sockets, devices, Offline with cause DEACTIVATED, open offers ended) and any reset code dropped.
  async deactivate(courierId: string, adminUserId: string, reason: string): Promise<CourierEntity> {
    const result = await this.accounts.deactivate(courierId, adminUserId, reason, new Date())
    switch (result.outcome) {
      case 'MISSING':
        throw new errors.NotFoundException('Courier not found')
      case 'ALREADY':
        throw new ConflictException(ACCOUNT_SENTENCES.alreadyDeactivated)
      case 'IS_ADMIN':
        throw new ConflictException(ACCOUNT_SENTENCES.isAdmin)
      case 'IN_SOS':
        throw new ConflictException(ACCOUNT_SENTENCES.inSos)
      case 'HOLDS_JOB':
        throw new ConflictException(ACCOUNT_SENTENCES.holdsJob)
    }
    const courier = await this.courierDomainService.getByIdOrThrow(courierId)
    await this.courierCutOffService.cutOff(courier, adminUserId, EnumCourierStatusChangeCause.DEACTIVATED)
    await this.forgetResetsOf(result.userId)
    // Ids and counts only, never the reason (it can name a person).
    this.logger.log(
      `Admin ${adminUserId} deactivated courier ${courierId}; ${result.droppedBookings} shift booking(s) dropped`
    )
    return this.courierDomainService.getByIdOrThrow(courierId)
  }

  // AC-3, cross check 9: the same login and history; the rider sets a new password through Forgot
  // password (or an admin sets one with the existing route when mail is off).
  async reactivate(courierId: string, adminUserId: string, reason: string | null): Promise<CourierEntity> {
    const result = await this.accounts.reactivate(courierId, adminUserId, reason, new Date())
    if (result.outcome === 'MISSING') throw new errors.NotFoundException('Courier not found')
    if (result.outcome === 'NOT_DEACTIVATED') throw new ConflictException(ACCOUNT_SENTENCES.notDeactivated)
    // Cross check 9 (review fix): back Offline, whatever a failed cut off or a status change in flight left.
    try {
      await this.courierDomainService.changeStatus(
        courierId,
        EnumCourierStatus.OFFLINE,
        EnumCourierStatusChangeCause.ADMIN,
        adminUserId
      )
      await this.deliveryEventService.handleCourierStatusChanged(courierId, EnumCourierStatus.OFFLINE)
    } catch (error) {
      this.logger.error(
        `Could not set reactivated courier ${courierId} Offline: ${errorSummaryForLog(error)}`,
        describeErrorForLog(error).stack
      )
    }
    this.logger.log(`Admin ${adminUserId} reactivated courier ${courierId}`)
    return this.courierDomainService.getByIdOrThrow(courierId)
  }

  // AC-4, AC-5, cross checks 7 and 11. Only the named fields are read from the input (the pipe keeps
  // whatever a client sends). Each changed field leaves one row; an unchanged one leaves none.
  async editByAdmin(courierId: string, input: CourierAccountEdit, adminUserId: string): Promise<CourierEntity> {
    const current = await this.prisma.courier.findUnique({
      where: { id: courierId },
      include: { user: { select: { id: true, email: true, role: true } } },
    })
    if (!current) throw new errors.NotFoundException('Courier not found')

    // The status first, as before (spec 0040, spec 0002), refused for a deactivated rider unless Offline.
    if (input.status) {
      if (current.deactivatedAt && input.status !== EnumCourierStatus.OFFLINE) {
        throw new ConflictException(RIDER_DEACTIVATED_SENTENCE)
      }
      await this.courierDomainService.changeStatus(
        courierId,
        input.status,
        EnumCourierStatusChangeCause.ADMIN,
        adminUserId
      )
      await this.deliveryEventService.handleCourierStatusChanged(courierId, input.status)
    }

    const courierData: Record<string, string | null> = {}
    const changes: AccountChangeInput[] = []
    const consider = (field: keyof CourierAccountEdit, next: string | null | undefined, before: string | null) => {
      if (next === undefined || next === before) return
      courierData[field] = next
      changes.push({
        courierId,
        actorUserId: adminUserId,
        actorIsRider: false,
        kind: EnumCourierAccountChangeKind.FIELD_EDITED,
        field,
        oldValue: before,
        newValue: next,
      })
    }
    consider('firstName', input.firstName?.trim(), current.firstName)
    consider('lastName', input.lastName?.trim(), current.lastName)
    const phone = input.phoneNumber === undefined ? undefined : input.phoneNumber?.replace(/\s+/g, '') || null
    consider('phoneNumber', phone, current.phoneNumber)
    consider('emergencyContactName', blankToNull(input.emergencyContactName), current.emergencyContactName)
    consider('emergencyContactPhone', blankToNull(input.emergencyContactPhone), current.emergencyContactPhone)
    consider('deliverySetting', input.deliverySetting, current.deliverySetting)

    // Cross check 11: the email trimmed and lower cased, unique ignoring case.
    // Review fixes: `null` reads as not sent (it was a 500), and a stored email with capitals is not a change
    // (it signed the rider out on an unchanged save).
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : undefined
    const emailChanged =
      email !== undefined && email !== '' && email !== (current.user.email ?? '').trim().toLowerCase()
    if (emailChanged) {
      // Review fix: a login that is also an admin is never signed out by this route, as the set password route.
      if (current.user.role.includes(EnumUserRole.ADMIN)) throw new ConflictException(ACCOUNT_SENTENCES.isAdmin)
      const other = await this.userDomainService.findUserWithEmailIgnoringCase(email)
      if (other && other.id !== current.user.id) throw new errors.CourierEmailTakenException()
      changes.push({
        courierId,
        actorUserId: adminUserId,
        actorIsRider: false,
        kind: EnumCourierAccountChangeKind.FIELD_EDITED,
        field: 'email',
        oldValue: current.user.email,
        newValue: email,
      })
    }
    if (courierData.phoneNumber) {
      const other = await this.courierRepository.findByPhoneNumber(courierData.phoneNumber)
      if (other && other.id !== courierId) throw new errors.CourierPhoneTakenException()
    }
    if (changes.length === 0) return this.courierDomainService.getByIdOrThrow(courierId)

    try {
      await this.prisma.$transaction(async (tx) => {
        if (Object.keys(courierData).length > 0)
          await tx.courier.update({ where: { id: courierId }, data: courierData })
        // A changed email ends every session (AC-4); the password stays.
        if (emailChanged)
          await tx.user.update({ where: { id: current.user.id }, data: { email, credentialsChangedAt: new Date() } })
        await this.accounts.record(changes, tx)
      })
    } catch (error) {
      // Two admins saving the same value at once: the unique index stops the second (row 121's filter).
      if (error instanceof Error && error.name === 'PrismaClientKnownRequestError') {
        const target = String((error as { meta?: { target?: unknown } }).meta?.target ?? '')
        if (target.includes('phoneNumber')) throw new errors.CourierPhoneTakenException()
        if (target.includes('email')) throw new errors.CourierEmailTakenException()
      }
      throw error
    }

    if (emailChanged && email) {
      await this.forgetResetsOf(current.user.id)
      await this.tellOldAddress(current.user.email, email, current.user.id)
    }
    // Ids and field names only, never the values (personal data).
    this.logger.log(`Admin ${adminUserId} edited courier ${courierId}: ${changes.map((c) => c.field).join(', ')}`)
    return this.courierDomainService.getByIdOrThrow(courierId)
  }

  // AC-5, AC-6, AC-7: the record, newest first.
  async history(courierId: string): Promise<AccountChangeWithActor[]> {
    return this.accounts.listFor(courierId)
  }

  // AC-5, cross check 10: an admin's set password and a rider's reset by email leave a row too.
  // Review fix: logged, never thrown, because the password is already saved when this runs.
  async recordPasswordChange(courierId: string, actor: { adminUserId: string } | 'rider'): Promise<void> {
    try {
      await this.accounts.record([
        {
          courierId,
          actorUserId: actor === 'rider' ? null : actor.adminUserId,
          actorIsRider: actor === 'rider',
          kind: EnumCourierAccountChangeKind.PASSWORD_CHANGED,
        },
      ])
    } catch (error) {
      this.logger.error(
        `Could not record the password change of courier ${courierId}: ${errorSummaryForLog(error)}`,
        describeErrorForLog(error).stack
      )
    }
  }

  // AC-8, cross check 13: the rider's own change. Wrong current passwords are limited per hour; the new
  // one must differ. Sessions elsewhere end; this phone gets fresh tokens and keeps its push device.
  async changeOwnPassword(
    courier: CourierEntity,
    input: { currentPassword: string; newPassword: string; pushToken?: string }
  ) {
    const user = await this.userDomainService.findById(courier.userId)
    const triesKey = `password-change-tries:${user.id}`
    const tries = Number((await this.cacheService.get<number>(triesKey)) ?? 0)
    if (tries >= WRONG_PASSWORD_TRIES_PER_HOUR) throw new BadRequestException(ACCOUNT_SENTENCES.tooManyTries)
    if (!user.password || !(await this.passwordService.compare(input.currentPassword, user.password))) {
      await this.cacheService.increment(triesKey, HOUR_SECONDS)
      throw new BadRequestException(ACCOUNT_SENTENCES.wrongCurrentPassword)
    }
    if (await this.passwordService.compare(input.newPassword, user.password)) {
      throw new BadRequestException(ACCOUNT_SENTENCES.samePassword)
    }
    const hashed = await this.passwordService.hash(input.newPassword)
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { password: hashed, credentialsChangedAt: new Date() } })
      await this.accounts.record(
        [
          {
            courierId: courier.id,
            actorUserId: null,
            actorIsRider: true,
            kind: EnumCourierAccountChangeKind.PASSWORD_CHANGED,
          },
        ],
        tx
      )
    })
    await this.cacheService.delete(triesKey)
    // Other phones: their pushes stop now and their tokens at the next request. Each step logged, never thrown.
    try {
      const tokens = await this.courierDeviceRepository.findTokensForCourier(courier.id)
      await this.courierDeviceRepository.deleteByTokens(tokens.filter((token) => token !== input.pushToken))
    } catch (error) {
      this.logger.error(
        `Could not remove the other devices of courier ${courier.id}: ${errorSummaryForLog(error)}`,
        describeErrorForLog(error).stack
      )
    }
    try {
      await this.websocketDispatcher.disconnectUser(user.id)
    } catch (error) {
      this.logger.error(
        `Could not close the connections of courier ${courier.id}: ${errorSummaryForLog(error)}`,
        describeErrorForLog(error).stack
      )
    }
    this.logger.log(`Courier ${courier.id} changed their password`)
    // A session issued now is newer than credentialsChangedAt to the second (iat is in whole seconds and
    // the check lets the same second pass), so this phone stays signed in.
    return this.authDomainService.createSessionForUser(await this.userDomainService.findById(user.id))
  }

  // Cross check 12: the rider's own emergency contact, saved on the server; not recorded (the rider's own).
  async setOwnEmergencyContact(courierId: string, name: string | null, phone: string | null): Promise<void> {
    await this.prisma.courier.update({
      where: { id: courierId },
      data: { emergencyContactName: blankToNull(name) ?? null, emergencyContactPhone: blankToNull(phone) ?? null },
    })
  }

  // The rider's own emergency contact, and an admin's view of it (never on the courier list).
  async emergencyContactOf(courierId: string): Promise<{ name: string | null; phone: string | null }> {
    const row = await this.prisma.courier.findUnique({
      where: { id: courierId },
      select: { emergencyContactName: true, emergencyContactPhone: true },
    })
    return { name: row?.emergencyContactName ?? null, phone: row?.emergencyContactPhone ?? null }
  }

  // Cross checks 2 and 11: a deactivation or a changed email drops any reset code in flight and its guards,
  // so an old code can never sign the rider in again. Logged by id on failure, never thrown.
  private async forgetResetsOf(userId: string): Promise<void> {
    for (const key of Object.values(resetKeys(userId))) {
      try {
        await this.cacheService.delete(key)
      } catch (error) {
        this.logger.error(`Could not drop a password reset key of user ${userId}`)
      }
    }
  }

  // Cross check 11: a notice to the OLD address. Mail off, or a failure: logged by id, never the addresses.
  // Spec 0054 (cross check 8): in the rider's own language (User.language), from src/localization.
  private async tellOldAddress(oldEmail: string | null, newEmail: string, userId: string): Promise<void> {
    if (!oldEmail || !this.mailService.isConfigured()) return
    try {
      // The whole row, not a select: the generated client learns `language` only after spec 0054's migration.
      const user = await this.prisma.user.findUnique({ where: { id: userId } })
      const language = languageOf((user as { language?: string } | null)?.language)
      const stored = (await this.configDomainService.instanceConfig.getDetails()).name as string | undefined
      const coop = (stored ?? '').trim() || translate(language, 'server.mail.coopFallback')
      const text = translate(language, 'server.mail.emailChangedBody', { coop, newEmail })
      await this.mailService.send({
        to: oldEmail,
        subject: translate(language, 'server.mail.emailChangedSubject', { coop }),
        text,
        html: `<p>${escapeHtml(text)}</p>`,
      })
    } catch (error) {
      this.logger.error(`Could not send the email change notice of user ${userId}: ${describeError(error)}`)
    }
  }
}

function blankToNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
