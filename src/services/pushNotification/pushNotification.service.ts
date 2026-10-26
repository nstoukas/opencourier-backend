import { readFileSync } from 'fs'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getMessaging, Messaging } from 'firebase-admin/messaging'
import { FIREBASE_SERVICE_ACCOUNT_PATH } from '../../constants'

// The FCM error that means "this token will never work again" (the app was uninstalled or its data
// cleared). Only these tokens are deleted; any other failure may be passing (spec 0003, AC-1).
export const FCM_TOKEN_DEAD_CODE = 'messaging/registration-token-not-registered'

// Our own name for the Firebase app, so it never clashes with a default app another library makes.
const FIREBASE_APP_NAME = 'opencourier-push'

export interface PushSendResult {
  // Tokens FCM said are dead, for the caller to delete.
  deadTokens: string[]
  // The FCM error code of every other failure, for the log. Never a token or a rider.
  failureCodes: string[]
}

// Sends FCM data messages through Google's `firebase-admin` library (spec 0003). It knows nothing
// about offers or riders: it takes tokens and string data and reports which tokens are dead.
//
// Push is OFF unless FIREBASE_SERVICE_ACCOUNT_PATH points at a readable service account file (AC-11).
// Off, it logs "push is off" once at startup and sends nothing; callers check isEnabled() first.
@Injectable()
// `implements OnModuleInit` promises Nest an onModuleInit() method, which Nest calls once at
// startup, after this service and everything it depends on have been created.
export class PushNotificationService implements OnModuleInit {
  private readonly logger = new Logger(PushNotificationService.name)
  private messaging: Messaging | null = null

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.messaging = this.startFirebase()
  }

  isEnabled(): boolean {
    return this.messaging !== null
  }

  // One FCM call for all of a rider's devices. Never throws: a push failure must never block,
  // delay or undo an offer (AC-2), so a failed call is reported as failures, not an exception.
  // `ttlSeconds` is how long FCM may keep trying a phone that is out of reach; after that the
  // message is dropped, so a stale offer never rings later.
  async sendData(tokens: string[], data: Record<string, string>, ttlSeconds: number): Promise<PushSendResult> {
    const result: PushSendResult = { deadTokens: [], failureCodes: [] }
    if (!this.messaging || tokens.length === 0) return result

    try {
      const response = await this.messaging.sendEachForMulticast({
        tokens,
        data,
        // High priority wakes a dozing phone; firebase-admin takes the time to live in milliseconds.
        android: { priority: 'high', ttl: Math.max(0, Math.round(ttlSeconds)) * 1000 },
      })

      // The responses come back in the same order as the tokens.
      response.responses.forEach((sendResponse, index) => {
        if (sendResponse.success) return
        const code = sendResponse.error?.code ?? 'unknown'
        // tokens[index] is typed "string or undefined" here (an index can be out of range), so
        // the check keeps an undefined out of the list.
        const token = tokens[index]
        if (code === FCM_TOKEN_DEAD_CODE && token !== undefined) {
          result.deadTokens.push(token)
        } else {
          result.failureCodes.push(code)
        }
      })
    } catch (error) {
      // The whole call failed (network, credentials). Only the code is logged by the caller.
      const code = (error as { code?: string }).code ?? 'send-failed'
      result.failureCodes.push(...tokens.map(() => code))
    }

    return result
  }

  // Returns null (push off) when the variable is unset or the file cannot be used. A broken file
  // turns push off with an error in the log rather than stopping the server: offers still go out
  // over the socket, which is how they went before push existed.
  private startFirebase(): Messaging | null {
    const path = this.configService.get<string>(FIREBASE_SERVICE_ACCOUNT_PATH)
    if (!path) {
      this.logger.log(`push is off: ${FIREBASE_SERVICE_ACCOUNT_PATH} is not set, offers go over the live connection only`)
      return null
    }

    try {
      // Read and parsed here rather than handed to firebase-admin as a path, so an error message can
      // never quote the file's contents (it holds a private key). Only the path is ever logged.
      const serviceAccount = JSON.parse(readFileSync(path, 'utf8'))

      // A second start in the same process (a test module, say) reuses the app instead of failing.
      const app =
        getApps().find((existing) => existing.name === FIREBASE_APP_NAME) ??
        initializeApp({ credential: cert(serviceAccount) }, FIREBASE_APP_NAME)
      this.logger.log(`push is on: Firebase project ${String(serviceAccount.project_id ?? 'unknown')}`)
      return getMessaging(app)
    } catch {
      this.logger.error(
        `push is off: the service account file at ${path} could not be read or is not a valid service account`
      )
      return null
    }
  }
}
