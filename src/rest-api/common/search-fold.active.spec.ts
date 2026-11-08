import * as fs from 'fs'
import * as path from 'path'
import {
  SEARCH_FOLD_FROM,
  SEARCH_FOLD_TO,
  escapeLikeText,
  foldSearchText,
  searchDigits,
} from './search-fold'

// Spec 0025 (row 98): the typed search text is folded the same way the database folds the stored
// text (`oc_search_fold` in migration 20261103060000_add_search_fold).

// The backend's src/ folder: this file sits in src/rest-api/common.
const SRC_DIR = path.resolve(__dirname, '..', '..')
const MIGRATION_FILE = path.resolve(
  SRC_DIR,
  '..',
  'prisma',
  'migrations',
  '20261103060000_add_search_fold',
  'migration.sql'
)

describe('search-fold (spec 0025)', () => {
  describe('foldSearchText (AC-1, AC-3)', () => {
    test('every spelling of Νίκος folds to "νικοσ": capitals, accents, final sigma, and σ typed at the end', () => {
      expect(foldSearchText('ΝΙΚΟΣ')).toBe('νικοσ')
      expect(foldSearchText('Νίκος')).toBe('νικοσ')
      expect(foldSearchText('νικος')).toBe('νικοσ')
      expect(foldSearchText('νίκοσ')).toBe('νικοσ')
    })

    test('a final sigma inside a phrase folds to σ, and so does a capital Σ', () => {
      expect(foldSearchText('Νίκος Παπαδόπουλος')).toBe('νικοσ παπαδοπουλοσ')
      expect(foldSearchText('ΣΩΤΗΡΗΣ')).toBe('σωτηρησ')
      expect(foldSearchText('ς')).toBe('σ')
      expect(foldSearchText('Σ')).toBe('σ')
    })

    test('every Greek accented letter loses its accent, dialytika included', () => {
      expect(foldSearchText('άέήίόύώ')).toBe('αεηιουω')
      expect(foldSearchText('ΆΈΉΊΌΎΏ')).toBe('αεηιουω')
      expect(foldSearchText('ϊϋΐΰ')).toBe('ιυιυ')
      expect(foldSearchText('ΪΫ')).toBe('ιυ')
      expect(foldSearchText('Προϊόν')).toBe('προιον')
    })

    test('Latin accents and Latin case fold: "Café" is "cafe" (AC-3)', () => {
      expect(foldSearchText('Café')).toBe('cafe')
      expect(foldSearchText('CAFÉ')).toBe('cafe')
      expect(foldSearchText('Ñandú Çà')).toBe('nandu ca')
      expect(foldSearchText('ORD-1042')).toBe('ord-1042')
    })

    test('a decomposed ί (ι + combining acute, U+03B9 U+0301) folds like the composed ί', () => {
      const decomposed = 'Νίκος'
      // Guard: the input really is decomposed, so the test checks NFC and not a typo.
      expect(decomposed).not.toBe('Νίκος')
      expect(decomposed.length).toBe(6)
      expect(foldSearchText(decomposed)).toBe('νικοσ')
      expect(foldSearchText('ί')).toBe(foldSearchText('ί'))
      expect(foldSearchText('ί')).toBe('ι')
    })

    test('a decomposed Latin é (e + combining acute) folds to e', () => {
      expect(foldSearchText('Café')).toBe('cafe')
    })

    test('a newline or a tab inside the text becomes one space', () => {
      expect(foldSearchText('Νίκος\nΠαπαδόπουλος')).toBe('νικοσ παπαδοπουλοσ')
      expect(foldSearchText('Νίκος\tΠαπαδόπουλος')).toBe('νικοσ παπαδοπουλοσ')
      expect(foldSearchText('a\r\nb')).toBe('a b')
    })

    test('a run of whitespace of any kind becomes a single space', () => {
      expect(foldSearchText('a \t\n  b')).toBe('a b')
      expect(foldSearchText('a     b')).toBe('a b')
    })

    test('the folded text never holds a newline (the stored fields are joined by one)', () => {
      const folded = foldSearchText('x\ny\n\nz\r\n')
      expect(folded).not.toContain('\n')
      expect(folded).not.toContain('\r')
      expect(folded).not.toContain('\t')
    })

    test('digits, separators and LIKE characters are left as they are', () => {
      expect(foldSearchText('+30 (24210) 10-009.')).toBe('+30 (24210) 10-009.')
      expect(foldSearchText('%_\\')).toBe('%_\\')
    })

    test('the empty string folds to the empty string', () => {
      expect(foldSearchText('')).toBe('')
    })
  })

  describe('SEARCH_FOLD_FROM and SEARCH_FOLD_TO', () => {
    test('both are 93 characters, counted by whole characters', () => {
      expect(Array.from(SEARCH_FOLD_FROM)).toHaveLength(93)
      expect(Array.from(SEARCH_FOLD_TO)).toHaveLength(93)
    })

    test('FROM lists every character once, so the mapping is unambiguous', () => {
      expect(new Set(Array.from(SEARCH_FOLD_FROM)).size).toBe(93)
    })

    test('FROM holds every sigma form, each mapped to σ', () => {
      const from = Array.from(SEARCH_FOLD_FROM)
      const to = Array.from(SEARCH_FOLD_TO)
      for (const sigma of ['Σ', 'ς']) {
        const index = from.indexOf(sigma)
        expect(index).toBeGreaterThanOrEqual(0)
        expect(to[index]).toBe('σ')
      }
    })

    test('TO is already folded: folding it again changes nothing', () => {
      expect(foldSearchText(SEARCH_FOLD_TO)).toBe(SEARCH_FOLD_TO)
    })
  })

  describe('AC-6: the TypeScript fold and the migration fold are the same rule', () => {
    const migration = fs.readFileSync(MIGRATION_FILE, 'utf8')

    // The two string literals passed to translate() inside oc_search_fold.
    function migrationFoldStrings(): { from: string; to: string } {
      const functionMatch = migration.match(/FUNCTION\s+oc_search_fold\s*\([\s\S]*?\$\$([\s\S]*?)\$\$/)
      expect(functionMatch).not.toBeNull()
      const body = functionMatch![1]!
      const translateMatch = body.match(
        /translate\(\s*lower\(\s*normalize\(\s*coalesce\(\s*t\s*,\s*''\s*\)\s*,\s*NFC\s*\)\s*\)\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/
      )
      expect(translateMatch).not.toBeNull()
      return { from: translateMatch![1]!, to: translateMatch![2]! }
    }

    test('oc_search_fold is translate(lower(normalize(coalesce(t, \'\'), NFC)), FROM, TO)', () => {
      const { from, to } = migrationFoldStrings()
      expect(from.length).toBeGreaterThan(0)
      expect(to.length).toBeGreaterThan(0)
    })

    test('the migration FROM equals SEARCH_FOLD_FROM', () => {
      expect(migrationFoldStrings().from).toBe(SEARCH_FOLD_FROM)
    })

    test('the migration TO equals SEARCH_FOLD_TO', () => {
      expect(migrationFoldStrings().to).toBe(SEARCH_FOLD_TO)
    })

    test('the migration strings are 93 characters each', () => {
      const { from, to } = migrationFoldStrings()
      expect(Array.from(from)).toHaveLength(93)
      expect(Array.from(to)).toHaveLength(93)
    })

    test('oc_search_digits keeps only the digits', () => {
      expect(migration).toMatch(
        /FUNCTION\s+oc_search_digits\s*\([\s\S]*?regexp_replace\(\s*coalesce\(\s*t\s*,\s*''\s*\)\s*,\s*'\[\^0-9\]'\s*,\s*''\s*,\s*'g'\s*\)/
      )
    })
  })

  describe('searchDigits (AC-2)', () => {
    test('"24210-10009" gives "2421010009"', () => {
      expect(searchDigits('24210-10009')).toBe('2421010009')
    })

    test('"(24210) 10009" gives its digits', () => {
      expect(searchDigits('(24210) 10009')).toBe('2421010009')
    })

    test('"+30 2421010009" gives its digits', () => {
      expect(searchDigits('+30 2421010009')).toBe('302421010009')
    })

    test('dots, slashes and a plain run of digits give their digits', () => {
      expect(searchDigits('24210.10009')).toBe('2421010009')
      expect(searchDigits('24210/10009')).toBe('2421010009')
      expect(searchDigits('2421010009')).toBe('2421010009')
      expect(searchDigits('(24210)')).toBe('24210')
      expect(searchDigits('+30')).toBe('30')
    })

    test('a name gives null', () => {
      expect(searchDigits('Νίκος')).toBeNull()
      expect(searchDigits('giorgos')).toBeNull()
    })

    test('separators with no digit give null', () => {
      expect(searchDigits('--')).toBeNull()
      expect(searchDigits('()')).toBeNull()
      expect(searchDigits('+')).toBeNull()
    })

    test('a word mixing letters and digits gives null', () => {
      expect(searchDigits('ORD-1042')).toBeNull()
      expect(searchDigits('pap1')).toBeNull()
      expect(searchDigits('6900a')).toBeNull()
      expect(searchDigits('νικοσ69')).toBeNull()
    })

    test('a word with a LIKE character gives null', () => {
      expect(searchDigits('69%')).toBeNull()
      expect(searchDigits('69_00')).toBeNull()
    })

    test('the empty string gives null', () => {
      expect(searchDigits('')).toBeNull()
    })
  })

  describe('escapeLikeText (AC-4)', () => {
    test('escapes %', () => {
      expect(escapeLikeText('%')).toBe('\\%')
      expect(escapeLikeText('50%')).toBe('50\\%')
    })

    test('escapes _', () => {
      expect(escapeLikeText('_')).toBe('\\_')
      expect(escapeLikeText('a_b')).toBe('a\\_b')
    })

    test('escapes the backslash itself', () => {
      expect(escapeLikeText('\\')).toBe('\\\\')
    })

    test('escapes every occurrence, mixed with text', () => {
      expect(escapeLikeText('ord_1042%\\extra')).toBe('ord\\_1042\\%\\\\extra')
      expect(escapeLikeText('____')).toBe('\\_\\_\\_\\_')
    })

    test('leaves plain text unchanged', () => {
      expect(escapeLikeText('νικοσ ord-1042')).toBe('νικοσ ord-1042')
    })
  })

  describe('AC-7 / key invariant: Prisma code never writes searchFold', () => {
    // Relative to src/. The two filters read it, search-fold.ts names it in comments, and the three
    // entities declare it as null. Anywhere else, the word would be code reading or writing the column.
    const ALLOWED = new Set([
      'rest-api/common/search-fold.ts',
      'rest-api/delivery/admin/queries/delivery-list-filter.ts',
      'rest-api/courier/admin/queries/courier-list-filter.ts',
      'domains/delivery/entities/delivery.entity.ts',
      'domains/delivery/entities/delivery-with-locations.entity.ts',
      'domains/courier/entities/courier.entity.ts',
    ])

    function tsFilesUnder(directory: string): string[] {
      const files: string[] = []
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name)
        if (entry.isDirectory()) files.push(...tsFilesUnder(full))
        else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(full)
      }
      return files
    }

    const filesNamingSearchFold = tsFilesUnder(SRC_DIR)
      .filter((file) => fs.readFileSync(file, 'utf8').includes('searchFold'))
      .map((file) => path.relative(SRC_DIR, file).split(path.sep).join('/'))

    test('the scan really reads src/ (it finds the files known to name searchFold)', () => {
      expect(filesNamingSearchFold).toEqual(
        expect.arrayContaining([
          'rest-api/common/search-fold.ts',
          'rest-api/delivery/admin/queries/delivery-list-filter.ts',
          'rest-api/courier/admin/queries/courier-list-filter.ts',
        ])
      )
    })

    test('only the allowed files and test files name searchFold', () => {
      const offenders = filesNamingSearchFold.filter(
        (file) => !ALLOWED.has(file) && !file.endsWith('.active.spec.ts')
      )
      expect(offenders).toEqual([])
    })
  })
})
