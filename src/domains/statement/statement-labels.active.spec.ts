import { EnumCourierCompensationReason } from '@prisma/types'
import { EnumJobEndLabel } from 'src/domains/time-worked/worked-shifts'
import { STATEMENT_LABELS, STATEMENT_LANGS, formatAmount, formatMoney, langOf } from './statement-labels'

// Spec 0050 (AC-6, cross checks 8, 13, 14, 16): the statement's words in Greek and English.

// Every key path of a labels object, functions included, so the two languages can be compared.
function keyPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix]
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) => keyPaths(child, prefix ? `${prefix}.${key}` : key))
    .sort()
}

// Every plain string in a labels object, with the sentences its functions make.
function allWords(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (typeof value === 'function') return [String((value as (...args: string[]) => string)('2026-10-31', '12,50'))]
  if (value === null || typeof value !== 'object') return []
  return Object.values(value as Record<string, unknown>).flatMap(allWords)
}

describe('statement labels (spec 0050 AC-6)', () => {
  test('there are exactly two languages, Greek and English', () => {
    expect([...STATEMENT_LANGS].sort()).toEqual(['el', 'en'])
    expect(Object.keys(STATEMENT_LABELS).sort()).toEqual(['el', 'en'])
  })

  test('both languages have every key', () => {
    expect(keyPaths(STATEMENT_LABELS.el)).toEqual(keyPaths(STATEMENT_LABELS.en))
    expect(keyPaths(STATEMENT_LABELS.el).length).toBeGreaterThan(40)
  })

  test.each(STATEMENT_LANGS)('%s: no label is empty', (lang) => {
    for (const word of allWords(STATEMENT_LABELS[lang])) {
      expect(word.trim()).not.toBe('')
    }
  })

  test('the Greek labels are written in Greek and the English ones in Latin letters', () => {
    for (const word of allWords(STATEMENT_LABELS.el)) expect(word).toMatch(/[Ͱ-Ͽ]/)
    for (const word of allWords(STATEMENT_LABELS.en)) expect(word).not.toMatch(/[Ͱ-Ͽ]/)
  })

  test.each(STATEMENT_LANGS)('cross check 8: %s names every compensation type', (lang) => {
    expect(Object.keys(STATEMENT_LABELS[lang].reasons).sort()).toEqual(
      Object.values(EnumCourierCompensationReason).sort()
    )
  })

  test.each(STATEMENT_LANGS)('cross check 13: %s names every way a job can end, and Delivered', (lang) => {
    expect(Object.keys(STATEMENT_LABELS[lang].ends).sort()).toEqual(
      [...Object.values(EnumJobEndLabel), 'DELIVERED'].sort()
    )
  })

  test("AC-4: the footer says it is the rider's record and not an invoice, in each language", () => {
    expect(STATEMENT_LABELS.en.footer).toBe('Your record of work. It is not an invoice.')
    expect(STATEMENT_LABELS.el.footer).toBe('Το αρχείο της εργασίας σας. Δεν είναι τιμολόγιο.')
  })

  test('cross check 3: "not recorded" and its footnote', () => {
    expect(STATEMENT_LABELS.en.notRecorded).toBe('not recorded')
    expect(STATEMENT_LABELS.el.notRecorded).toBe('δεν καταγράφηκε')
    expect(STATEMENT_LABELS.en.notRecordedNote).toMatch(/not yet recorded/)
  })

  // Review ruling (2026-11-21): in a month the record began part way through, the jobs from before that day
  // are missing too, not only the hours, and the note has to say so.
  test('review fix: the footnote says jobs and hours from before the record began are not shown, in each language', () => {
    expect(STATEMENT_LABELS.en.notRecordedNote).toBe(
      'Work was not yet recorded for the whole month: jobs and hours from before the record began are not shown.'
    )
    expect(STATEMENT_LABELS.el.notRecordedNote).toBe(
      'Η εργασία δεν καταγραφόταν ακόμη για όλο τον μήνα: οι διανομές και οι ώρες πριν από την έναρξη της καταγραφής δεν εμφανίζονται.'
    )
    // Both name the jobs and the hours.
    expect(STATEMENT_LABELS.en.notRecordedNote).toMatch(/jobs and hours/)
    expect(STATEMENT_LABELS.el.notRecordedNote).toMatch(/διανομές/)
    expect(STATEMENT_LABELS.el.notRecordedNote).toMatch(/ώρες/)
  })

  // Review ruling (2026-11-21): the Greek "Cancelled after pickup" was cut in the PDF's Ended column.
  test('review fix: the Greek label for a job cancelled after pickup is the shorter one', () => {
    const label = STATEMENT_LABELS.el.ends[EnumJobEndLabel.CANCELLED_AFTER_PICKUP]

    expect(label).toBe('Ακύρωση μετά παραλαβή')
    expect(label.length).toBeLessThan('Ακυρώθηκε μετά την παραλαβή'.length)
    // Still told apart from a plain cancellation.
    expect(label).not.toBe(STATEMENT_LABELS.el.ends[EnumJobEndLabel.CANCELLED])
    expect(STATEMENT_LABELS.en.ends[EnumJobEndLabel.CANCELLED_AFTER_PICKUP]).toBe('Cancelled after pickup')
  })

  test('cross check 5: the "Added after" line carries the month end and the amount', () => {
    expect(STATEMENT_LABELS.en.addedLater('2026-10-31', '€0.50')).toBe('Added after 2026-10-31: €0.50')
    const greek = STATEMENT_LABELS.el.addedLater('2026-10-31', '0,50 €')
    expect(greek).toContain('2026-10-31')
    expect(greek).toContain('0,50 €')
  })

  test('cross check 9: the line for money not linked to a job carries its day', () => {
    expect(STATEMENT_LABELS.en.unlinkedLine('2026-10-22')).toBe('Money not linked to a job, 2026-10-22')
    expect(STATEMENT_LABELS.el.unlinkedLine('2026-10-22')).toContain('2026-10-22')
  })

  test('cross check 8: the fixed column headings in English', () => {
    expect(STATEMENT_LABELS.en.columns).toEqual({
      date: 'Date',
      restaurant: 'Restaurant',
      area: 'Drop off area',
      km: 'Paid km',
      minutes: 'Minutes',
      end: 'Ended',
      deliveryPay: 'Delivery pay',
      tips: 'Tips',
      waiting: 'Waiting',
      cancellation: 'Cancellation',
      removal: 'Removal',
      returnTrip: 'Return trip',
      review: 'Review correction',
      other: 'Other',
      total: 'Total',
      note: 'Note',
    })
  })

  // Value 5, cross check 16: a statement never compares the rider with anyone.
  test.each(STATEMENT_LANGS)(
    'cross check 16 (value 5): %s has no word for an average, a rank or other riders',
    (lang) => {
      const words = allWords(STATEMENT_LABELS[lang]).join(' | ')
      expect(words).not.toMatch(/average|median|mean\b|rank|rating|score|other riders|co-op average|streak/i)
      expect(words).not.toMatch(/μέσος|μέση|μέσο όρο|διάμεσ|κατάταξη|βαθμολογ|άλλοι διανομείς|άλλων διανομέων/i)
    }
  )
})

describe('formatMoney (spec 0050 AC-4, cross check 10)', () => {
  test('euros in Greek: decimal comma, the sign after the number', () => {
    expect(formatMoney(1250, 'EUR', 'el')).toBe('12,50 €')
    expect(formatMoney(5, 'EUR', 'el')).toBe('0,05 €')
    expect(formatMoney(0, 'EUR', 'el')).toBe('0,00 €')
    expect(formatMoney(123456, 'EUR', 'el')).toBe('1234,56 €')
  })

  test('euros in English: decimal point, the sign before the number', () => {
    expect(formatMoney(1250, 'EUR', 'en')).toBe('€12.50')
    expect(formatMoney(5, 'EUR', 'en')).toBe('€0.05')
    expect(formatMoney(0, 'EUR', 'en')).toBe('€0.00')
  })

  test('a negative amount keeps its minus in front', () => {
    expect(formatMoney(-30, 'EUR', 'el')).toBe('-0,30 €')
    expect(formatMoney(-30, 'EUR', 'en')).toBe('-€0.30')
    expect(formatMoney(-1250, 'USD', 'en')).toBe('-12.50 USD')
  })

  test('any other currency prints its code, never a euro sign', () => {
    expect(formatMoney(1250, 'USD', 'en')).toBe('12.50 USD')
    expect(formatMoney(1250, 'USD', 'el')).toBe('12,50 USD')
  })
})

describe('formatAmount (spec 0050 AC-5)', () => {
  test("euros with the language's decimal mark and no symbol", () => {
    expect(formatAmount(1250, 'el')).toBe('12,50')
    expect(formatAmount(1250, 'en')).toBe('12.50')
    expect(formatAmount(0, 'el')).toBe('0,00')
    expect(formatAmount(7, 'en')).toBe('0.07')
    expect(formatAmount(-30, 'el')).toBe('-0,30')
    expect(formatAmount(-30, 'en')).toBe('-0.30')
  })
})

describe('langOf (spec 0050 AC-6, cross check 14)', () => {
  test('en is English', () => {
    expect(langOf('en')).toBe('en')
  })

  test.each([[undefined], [null], [''], ['el'], ['fr'], ['EN'], ['en-GB'], [5], [['en']], [{}]])(
    'anything else (%p) is Greek, the default',
    (value) => {
      expect(langOf(value)).toBe('el')
    }
  )
})
