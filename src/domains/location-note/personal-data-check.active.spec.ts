import {
  findPersonalData,
  foldForNameCheck,
  looksLikePersonalData,
  PERSONAL_DATA_WARNING_MESSAGE,
} from './personal-data-check'

describe('Personal data check (Spec 0053 AC-4, cross check 6, 7)', () => {
  describe('foldForNameCheck', () => {
    it('lowercases, strips accents, and normalizes final sigma to standard sigma', () => {
      // Greek name with accent and final sigma
      expect(foldForNameCheck('Γιώργος')).toBe('γιωργοσ')
      // Uppercase Greek
      expect(foldForNameCheck('ΓΙΩΡΓΟΣ')).toBe('γιωργοσ')
      // English mixed case
      expect(foldForNameCheck('Alexander')).toBe('alexander')
    })
  })

  describe('Phone number detection (8+ digits, spaces/dashes/dots/leading +)', () => {
    it('detects standard Greek mobile numbers with spaces or dashes', () => {
      expect(findPersonalData('+30 694 123 4567')).toContain('phone')
      expect(findPersonalData('6941234567')).toContain('phone')
      expect(findPersonalData('+30-694-123-4567')).toContain('phone')
      expect(findPersonalData('694.123.4567')).toContain('phone')
    })

    it('detects landline numbers with local area codes', () => {
      expect(findPersonalData('2421 012345')).toContain('phone')
      expect(findPersonalData('2421012345')).toContain('phone')
    })

    it('detects phone numbers with up to 3 spaces, dashes, or dots between digits (row 82 review)', () => {
      // Spaces around dashes
      expect(findPersonalData('694 - 123 - 4567')).toContain('phone')
      // Double spaces between digits
      expect(findPersonalData('694  123  4567')).toContain('phone')
      // Triple spaces between digits
      expect(findPersonalData('694   123   4567')).toContain('phone')
      // Triple dots between digits
      expect(findPersonalData('694...123...4567')).toContain('phone')
      // Mixed separators up to 3
      expect(findPersonalData('+30 694.- 123456')).toContain('phone')
    })

    it('does NOT flag everyday address numbers such as floor and apartment', () => {
      // 4th floor, door 12: only 3 digits total
      expect(findPersonalData('4 floor, door 12')).not.toContain('phone')
      expect(findPersonalData('Building B, 3rd floor, apt 15')).not.toContain('phone')
    })

    it('flags long door codes (8+ digits) so rider sees warning and can Save anyway', () => {
      // Cross check 7: long door codes look like phones, so rider can confirm: true
      expect(findPersonalData('Door code 12345678')).toContain('phone')
    })
  })

  describe('Email address detection', () => {
    it('detects email addresses in text', () => {
      expect(findPersonalData('Contact user@example.gr for key')).toContain('email')
      expect(findPersonalData('info@coop.org')).toContain('email')
    })

    it('does NOT detect email when @ is absent or isolated', () => {
      expect(findPersonalData('Ring bell @ entrance')).not.toContain('email')
    })
  })

  describe('First name detection from shipped list (Greek and English, both alphabets)', () => {
    it('detects common Greek first names in nominative, vocative, and genitive forms', () => {
      // Nominative
      expect(findPersonalData('Ρώτα τον Νίκος')).toContain('name')
      // Vocative
      expect(findPersonalData('Φώναξε τον Νίκο')).toContain('name')
      // Genitive
      expect(findPersonalData('Το κουδούνι του Νίκου')).toContain('name')
      // Accented uppercase
      expect(findPersonalData('ΠΑΠΑΔΟΠΟΥΛΟΣ ΓΙΩΡΓΟΣ')).toContain('name')
      // Female name
      expect(findPersonalData('Άφησε το στην Μαρία')).toContain('name')
      expect(findPersonalData('Κουδούνι Μαρίας')).toContain('name')
    })

    it('detects common English first names in Latin script and transliterated into Greek', () => {
      // Latin script
      expect(findPersonalData('Leave with John at reception')).toContain('name')
      expect(findPersonalData('Call Michael')).toContain('name')
      // Transliterated
      expect(findPersonalData('Άφησε το στον Τζον')).toContain('name')
      expect(findPersonalData('Κουδούνι Μάικλ')).toContain('name')
    })

    it('matches whole words only rather than substrings', () => {
      // "pan" should not match inside unrelated text if not a stand-alone name word
      expect(findPersonalData('Blue gate beside tree')).toEqual([])
    })

    it('allows street names that were excluded intentionally as everyday words (decision 82.3)', () => {
      // Athena (Αθηνά), Chara (Χαρά) are streets/everyday words excluded from given-names.json
      expect(findPersonalData('Οδός Αθηνάς 15')).toEqual([])
      expect(findPersonalData('Πολυκατοικία')).toEqual([])
    })
  })

  describe('looksLikePersonalData helper', () => {
    it('returns false for descriptive notes about places and access', () => {
      expect(looksLikePersonalData('Yellow gate on the left, elevator broken, use stairs')).toBe(false)
      expect(looksLikePersonalData('Side entrance on secondary alley, ring bell 3 times')).toBe(false)
      expect(looksLikePersonalData('Drop off at rear porch behind blue wooden fence')).toBe(false)
    })

    it('returns true when text contains phone, email, or given name', () => {
      expect(looksLikePersonalData('Call 6941234567 when downstairs')).toBe(true)
      expect(looksLikePersonalData('Mail receipt to test@example.com')).toBe(true)
      expect(looksLikePersonalData('Leave package with Kostas')).toBe(true)
    })
  })

  describe('Warning message constant', () => {
    it('matches the exact sentence required by AC-4', () => {
      expect(PERSONAL_DATA_WARNING_MESSAGE).toBe(
        'Notes describe the place, never the person. This looks like it holds a name, phone or email.'
      )
    })
  })
})
