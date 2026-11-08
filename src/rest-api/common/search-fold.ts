// The admin searches' folding (spec 0025, row 98). The database keeps a folded copy of each searched
// field in `searchFold` (trigger functions in migration 20261103060000_add_search_fold), and the
// typed text is folded here by the same rule, so "νικος", "ΝΙΚΟΣ" and "Νίκος" all match "Νίκος".

// Each character of FROM becomes the character at the same position in TO. Greek capitals and
// accented letters lose their accents, every sigma becomes σ, and common Latin accents go too. These
// two strings must equal the ones inside `oc_search_fold` in the migration: a test compares them.
export const SEARCH_FOLD_FROM =
  'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩΆΈΉΊΌΎΏΪΫάέήίόύώϊϋΐΰςÀÁÂÄÃÈÉÊËÌÍÎÏÒÓÔÖÕÙÚÛÜÇÑàáâäãèéêëìíîïòóôöõùúûüçñ'
export const SEARCH_FOLD_TO =
  'αβγδεζηθικλμνξοπρστυφχψωαεηιουωιυαεηιουωιυιυσaaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn'

// A Map from each FROM character to its TO character, built once. `Array.from` splits a string by
// whole characters, so a two unit character can never be split in half.
const FOLD_TO_CHARACTERS = Array.from(SEARCH_FOLD_TO)
const FOLD = new Map(Array.from(SEARCH_FOLD_FROM).map((character, index) => [character, FOLD_TO_CHARACTERS[index]]))

// The typed text as the database folds the stored text: composed form (NFC), any run of whitespace
// as one space (the stored fields are joined by a newline, so a search must never hold one), lower
// case, then the FROM to TO table.
export function foldSearchText(text: string): string {
  const lower = text.normalize('NFC').replace(/\s+/g, ' ').toLowerCase()
  return Array.from(lower, (character) => FOLD.get(character) ?? character).join('')
}

// The typed search as folded words, empty when there is none: the rule every admin search shares,
// where each word must match on its own (rows 97 and 106).
export function searchWords(text: string | undefined): string[] {
  return foldSearchText(text ?? '').trim().split(' ').filter(Boolean)
}

// A word that is only a phone number typed with separators ("24210-10009", "(24210) 10009"):
// its digits, to match the stored phone's digits. Null for any other word.
export function searchDigits(word: string): string | null {
  if (!/^[0-9\s.\-/()+]+$/.test(word) || !/[0-9]/.test(word)) return null
  return word.replace(/[^0-9]/g, '')
}

// Prisma passes the text into SQL LIKE as it is, where % and _ are wildcards: escape them (and the
// escape character itself), so a search for "%" finds a "%" and not every row (row 96).
export function escapeLikeText(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`)
}
