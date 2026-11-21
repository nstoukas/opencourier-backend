import * as path from 'path'
import PDFDocument from 'pdfkit'
import { INSTANCE_TIMEZONE } from 'src/constants'
import { dayjs } from 'src/core/utils/time'
import { STATEMENT_LABELS, formatMoney } from './statement-labels'
import { StatementModel } from './statement-model'

// Spec 0050 (AC-4): the statement as a PDF. pdfkit, with Noto Sans (OFL, in `assets/fonts` with its licence)
// embedded so Greek prints; A4 landscape so the fixed columns fit; the job table runs across pages with its
// headings repeated, then the totals, the notes, and the footer line on every page.

// Resolved from the working directory: the backend folder in dev and in the Docker image (webpack bundles
// the code, so __dirname does not point at the sources).
export const FONT_DIR = path.resolve(process.cwd(), 'assets/fonts')
const REGULAR = 'NotoSans'
const BOLD = 'NotoSans-Bold'

const MARGIN = 30
const ROW_HEIGHT = 13
const SIZE = 7

// The columns, left to right, with their widths in points (A4 landscape is 842 wide).
// Wide enough that each Greek heading word fits on a line (they wrap at spaces, never inside a word).
const COLUMN_WIDTHS = [60, 64, 56, 46, 36, 88, 52, 62, 44, 46, 44, 46, 48, 38, 50]

const clock = (at: Date) => dayjs(at).tz(INSTANCE_TIMEZONE).format('DD/MM HH:mm')
const hm = (seconds: number | null, notRecorded: string) => {
  if (seconds === null) return notRecorded
  const minutes = Math.round(seconds / 60)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

export function statementPdf(model: StatementModel): Promise<Buffer> {
  const labels = STATEMENT_LABELS[model.lang]
  const money = (cents: number) => formatMoney(cents, model.currencyCode, model.lang)
  // `bufferPages` keeps every page open, so the footer can be written on each at the end.
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: MARGIN, bufferPages: true })
  doc.registerFont(REGULAR, path.join(FONT_DIR, 'NotoSans-Regular.ttf'))
  doc.registerFont(BOLD, path.join(FONT_DIR, 'NotoSans-Bold.ttf'))
  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  const bottom = doc.page.height - MARGIN - 20
  const c = labels.columns
  const headings = [
    c.date,
    c.restaurant,
    c.area,
    c.km,
    c.minutes,
    c.end,
    c.deliveryPay,
    c.tips,
    c.waiting,
    c.cancellation,
    c.removal,
    c.returnTrip,
    c.review,
    c.other,
    c.total,
  ]
  // Money and numbers align right; text left.
  const rightAligned = (index: number) => index >= 3 && index !== 5

  // A job cell is one line, cut with an ellipsis; a heading may wrap onto a second line (Greek words are long).
  const drawRow = (cells: string[], y: number, heading = false) => {
    doc.font(heading ? BOLD : REGULAR).fontSize(SIZE)
    let x = MARGIN
    cells.forEach((cell, index) => {
      const width = COLUMN_WIDTHS[index] ?? 40
      const align = rightAligned(index) ? 'right' : 'left'
      if (heading) {
        doc.text(cell, x + 1, y, { width: width - 2, height: ROW_HEIGHT * 2, ellipsis: true, align })
      } else {
        doc.text(cell, x + 1, y, { width: width - 2, height: ROW_HEIGHT, ellipsis: true, lineBreak: false, align })
      }
      x += width
    })
  }

  // The header.
  doc.font(BOLD).fontSize(14).text(`${labels.title} · ${model.coopName}`, MARGIN, MARGIN)
  doc
    .font(REGULAR)
    .fontSize(9)
    .text(
      `${labels.rider}: ${model.riderName}    ${labels.month}: ${model.month}    ${labels.madeAt}: ${dayjs(model.madeAt)
        .tz(INSTANCE_TIMEZONE)
        .format('YYYY-MM-DD HH:mm')}`
    )
  let y = doc.y + 10

  const headingRow = () => {
    drawRow(headings, y, true)
    y += ROW_HEIGHT * 2
    doc
      .moveTo(MARGIN, y - 2)
      .lineTo(doc.page.width - MARGIN, y - 2)
      .lineWidth(0.5)
      .stroke()
  }
  const room = (needed: number) => {
    if (y + needed > bottom) {
      doc.addPage()
      y = MARGIN
      headingRow()
    }
  }

  headingRow()
  if (model.jobs.length === 0) {
    doc.font(REGULAR).fontSize(SIZE).text(labels.noJobs, MARGIN, y)
    y += ROW_HEIGHT
  }
  for (const job of model.jobs) {
    room(ROW_HEIGHT)
    drawRow(
      [
        clock(job.acceptedAt),
        job.pickupName,
        job.dropoffArea ?? '',
        job.paidKm === null ? '' : job.paidKm.toFixed(1).replace('.', model.lang === 'el' ? ',' : '.'),
        String(job.minutes),
        labels.ends[job.end],
        money(job.deliveryPayCents),
        money(job.tipsCents),
        money(job.waitingCents),
        money(job.cancellationCents),
        money(job.removalCents),
        money(job.returnTripCents),
        money(job.reviewCents),
        job.otherCents === 0 ? money(0) : `${money(job.otherCents)}*`,
        money(job.totalCents),
      ],
      y
    )
    y += ROW_HEIGHT
  }
  // Cross check 8: what each starred Other holds.
  const others = model.jobs.filter((job) => job.otherReasons.length > 0)
  for (const job of others) {
    room(ROW_HEIGHT)
    doc
      .font(REGULAR)
      .fontSize(SIZE)
      .text(
        `* ${clock(job.acceptedAt)} ${job.pickupName}: ${job.otherReasons.map((r) => labels.reasons[r]).join(', ')}`,
        MARGIN,
        y
      )
    y += ROW_HEIGHT
  }

  // Cross check 9: money not linked to a job.
  if (model.unlinked.length > 0) {
    room(ROW_HEIGHT * (model.unlinked.length + 2))
    y += 6
    doc.font(BOLD).fontSize(9).text(labels.unlinkedTitle, MARGIN, y)
    y += ROW_HEIGHT + 2
    for (const line of model.unlinked) {
      doc
        .font(REGULAR)
        .fontSize(SIZE)
        .text(`${line.date}: ${money(line.amountCents)}`, MARGIN, y)
      y += ROW_HEIGHT
    }
  }

  // The totals (AC-2), then the notes.
  const t = model.totals
  const tl = labels.totals
  const totals: Array<[string, string]> = [
    [tl.money, money(t.moneyCents)],
    [tl.dropOffs, String(t.dropOffCount)],
    [tl.paidKm, t.paidKm.toFixed(1).replace('.', model.lang === 'el' ? ',' : '.')],
    [tl.timeWorked, hm(t.workSeconds, labels.notRecorded)],
    [tl.jobTime, hm(t.jobSeconds, labels.notRecorded)],
    [tl.paidWaiting, hm(t.paidWaitSeconds, labels.notRecorded)],
    [tl.unpaidTime, hm(t.unpaidSeconds, labels.notRecorded)],
    [
      tl.perHour,
      t.centsPerHour === null ? (model.timeRecorded ? '—' : labels.notRecorded) : money(Math.round(t.centsPerHour)),
    ],
    [tl.perPaidKm, t.centsPerPaidKm === null ? '—' : money(Math.round(t.centsPerPaidKm))],
  ]
  room(ROW_HEIGHT * (totals.length + 5))
  y += 8
  doc.font(BOLD).fontSize(10).text(labels.totalsTitle, MARGIN, y)
  y += ROW_HEIGHT + 4
  for (const [label, value] of totals) {
    doc.font(REGULAR).fontSize(9).text(label, MARGIN, y, { width: 160 })
    doc
      .font(BOLD)
      .fontSize(9)
      .text(value, MARGIN + 160, y, { width: 120, align: 'right' })
    y += ROW_HEIGHT
  }
  if (!model.timeRecorded) {
    y += 4
    doc.font(REGULAR).fontSize(8).text(labels.notRecordedNote, MARGIN, y, { width: 500 })
    y = doc.y
  }
  if (model.addedLaterCents !== 0) {
    y += 4
    doc
      .font(REGULAR)
      .fontSize(8)
      .text(labels.addedLater(model.monthEnd, money(model.addedLaterCents)), MARGIN, y)
  }

  // The footer on every page.
  const range = doc.bufferedPageRange()
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index)
    // Writing below the bottom margin makes pdfkit open a new page; the footer lives there, so lift it.
    doc.page.margins.bottom = 0
    doc
      .font(REGULAR)
      .fontSize(8)
      .text(`${labels.footer}    ${index + 1} / ${range.count}`, MARGIN, doc.page.height - MARGIN - 10, {
        width: doc.page.width - 2 * MARGIN,
        align: 'center',
        lineBreak: false,
      })
  }
  doc.end()
  return done
}
