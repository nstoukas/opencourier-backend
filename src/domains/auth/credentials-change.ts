// Spec 0013: a password set by an admin signs the old phone out. Every token carries `iat`, the
// second it was issued (jsonwebtoken always signs it); a token issued before the user's
// `credentialsChangedAt` is refused. Both times come from Node's clock: the column is written with
// `new Date()`, never the database's now().

// What the app is told when its token is refused for this reason (401, so it ends the session).
export const CREDENTIALS_CHANGED_MESSAGE = 'Your password was changed. Log in again.'

// True when the token was issued before the last credentials change. A token from the same second
// as the change still passes (iat has no milliseconds), so the rider logging in right after works.
// Null `credentialsChangedAt`: never changed, nothing refused.
export function isIssuedBeforeCredentialsChange(iat: unknown, credentialsChangedAt: Date | null | undefined): boolean {
  if (!credentialsChangedAt) return false
  // A token without an issue time cannot be dated, so once a change exists it is refused.
  if (typeof iat !== 'number') return true
  return iat < Math.floor(credentialsChangedAt.getTime() / 1000)
}
