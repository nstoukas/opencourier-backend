import { Injectable, Logger } from '@nestjs/common'
import { EnumUserRole } from '@prisma/types'
import * as errors from 'src/errors'
import { PasswordService } from 'src/domains/auth/password.service'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { UserDomainService } from 'src/domains/user/user.domain.service'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import { isUniqueConstraintError } from 'src/prisma.util'
import { CourierCutOffService } from 'src/services/courier-cut-off/courier-cut-off.service'
import { CourierCreateAdminInput } from './queries/courier-create.admin.input'

// Rider accounts issued by the co-op (spec 0013): an admin creates a rider with their login, and
// sets a new password, which cuts the old phone off. Mirrors PartnerAdminRestApiService.
// `@Injectable()` lets NestJS build this class and hand it the services in its constructor (DI).
@Injectable()
export class CourierAdminRestApiService {
  private readonly logger = new Logger(CourierAdminRestApiService.name)

  constructor(
    private readonly userDomainService: UserDomainService,
    private readonly passwordService: PasswordService,
    private readonly courierRepository: CourierRepository,
    private readonly courierCutOffService: CourierCutOffService
  ) {}

  async createCourier(input: CourierCreateAdminInput, adminUserId: string): Promise<CourierEntity> {
    // Normalised here as well as in the input class, so a call that does not come through the HTTP
    // pipe stores the same values (spec 0013; agy review). The email is lower cased, as restaurant
    // emails are; rider login also tries this form.
    const email = input.email.trim().toLowerCase()
    const firstName = input.firstName.trim()
    const lastName = input.lastName.trim()
    const phoneNumber = input.phoneNumber.replace(/\s+/g, '')

    if (await this.userDomainService.findUserWithEmailIgnoringCase(email)) {
      throw new errors.CourierEmailTakenException()
    }
    if (await this.courierRepository.findByPhoneNumber(phoneNumber)) {
      throw new errors.CourierPhoneTakenException()
    }

    const hashedPassword = await this.passwordService.hash(input.password)

    let courier: CourierEntity
    try {
      courier = await this.courierRepository.createWithLogin({
        firstName,
        lastName,
        phoneNumber,
        login: { email, hashedPassword },
      })
    } catch (error) {
      // Two admins saving the same rider at once both pass the checks above; the unique index stops
      // the second. Prisma names the column in `meta.target` (an array, or the index name).
      if (error instanceof Error && isUniqueConstraintError(error)) {
        const target = String((error as { meta?: { target?: unknown } }).meta?.target ?? '')
        throw target.includes('phoneNumber')
          ? new errors.CourierPhoneTakenException()
          : new errors.CourierEmailTakenException()
      }
      throw error
    }

    // Ids only: never the email, phone or password (spec 0013, AC-10).
    this.logger.log(`Admin ${adminUserId} created courier ${courier.id}`)
    return courier
  }

  async rotatePassword(courierId: string, newPassword: string, adminUserId: string): Promise<void> {
    const courier = await this.courierRepository.findById(courierId)
    if (!courier) {
      throw new errors.NotFoundException('Courier not found')
    }
    const user = await this.userDomainService.findById(courier.userId)
    if (!user.email) {
      // A dev script account with no email: a password would never let it log in.
      throw new errors.NotFoundException('This rider has no login.')
    }
    if (user.role.includes(EnumUserRole.ADMIN)) {
      // These routes never sign an admin out (spec 0013, AC-10). A login that is both rider and
      // admin has its password changed some other way (row 16 review).
      throw new errors.ForbiddenException('This login also belongs to an admin.')
    }

    const hashedPassword = await this.passwordService.hash(newPassword)
    // One update: the new password and the time every older token stops working. `new Date()` is
    // Node's clock, the one that signs each token's `iat`.
    await this.userDomainService.update(user.id, { password: hashedPassword, credentialsChangedAt: new Date() })
    this.logger.log(`Admin ${adminUserId} set a new password for courier ${courierId}`)

    // Sockets closed, devices removed, set Offline (spec 0013, AC-5), shared with the reset by email.
    await this.courierCutOffService.cutOff(courier)
  }
}
