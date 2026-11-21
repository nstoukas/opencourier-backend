// Spec 0013: a password set by an admin signs the old phone out. Every token carries `iat`, the
// second it was issued (jsonwebtoken always signs it); a token issued before the user's
// `credentialsChangedAt` is refused. Both times come from Node's clock: the column is written with
// `new Date()`, never the database's now().

// What the app is told when its token is refused for this reason (401, so it ends the session).
// Spec 0051 (cross check 3): an admin can also change the login email, which ends sessions the same way.
export const CREDENTIALS_CHANGED_MESSAGE = 'Your password or login email was changed. Log in again.'

// Spec 0051 (AC-2, cross check 1): what a deactivated rider is told at every door, ending with how to
// reach the co-op: its dispatch phone when one is set, else plain words.
export function accountDeactivatedMessage(dispatchPhoneNumber: string | null | undefined): string {
  const reach = dispatchPhoneNumber ? `call the co-op on ${dispatchPhoneNumber}` : 'contact the co-op'
  return `Your account was deactivated by the co-op. If you think this is a mistake, ${reach}.`
}

// True when the token was issued before the last credentials change. A token from the same second
// as the change still passes (iat has no milliseconds), so the rider logging in right after works.
// Null `credentialsChangedAt`: never changed, nothing refused.
export function isIssuedBeforeCredentialsChange(iat: unknown, credentialsChangedAt: Date | null | undefined): boolean {
  if (!credentialsChangedAt) return false
  // A token without an issue time cannot be dated, so once a change exists it is refused.
  if (typeof iat !== 'number') return true
  return iat < Math.floor(credentialsChangedAt.getTime() / 1000)
}
