import * as fs from 'fs'
import * as path from 'path'
import { EnumCourierCompensationReason } from '@prisma/types'
import { EnumJobEndLabel } from 'src/domains/time-worked/worked-shifts'
import { FONT_DIR, statementPdf } from './statement-pdf'
import { statementModel, statementRow } from './statement-test-fixtures'

// Spec 0050 (AC-4): the statement as a PDF. The page text is compressed and written in the embedded font's
// own glyph numbers, so these tests read the file's structure: its type, page size, page count and fonts.

const text = (pdf: Buffer) => pdf.toString('latin1')
// Page objects only: "/Type /Page" not followed by an "s" (the page tree is "/Type /Pages").
const pageCount = (pdf: Buffer) => (text(pdf).match(/\/Type \/Page(?!s)/g) ?? []).length
const mediaBoxes = (pdf: Buffer) =>
  [...text(pdf).matchAll(/\/MediaBox \[([\d. ]+)\]/g)].map((match) => (match[1] ?? '').split(' ').map(Number))

const manyJobs = (count: number) =>
  Array.from({ length: count }, (_unused, index) =>
    statementRow({
      deliveryId: `del-${index}`,
      acceptedAt: new Date(Date.parse('2026-10-01T07:00:00Z') + index * 20 * 60 * 1000),
      pickupName: `Ψητοπωλείο ${index}`,
    })
  )

describe('statementPdf (spec 0050 AC-4)', () => {
  test("AC-4: the Noto Sans fonts and their OFL licence ship in the backend's assets", () => {
    expect(FONT_DIR).toBe(path.resolve(process.cwd(), 'assets/fonts'))
    expect(fs.existsSync(path.join(FONT_DIR, 'NotoSans-Regular.ttf'))).toBe(true)
    expect(fs.existsSync(path.join(FONT_DIR, 'NotoSans-Bold.ttf'))).toBe(true)
    expect(fs.readFileSync(path.join(FONT_DIR, 'OFL.txt'), 'utf8')).toMatch(/SIL OPEN FONT LICENSE/i)
  })

  test('is a Buffer that starts with %PDF and ends with %%EOF', async () => {
    const pdf = await statementPdf(statementModel())

    expect(Buffer.isBuffer(pdf)).toBe(true)
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(text(pdf).trimEnd().endsWith('%%EOF')).toBe(true)
    expect(pdf.length).toBeGreaterThan(2000)
  })

  test('every page is A4 on its side (841.89 by 595.28 points)', async () => {
    const pdf = await statementPdf(statementModel({ jobs: manyJobs(90) }))

    const boxes = mediaBoxes(pdf)
    expect(boxes.length).toBe(pageCount(pdf))
    expect(boxes.length).toBeGreaterThan(1)
    for (const box of boxes) {
      expect(box[0]).toBe(0)
      expect(box[1]).toBe(0)
      expect(box[2]).toBeCloseTo(841.89, 1)
      expect(box[3]).toBeCloseTo(595.28, 1)
    }
  })

  test('Greek prints with the embedded Noto Sans, regular and bold, never a built in font', async () => {
    const pdf = await statementPdf(
      statementModel({
        lang: 'el',
        coopName: 'Συνεταιρισμός Διανομέων Βόλου',
        riderName: 'Γιώργος Ξενάκης-Ψαρράς',
        jobs: [statementRow({ pickupName: 'Το Κουτούκι της Ευτέρπης', dropoffArea: 'Ιάσονος' })],
      })
    )

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(text(pdf)).toMatch(/\/FontName \/[A-Z]+\+NotoSans-Regular/)
    expect(text(pdf)).toMatch(/\/FontName \/[A-Z]+\+NotoSans-Bold/)
    expect(text(pdf)).toContain('/FontFile2')
    expect(text(pdf)).not.toMatch(/\/BaseFont \/(Helvetica|Times|Courier)/)
  })

  test('English prints too', async () => {
    const pdf = await statementPdf(statementModel({ lang: 'en', coopName: 'Volos Riders', riderName: 'Nikos Rider' }))

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(pageCount(pdf)).toBe(1)
  })

  test('AC-10: an empty month is still one page', async () => {
    const pdf = await statementPdf(
      statementModel({
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

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(pageCount(pdf)).toBe(1)
  })

  test('a few jobs fit on one page; the footer never opens an extra one', async () => {
    expect(pageCount(await statementPdf(statementModel({ jobs: manyJobs(5) })))).toBe(1)
  })

  test('many jobs run the table across several pages, more pages for more jobs', async () => {
    const ninety = pageCount(await statementPdf(statementModel({ jobs: manyJobs(90) })))
    const fourHundred = pageCount(await statementPdf(statementModel({ jobs: manyJobs(400) })))

    expect(ninety).toBeGreaterThanOrEqual(3)
    expect(fourHundred).toBeGreaterThan(ninety)
    // 13 points a row on a 595 point page: never fewer than 30 rows a page, so 400 jobs need at most 14.
    expect(fourHundred).toBeLessThanOrEqual(14)
  })

  test('every part at once prints without throwing: other payments, money not linked, time not recorded, added later', async () => {
    const pdf = await statementPdf(
      statementModel({
        jobs: [
          statementRow({
            otherCents: 150,
            otherReasons: [EnumCourierCompensationReason.REASSIGNMENT],
            end: EnumJobEndLabel.REASSIGNED,
            dropoffArea: null,
            paidKm: null,
            reviewCents: -55,
          }),
          statementRow({
            deliveryId: 'del-long',
            pickupName: 'Ένα πάρα πολύ μεγάλο όνομα καταστήματος που δεν χωράει σε καμία στήλη του πίνακα',
            end: EnumJobEndLabel.CANCELLED_AFTER_PICKUP,
          }),
        ],
        unlinked: [
          { date: '2026-10-22', amountCents: 120 },
          { date: '2026-10-23', amountCents: -40 },
        ],
        timeRecorded: false,
        totals: {
          moneyCents: 610,
          dropOffCount: 1,
          paidKm: 2.5,
          workSeconds: null,
          jobSeconds: null,
          paidWaitSeconds: null,
          unpaidSeconds: null,
          centsPerHour: null,
          centsPerPaidKm: null,
        },
        addedLaterCents: 50,
      })
    )

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(pageCount(pdf)).toBe(1)
  })

  test('another currency prints (its code instead of the euro sign)', async () => {
    const pdf = await statementPdf(statementModel({ lang: 'en', currencyCode: 'USD' }))

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })
})
