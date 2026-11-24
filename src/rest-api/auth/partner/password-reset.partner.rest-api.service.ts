import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { PasswordService } from 'src/domains/auth/password.service'
import { PasswordResetService, RESET_BY_EMAIL_OFF_MESSAGE } from 'src/domains/auth/password-reset.service'
import { UserDomainService } from 'src/domains/user/user.domain.service'
import { describeError } from 'src/utils/errorForLog'

// Row 153: a restaurant resets its own forgotten password by an emailed code, as riders do (row 17, spec 0039).
// The codes, their limits and the mail are PasswordResetService's, shared with the rider routes; this service
// only answers the two partner routes and saves the new password.
@Injectable()
export class PasswordResetPartnerRestApiService {
  private readonly logger = new Logger(PasswordResetPartnerRestApiService.name)

  constructor(
    private readonly passwordResetService: PasswordResetService,
    private readonly passwordService: PasswordService,
    private readonly userDomainService: UserDomainService
  ) {}

  // Answers at once, whatever the email; the lookup, the limits, the code and the mail run afterwards in a promise
  // nobody waits for, so neither the answer nor how long it takes depends on the email (spec 0039, AC-7).
  forgotPassword(email: string): void {
    if (!this.passwordResetService.isAvailable()) {
      throw new ServiceUnavailableException(RESET_BY_EMAIL_OFF_MESSAGE)
    }
    // `void` marks the promise as deliberately not awaited.
    void this.passwordResetService.sendCodeIfRestaurant(email).catch((error: unknown) => {
      this.logger.error(`Password reset request failed before a restaurant was found: ${describeError(error)}`)
    })
  }

  // Claims the code (it works once), then saves the new password, the time every older session stops working,
  // and switches the API key off, in one update. The restaurant then signs in with its new password; the answer
  // says whether a key was switched off, so request-web can tell them to ask the co-op for a new one.
  async resetPassword(email: string, code: string, password: string): Promise<{ apiKeyRemoved: boolean }> {
    const { user, partnerId } = await this.passwordResetService.claimRestaurantCode(email, code)
    const hashedPassword = await this.passwordService.hash(password)
    // `new Date()` is Node's clock, the one that signs each token's `iat` (spec 0013).
    const { apiKeyRemoved } = await this.userDomainService.setPasswordAndRemoveApiKey(
      user.id,
      hashedPassword,
      new Date()
    )
    // Ids only, never the email, the code or the password (spec 0039, AC-13).
    this.logger.log(`Partner ${partnerId} reset its password by email${apiKeyRemoved ? ' and lost its API key' : ''}`)
    return { apiKeyRemoved }
  }
}
