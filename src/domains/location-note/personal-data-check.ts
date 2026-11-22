import givenNamesFile from './given-names.json'

// Spec 0053 (AC-4): notes describe the place, never the person. Before a note is saved, the text is
// checked for a phone number, an email address or a common first name. A match is a warning, not a
// block: the rider can save anyway (`confirmed: true`), because a long door code looks like a phone
// and some streets carry first names (cross check 7). The mobile app runs a copy of this check
// (opencourier-mobile src/utilities/addressNotes/personalDataCheck.ts), so keep the two the same.

// What kind of personal data the text seems to hold. Never the matched text itself, so nothing that
// logs a result can log the person's details.
export type PersonalDataKind = 'phone' | 'email' | 'name'

// The sentence the rider reads (AC-4), the same on the phone and in the server's 422.
export const PERSONAL_DATA_WARNING_MESSAGE =
  'Notes describe the place, never the person. This looks like it holds a name, phone or email.'

// 8 or more digits, with spaces (or a dash or a dot) between them and an optional leading +.
// "+30 694 123 4567", "6941234567" and "2421 012345" all match; "4 floor, door 12" does not.
const PHONE_PATTERN = /\+?\d(?:[\s.-]?\d){7,}/

// Something@something.something, the shape of any email address.
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/

// The names, already folded (lower case, no accents, every sigma as σ) in the file.
const GIVEN_NAMES: ReadonlySet<string> = new Set(givenNamesFile.names)

// Lower case, accents removed, final sigma as σ: "Γιώργος" and "ΓΙΩΡΓΟΣ" both become "γιωργοσ".
// NFD splits each accented letter into the letter and its accent mark; `\p{M}` (any mark) drops them.
export function foldForNameCheck(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ς/g, 'σ')
}

// The words of the text: runs of letters in any alphabet (`\p{L}` is "any letter" in Unicode).
function wordsOf(text: string): string[] {
  return foldForNameCheck(text)
    .split(/[^\p{L}]+/u)
    .filter(Boolean)
}

// Every kind found, in a fixed order; an empty list means the note looks fine.
export function findPersonalData(text: string): PersonalDataKind[] {
  const found: PersonalDataKind[] = []
  if (PHONE_PATTERN.test(text)) found.push('phone')
  if (EMAIL_PATTERN.test(text)) found.push('email')
  if (wordsOf(text).some((word) => GIVEN_NAMES.has(word))) found.push('name')
  return found
}

export function looksLikePersonalData(text: string): boolean {
  return findPersonalData(text).length > 0
}
