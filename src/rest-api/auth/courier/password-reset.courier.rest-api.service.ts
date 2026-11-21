import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { AuthDomainService } from 'src/domains/auth/auth.domain.service'
import { PasswordService } from 'src/domains/auth/password.service'
import {
  describeError,
  PasswordResetService,
  RESET_BY_EMAIL_OFF_MESSAGE,
} from 'src/domains/auth/password-reset.service'
import { UserDomainService } from 'src/domains/user/user.domain.service'
import { CourierCutOffService } from 'src/services/courier-cut-off/courier-cut-off.service'
import { UserInfoCourierDto } from './dtos/user-info.courier.dto'
import { EnumCourierAccountChangeKind } from '@prisma/types'
import { CourierAccountRepository } from 'src/persistence/repositories/courier-account.repository'

// The two public reset routes' work (row 17, spec 0039). It lives in the REST module rather than in
// AuthDomainModule, which is global and imported by the courier domain: the cut off pulls in sockets
// and delivery events, and keeping it out of the auth domain avoids a module cycle.
@Injectable()
export class PasswordResetCourierRestApiService {
  private readonly logger = new Logger(PasswordResetCourierRestApiService.name)

  constructor(
    private readonly passwordResetService: PasswordResetService,
    private readonly passwordService: PasswordService,
    private readonly userDomainService: UserDomainService,
    private readonly authDomainService: AuthDomainService,
    private readonly courierCutOffService: CourierCutOffService,
    // Spec 0051. Optional only so tests that build this service by hand keep compiling; Nest injects it.
    private readonly courierAccountRepository?: CourierAccountRepository
  ) {}

  // AC-7 and AC-12. Answers at once; the lookup, the limits, the code and the mail run afterwards in
  // a promise nobody waits for, so neither the answer nor how long it takes depends on the email.
  forgotPassword(email: string): void {
    if (!this.passwordResetService.isAvailable()) {
      throw new ServiceUnavailableException(RESET_BY_EMAIL_OFF_MESSAGE)
    }
    // `void` marks the promise as deliberately not awaited. Errors after the rider is known are
    // logged with the user id inside sendCodeIfRider; this catch is for the lookup itself.
    void this.passwordResetService.sendCodeIfRider(email).catch((error: unknown) => {
      this.logger.error(`Password reset request failed before a rider was found: ${describeError(error)}`)
    })
  }

  // AC-10, in the spec's order: claim the code (it works once), save the new password and the time
  // older tokens stop working in one update, cut the other phones off, then answer like login.
  async resetPassword(email: string, code: string, password: string): Promise<UserInfoCourierDto> {
    const { user, courier } = await this.passwordResetService.claimCode(email, code)

    const hashedPassword = await this.passwordService.hash(password)
    // `new Date()` is Node's clock, the one that signs each token's `iat` (spec 0013).
    await this.userDomainService.update(user.id, { password: hashedPassword, credentialsChangedAt: new Date() })
    await this.courierCutOffService.cutOff(courier)
    this.logger.log(`Courier ${courier.id} reset their password by email`)
    // Spec 0051 (AC-5, cross check 10): the rider's own record shows the change. Logged, never thrown:
    // the new password is already saved.
    try {
      await this.courierAccountRepository?.record([
        {
          courierId: courier.id,
          actorUserId: null,
          actorIsRider: true,
          kind: EnumCourierAccountChangeKind.PASSWORD_CHANGED,
        },
      ])
    } catch (error) {
      this.logger.error(`Could not record the password change of courier ${courier.id}`, error as Error)
    }

    // Issued after credentialsChangedAt, so this session survives the cut off it just caused.
    const result = await this.authDomainService.createSessionForUser(user)
    return new UserInfoCourierDto(result)
  }
}
