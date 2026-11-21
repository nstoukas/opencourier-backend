import { INSTANCE_TIMEZONE } from 'src/constants'
import { dayjs } from 'src/core/utils/time'
import { STATEMENT_LABELS, formatAmount } from './statement-labels'
import { StatementModel } from './statement-model'

// Spec 0050 (AC-5, cross checks 8 and 11): the statement as CSV in adminweb's restaurant statement form.
// UTF-8 with a byte order mark (so spreadsheet programs read Greek), semicolons, euros with the language's
// decimal mark, one row per job with the same columns every month, then the totals block.

const BOM = '﻿'

// Every cell quoted, as adminweb's restaurant statement does (chargesCsv.ts); a leading = + - @ tab or
// carriage return is prefixed with an apostrophe so a spreadsheet never runs a restaurant's name as a formula.
export function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${guarded.replace(/"/g, '""')}"`
}

const hoursDecimal = (seconds: number | null, lang: 'el' | 'en', notRecorded: string): string => {
  if (seconds === null) return notRecorded
  const value = (seconds / 3600).toFixed(2)
  return lang === 'el' ? value.replace('.', ',') : value
}

const decimal = (value: number | null, digits: number, lang: 'el' | 'en'): string => {
  if (value === null) return ''
  const text = value.toFixed(digits)
  return lang === 'el' ? text.replace('.', ',') : text
}

export function statementCsv(model: StatementModel): string {
  const labels = STATEMENT_LABELS[model.lang]
  const c = labels.columns
  const row = (cells: string[]) => cells.map(csvCell).join(';')
  const lines: string[] = []
  lines.push(
    row([
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
      c.note,
    ])
  )
  for (const job of model.jobs) {
    lines.push(
      row([
        dayjs(job.acceptedAt).tz(INSTANCE_TIMEZONE).format('YYYY-MM-DD HH:mm'),
        job.pickupName,
        job.dropoffArea ?? '',
        decimal(job.paidKm, 1, model.lang),
        String(job.minutes),
        labels.ends[job.end],
        formatAmount(job.deliveryPayCents, model.lang),
        formatAmount(job.tipsCents, model.lang),
        formatAmount(job.waitingCents, model.lang),
        formatAmount(job.cancellationCents, model.lang),
        formatAmount(job.removalCents, model.lang),
        formatAmount(job.returnTripCents, model.lang),
        formatAmount(job.reviewCents, model.lang),
        formatAmount(job.otherCents, model.lang),
        formatAmount(job.totalCents, model.lang),
        job.otherReasons.map((reason) => labels.reasons[reason]).join(', '),
      ])
    )
  }
  for (const line of model.unlinked) {
    lines.push(
      row([
        line.date,
        labels.unlinkedLine(line.date),
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
        formatAmount(line.amountCents, model.lang),
        '',
      ])
    )
  }
  const t = model.totals
  const tl = labels.totals
  lines.push('')
  lines.push(row([labels.totalsTitle, '']))
  lines.push(row([tl.money, formatAmount(t.moneyCents, model.lang)]))
  lines.push(row([tl.dropOffs, String(t.dropOffCount)]))
  lines.push(row([tl.paidKm, decimal(t.paidKm, 1, model.lang)]))
  lines.push(row([tl.timeWorked, hoursDecimal(t.workSeconds, model.lang, labels.notRecorded)]))
  lines.push(row([tl.jobTime, hoursDecimal(t.jobSeconds, model.lang, labels.notRecorded)]))
  lines.push(row([tl.paidWaiting, hoursDecimal(t.paidWaitSeconds, model.lang, labels.notRecorded)]))
  lines.push(row([tl.unpaidTime, hoursDecimal(t.unpaidSeconds, model.lang, labels.notRecorded)]))
  lines.push(
    row([
      tl.perHour,
      t.centsPerHour === null
        ? model.timeRecorded
          ? ''
          : labels.notRecorded
        : formatAmount(Math.round(t.centsPerHour), model.lang),
    ])
  )
  lines.push(
    row([tl.perPaidKm, t.centsPerPaidKm === null ? '' : formatAmount(Math.round(t.centsPerPaidKm), model.lang)])
  )
  if (!model.timeRecorded) lines.push(row([labels.notRecordedNote]))
  if (model.addedLaterCents !== 0) {
    lines.push(row([labels.addedLater(model.monthEnd, formatAmount(model.addedLaterCents, model.lang))]))
  }
  lines.push(row([labels.footer]))
  return BOM + lines.join('\r\n') + '\r\n'
}
