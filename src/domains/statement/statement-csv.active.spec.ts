import { EnumCourierCompensationReason } from '@prisma/types'
import { EnumJobEndLabel } from 'src/domains/time-worked/worked-shifts'
import { csvCell, statementCsv } from './statement-csv'
import { StatementModel } from './statement-model'
import { statementModel, statementRow } from './statement-test-fixtures'

// Spec 0050 (AC-5, AC-6, cross checks 3, 5, 8, 9, 11): the statement as CSV.

const BOM = '﻿'

// The file as rows of cells: the mark stripped, split on CRLF, each quoted cell unquoted.
function parse(csv: string): string[][] {
  return csv
    .slice(1)
    .split('\r\n')
    .map((line) => {
      if (line === '') return []
      const cells: string[] = []
      const pattern = /"((?:[^"]|"")*)"(;|$)/y
      let match = pattern.exec(line)
      while (match) {
        cells.push((match[1] ?? '').replace(/""/g, '"'))
        if (match[2] === '') break
        match = pattern.exec(line)
      }
      return cells
    })
}

const EN_HEADINGS = [
  'Date',
  'Restaurant',
  'Drop off area',
  'Paid km',
  'Minutes',
  'Ended',
  'Delivery pay',
  'Tips',
  'Waiting',
  'Cancellation',
  'Removal',
  'Return trip',
  'Review correction',
  'Other',
  'Total',
  'Note',
]

const EL_HEADINGS = [
  'Ημερομηνία',
  'Κατάστημα',
  'Περιοχή παράδοσης',
  'Πληρωμένα χλμ',
  'Λεπτά',
  'Κατάληξη',
  'Αμοιβή διανομής',
  'Φιλοδωρήματα',
  'Αναμονή',
  'Ακύρωση',
  'Αφαίρεση',
  'Επιστροφή',
  'Διόρθωση',
  'Άλλο',
  'Σύνολο',
  'Σημείωση',
]

const en = (overrides: Partial<StatementModel> = {}) => statementModel({ lang: 'en', ...overrides })

describe('csvCell (spec 0050 AC-5)', () => {
  test('every cell is quoted, an empty one too', () => {
    expect(csvCell('Souvlaki Bar')).toBe('"Souvlaki Bar"')
    expect(csvCell('')).toBe('""')
    expect(csvCell('12,50')).toBe('"12,50"')
  })

  test('a quote inside a cell is doubled', () => {
    expect(csvCell('The "Best" Grill')).toBe('"The ""Best"" Grill"')
  })

  test.each([
    ['=', '=SUM(A1:A9)'],
    ['+', '+30210000000'],
    ['-', '-cmd'],
    ['@', '@import'],
    ['a tab', '\tx'],
    ['a carriage return', '\rx'],
  ])('a cell starting with %s gets an apostrophe in front, so a spreadsheet never runs it', (_name, value) => {
    expect(csvCell(value)).toBe(`"'${value}"`)
  })

  // Review fix (2026-11-21): a plain number stays a number, so a spreadsheet can add it up.
  test.each([['-0.55'], ['-0,55'], ['-12'], ['-1234.5'], ['-0'], ['0.55'], ['12,50'], ['7']])(
    'review fix: the plain number %s is not guarded',
    (value) => {
      expect(csvCell(value)).toBe(`"${value}"`)
    }
  )

  test.each([
    ['a word', '-cmd'],
    ['a formula after a number', '-0.55+A1'],
    ['a sum', '-1-1'],
    ['two minus signs', '--5'],
    ['a minus alone', '-'],
    ['a number then a call', '-2*SUM(A1:A9)'],
    ['a number then text', '-5 apples'],
    ['a second line', '-5\n=A1'],
    ['a cell reference', '-A1'],
    ['two decimal marks', '-1.2.3'],
    ['a thousands mark', '-1.234,50'],
    ['no digit before the mark', '-.5'],
    ['an exponent', '-1e5'],
    ['a space first', '- 5'],
  ])('review fix: text starting with - that is not a plain number (%s) is still guarded', (_name, value) => {
    expect(csvCell(value)).toBe(`"'${value}"`)
  })

  test.each([['+0.55'], ['+5'], ['=5'], ['=-0.55'], ['@5']])(
    'review fix: %s starts with another formula mark, so it is still guarded',
    (value) => {
      expect(csvCell(value)).toBe(`"'${value}"`)
    }
  )

  test('review fix: in a whole file a correction that takes money back is a plain negative amount, in each language', () => {
    const jobs = [statementRow({ reviewCents: -55, totalCents: 475 })]
    const english = parse(statementCsv(en({ jobs })))
    const greek = parse(statementCsv(statementModel({ jobs })))

    // Review correction is the 13th column.
    expect(english[1]?.[12]).toBe('-0.55')
    expect(greek[1]?.[12]).toBe('-0,55')
  })

  test('review fix: a restaurant named like a formula is still guarded in a whole file', () => {
    const rows = parse(statementCsv(en({ jobs: [statementRow({ pickupName: '-1+cmd|calc' })] })))

    expect(rows[1]?.[1]).toBe("'-1+cmd|calc")
  })

  test('a cell with one of those marks later in it is left alone', () => {
    expect(csvCell('A=B')).toBe('"A=B"')
    expect(csvCell('Fish + Chips')).toBe('"Fish + Chips"')
    expect(csvCell('info@coop.gr')).toBe('"info@coop.gr"')
    expect(csvCell('Agios-Nikolaos')).toBe('"Agios-Nikolaos"')
  })
})

describe('statementCsv: the form of the file (spec 0050 AC-5)', () => {
  test('starts with the UTF-8 byte order mark, once', () => {
    const csv = statementCsv(statementModel())

    expect(csv.startsWith(BOM)).toBe(true)
    expect(csv.slice(1)).not.toContain(BOM)
    expect([...Buffer.from(csv, 'utf8').subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  })

  test('lines end with CRLF, the last one too, and there is no bare line feed', () => {
    const csv = statementCsv(statementModel())

    expect(csv.endsWith('\r\n')).toBe(true)
    expect(csv.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
  })

  test('every cell of every line is quoted and separated by semicolons', () => {
    const csv = statementCsv(
      en({
        jobs: [
          statementRow(),
          statementRow({ deliveryId: 'del-2', pickupName: 'The "Best"; Grill', dropoffArea: null }),
        ],
        unlinked: [{ date: '2026-10-22', amountCents: 120 }],
        addedLaterCents: 50,
        timeRecorded: false,
      })
    )

    const lines = csv.slice(1).split('\r\n')
    for (const line of lines) {
      if (line === '') continue
      expect(line).toMatch(/^"(?:[^"]|"")*"(?:;"(?:[^"]|"")*")*$/)
    }
    // A name holding a quote and a semicolon stays one cell.
    expect(parse(csv)[2]?.[1]).toBe('The "Best"; Grill')
    expect(parse(csv)[2]).toHaveLength(16)
  })

  test('a restaurant name that looks like a formula is guarded in the file', () => {
    const csv = statementCsv(
      en({ jobs: [statementRow({ pickupName: '=HYPERLINK("http://x")', dropoffArea: '@home' })] })
    )

    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`)
    expect(csv).toContain(`"'@home"`)
    expect(csv).not.toContain(';"=HYPERLINK')
  })
})

describe('statementCsv: the job rows (spec 0050 AC-2, AC-5, cross check 8)', () => {
  test('the first line is the fixed headings, in English', () => {
    expect(parse(statementCsv(en()))[0]).toEqual(EN_HEADINGS)
  })

  test('the first line is the fixed headings, in Greek', () => {
    expect(parse(statementCsv(statementModel()))[0]).toEqual(EL_HEADINGS)
  })

  test('cross check 8: every month has the same columns, an empty month and a full one alike', () => {
    const empty = parse(statementCsv(en({ jobs: [] })))
    const full = parse(
      statementCsv(
        en({
          jobs: [
            statementRow({
              otherCents: 150,
              otherReasons: [EnumCourierCompensationReason.REASSIGNMENT],
              cancellationCents: 200,
              removalCents: 30,
              returnTripCents: 110,
              reviewCents: -55,
            }),
          ],
        })
      )
    )

    expect(empty[0]).toEqual(EN_HEADINGS)
    expect(full[0]).toEqual(EN_HEADINGS)
    expect(full[1]).toHaveLength(EN_HEADINGS.length)
  })

  test('one row per job, in English: Athens time, decimal points, each pay part in its column', () => {
    const rows = parse(
      statementCsv(
        en({
          jobs: [
            statementRow(),
            statementRow({
              deliveryId: 'del-2',
              // 31 October 23:30 in Athens (UTC+2 after the clocks change).
              acceptedAt: new Date('2026-10-31T21:30:00Z'),
              pickupName: 'Pizza Roma',
              dropoffArea: null,
              paidKm: null,
              minutes: 10,
              end: EnumJobEndLabel.REASSIGNED,
              deliveryPayCents: 0,
              tipsCents: 0,
              waitingCents: 0,
              cancellationCents: 200,
              removalCents: 30,
              returnTripCents: 110,
              reviewCents: 55,
              otherCents: 150,
              otherReasons: [EnumCourierCompensationReason.REASSIGNMENT],
              totalCents: 545,
            }),
          ],
        })
      )
    )

    expect(rows[1]).toEqual([
      '2026-10-05 10:30',
      'Souvlaki Bar',
      'Ermou',
      '2.5',
      '30',
      'Delivered',
      '3.50',
      '1.00',
      '0.80',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '5.30',
      '',
    ])
    expect(rows[2]).toEqual([
      '2026-10-31 23:30',
      'Pizza Roma',
      '',
      '',
      '10',
      'Reassigned',
      '0.00',
      '0.00',
      '0.00',
      '2.00',
      '0.30',
      '1.10',
      '0.55',
      '1.50',
      '5.45',
      'Reassignment',
    ])
  })

  test('the same row in Greek: decimal commas and Greek words', () => {
    const rows = parse(
      statementCsv(
        statementModel({
          jobs: [
            statementRow({
              pickupName: 'Το Κουτούκι',
              dropoffArea: 'Ιάσονος',
              otherCents: 150,
              otherReasons: [EnumCourierCompensationReason.REASSIGNMENT],
              totalCents: 680,
            }),
          ],
        })
      )
    )

    expect(rows[1]).toEqual([
      '2026-10-05 10:30',
      'Το Κουτούκι',
      'Ιάσονος',
      '2,5',
      '30',
      'Παραδόθηκε',
      '3,50',
      '1,00',
      '0,80',
      '0,00',
      '0,00',
      '0,00',
      '0,00',
      '1,50',
      '6,80',
      'Αλλαγή διανομέα',
    ])
  })

  test('no amount in an English file has a comma and none in a Greek file has a point', () => {
    const jobs = [statementRow({ deliveryPayCents: 123456, totalCents: 123636 })]
    const english = parse(statementCsv(en({ jobs })))[1]?.slice(6, 15) ?? []
    const greek = parse(statementCsv(statementModel({ jobs })))[1]?.slice(6, 15) ?? []

    expect(english[0]).toBe('1234.56')
    expect(greek[0]).toBe('1234,56')
    for (const amount of english) expect(amount).toMatch(/^\d+\.\d{2}$/)
    for (const amount of greek) expect(amount).toMatch(/^\d+,\d{2}$/)
  })

  test('cross check 9: money not linked to a job is a row after the jobs, with its day and its amount in Total', () => {
    const rows = parse(
      statementCsv(en({ jobs: [statementRow()], unlinked: [{ date: '2026-10-22', amountCents: 120 }] }))
    )

    expect(rows[2]).toEqual([
      '2026-10-22',
      'Money not linked to a job, 2026-10-22',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '1.20',
      '',
    ])
  })
})

describe('statementCsv: the totals block (spec 0050 AC-2, AC-5, cross checks 3, 5, 11)', () => {
  // The lines after the blank line that follows the rows.
  const totalsOf = (model: StatementModel) => {
    const rows = parse(statementCsv(model))
    const blank = rows.findIndex((cells) => cells.length === 0)
    return rows.slice(blank + 1).filter((cells) => cells.length > 0)
  }

  test('a blank line, then the totals in a fixed order, then the footer', () => {
    const rows = parse(statementCsv(en({ jobs: [statementRow()] })))

    expect(rows[2]).toEqual([])
    expect(totalsOf(en())).toEqual([
      ['Month totals', ''],
      ['Money', '5.30'],
      ['Drop offs', '1'],
      ['Paid km', '2.5'],
      // Cross check 11: decimal hours with two decimals. 32400 s = 9 h, 7560 s = 2.1 h, 240 s = 0.07 h.
      ['Time worked', '9.00'],
      ['Job time', '2.10'],
      ['Paid waiting', '0.07'],
      ['Unpaid time', '6.83'],
      ['Per hour worked', '3.03'],
      ['Per paid km', '2.03'],
      ['Your record of work. It is not an invoice.'],
    ])
  })

  test('the same block in Greek, with decimal commas', () => {
    expect(totalsOf(statementModel())).toEqual([
      ['Σύνολα μήνα', ''],
      ['Χρήματα', '5,30'],
      ['Παραδόσεις', '1'],
      ['Πληρωμένα χλμ', '2,5'],
      ['Χρόνος εργασίας', '9,00'],
      ['Χρόνος σε διανομή', '2,10'],
      ['Πληρωμένη αναμονή', '0,07'],
      ['Απλήρωτος χρόνος', '6,83'],
      ['Ανά ώρα εργασίας', '3,03'],
      ['Ανά πληρωμένο χλμ', '2,03'],
      ['Το αρχείο της εργασίας σας. Δεν είναι τιμολόγιο.'],
    ])
  })

  test('cross check 3: with time not recorded every time total and € per hour read "not recorded", never 0, with the note', () => {
    const totals = totalsOf(
      en({
        timeRecorded: false,
        totals: {
          moneyCents: 530,
          dropOffCount: 1,
          paidKm: 2.5,
          workSeconds: null,
          jobSeconds: null,
          paidWaitSeconds: null,
          unpaidSeconds: null,
          centsPerHour: null,
          centsPerPaidKm: 203,
        },
      })
    )

    expect(totals.slice(4, 9)).toEqual([
      ['Time worked', 'not recorded'],
      ['Job time', 'not recorded'],
      ['Paid waiting', 'not recorded'],
      ['Unpaid time', 'not recorded'],
      ['Per hour worked', 'not recorded'],
    ])
    expect(totals[1]).toEqual(['Money', '5.30'])
    expect(totals[9]).toEqual(['Per paid km', '2.03'])
    // Review ruling (2026-11-21): the note names the jobs too, not only the hours.
    expect(totals[10]).toEqual([
      'Work was not yet recorded for the whole month: jobs and hours from before the record began are not shown.',
    ])
    expect(totals[totals.length - 1]).toEqual(['Your record of work. It is not an invoice.'])
  })

  test('review fix: the Greek file carries the Greek note about jobs and hours from before the record began', () => {
    const csv = statementCsv(statementModel({ timeRecorded: false }))

    expect(parse(csv)).toContainEqual([
      'Η εργασία δεν καταγραφόταν ακόμη για όλο τον μήνα: οι διανομές και οι ώρες πριν από την έναρξη της καταγραφής δεν εμφανίζονται.',
    ])
    expect(csv).not.toContain('Work was not yet recorded')
  })

  test('review fix: with time recorded for the whole month there is no such note', () => {
    expect(statementCsv(en({ timeRecorded: true }))).not.toContain('not yet recorded')
    expect(statementCsv(statementModel({ timeRecorded: true }))).not.toContain('δεν καταγραφόταν')
  })

  test('with time recorded there is no "not recorded" anywhere, and a rate with too little behind it is left empty', () => {
    const model = en({
      jobs: [],
      totals: {
        moneyCents: 0,
        dropOffCount: 0,
        paidKm: 0,
        workSeconds: 0,
        jobSeconds: 0,
        paidWaitSeconds: 0,
        unpaidSeconds: 0,
        centsPerHour: null,
        centsPerPaidKm: null,
      },
    })
    const totals = totalsOf(model)

    expect(statementCsv(model)).not.toContain('not recorded')
    expect(totals[4]).toEqual(['Time worked', '0.00'])
    expect(totals[8]).toEqual(['Per hour worked', ''])
    expect(totals[9]).toEqual(['Per paid km', ''])
  })

  test('cross check 5: the "Added after" line is there when money was added later, before the footer', () => {
    const totals = totalsOf(en({ addedLaterCents: 50 }))

    expect(totals[totals.length - 2]).toEqual(['Added after 2026-10-31: 0.50'])
    expect(totals[totals.length - 1]).toEqual(['Your record of work. It is not an invoice.'])
  })

  test('cross check 5: no "Added after" line when nothing was added later', () => {
    expect(statementCsv(en({ addedLaterCents: 0 }))).not.toContain('Added after')
  })

  test('AC-10: an empty month is the headings, the totals at zero and the footer', () => {
    const rows = parse(
      statementCsv(
        en({
          jobs: [],
          totals: {
            moneyCents: 0,
            dropOffCount: 0,
            paidKm: 0,
            workSeconds: 0,
            jobSeconds: 0,
            paidWaitSeconds: 0,
            unpaidSeconds: 0,
            centsPerHour: null,
            centsPerPaidKm: null,
          },
        })
      )
    )

    expect(rows[0]).toEqual(EN_HEADINGS)
    expect(rows[1]).toEqual([])
    expect(rows[2]).toEqual(['Month totals', ''])
    expect(rows[3]).toEqual(['Money', '0.00'])
    expect(rows[4]).toEqual(['Drop offs', '0'])
  })

  // Value 5, cross check 16.
  test('cross check 16 (value 5): the file names no average, median or other rider', () => {
    const csv = statementCsv(en({ unlinked: [{ date: '2026-10-22', amountCents: 120 }], addedLaterCents: 50 }))

    expect(csv).not.toMatch(/average|median|co-op|other riders|rank/i)
  })
})
