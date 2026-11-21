// Spec 0051 (row 108): rider account upkeep. The sentences admins and riders read, in one place.

export const ACCOUNT_SENTENCES = {
  holdsJob: 'This rider holds a job. Move it first.',
  inSos: 'This rider has an open SOS. Close it first.',
  isAdmin: 'This login is also an admin. Take the admin role away first.',
  alreadyDeactivated: "This rider's account is already deactivated.",
  notDeactivated: "This rider's account is not deactivated.",
  justOffered: 'This rider was just offered a job. Try again in a moment.',
  wrongCurrentPassword: 'Your current password is not right.',
  samePassword: 'Your new password must be different from the current one.',
  tooManyTries: 'Too many wrong passwords. Try again in an hour.',
}

// Cross check 7: what other doors answer for a deactivated rider (409).
export const RIDER_DEACTIVATED_SENTENCE = "This rider's account is deactivated."

// Cross check 1 and AC-1: the reason a representative gives, 1 to 300 characters after trimming.
export const DEACTIVATION_REASON_MAX = 300
