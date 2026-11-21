import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { EnumCourierAccountChangeKind, EnumDeliveryEventType } from '@prisma/types'
import { INSTANCE_TIMEZONE } from 'src/constants'
import { dayjs } from 'src/core/utils/time'
import * as errors from 'src/errors'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { StatementLang } from 'src/domains/statement/statement-labels'
import { buildStatement, StatementModel } from 'src/domains/statement/statement-model'
import { statementCsv } from 'src/domains/statement/statement-csv'
import { statementPdf } from 'src/domains/statement/statement-pdf'
import { CourierAccountRepository } from 'src/persistence/repositories/courier-account.repository'
import { PrismaService } from 'src/services/prisma/prisma.service'
import { TimeWorkedRepository } from 'src/persistence/repositories/time-worked.repository'
import { TimeWorkedService, parseMonth, todayIn } from 'src/services/time-worked/time-worked.service'

export type StatementFormat = 'pdf' | 'csv'

export interface StatementFile {
  body: Buffer
  contentType: string
  // Cross check 15: no name in it.
  filename: string
  // Cross check 15: the PDF opens in place, the CSV downloads.
  disposition: 'inline' | 'attachment'
}

export interface StatementDownloadRow {
  id: string
  month: string
  format: string
  createdAt: Date
  adminEmail: string | null
}

export function formatOf(value: unknown): StatementFormat {
  if (value === 'pdf' || value === 'csv') return value
  throw new BadRequestException('format must be pdf or csv.')
}

const monthOf = (at: Date) => dayjs(at).tz(INSTANCE_TIMEZONE).format('YYYY-MM')

// Every month from `first` to `last` (YYYY-MM), newest first.
export function monthsBetween(first: string, last: string): string[] {
  const months: string[] = []
  let cursor = dayjs.utc(`${last}-01`)
  const stop = dayjs.utc(`${first}-01`)
  while (!cursor.isBefore(stop)) {
    months.push(cursor.format('YYYY-MM'))
    cursor = cursor.subtract(1, 'month')
  }
  return months
}

// Spec 0050 (row 76): a rider's monthly statement, as a PDF or a CSV, made from the same functions as the
// Earnings screen (spec 0042) so the totals match it (AC-3). Riders and admins get the same file; an admin
// download is recorded (AC-9) and the rider sees it in "Changes by the co-op" (cross check 14).
@Injectable()
export class StatementService {
  private readonly logger = new Logger(StatementService.name)

  constructor(
    private readonly timeWorkedService: TimeWorkedService,
    private readonly configDomainService: ConfigDomainService,
    private readonly accounts: CourierAccountRepository,
    private readonly prisma: PrismaService,
    // Optional only so tests that build the service by hand keep compiling; Nest always injects it.
    private readonly timeWorkedRepository?: TimeWorkedRepository
  ) {}

  // AC-1, cross check 2: from the month of the earlier of the rider's creation and their first accepted job,
  // to the last complete month (the current month is not offered). Newest first; empty for a new rider.
  async offeredMonths(courierId: string, now = new Date()): Promise<string[]> {
    const courier = await this.prisma.courier.findUnique({ where: { id: courierId }, select: { createdAt: true } })
    if (!courier) throw new errors.NotFoundException('Courier not found')
    const firstJob = await this.prisma.deliveryEvent.findFirst({
      where: { courierId, type: EnumDeliveryEventType.ACCEPTED },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    })
    const firstAt = firstJob && firstJob.createdAt < courier.createdAt ? firstJob.createdAt : courier.createdAt
    const last = dayjs
      .utc(`${todayIn(now).slice(0, 7)}-01`)
      .subtract(1, 'month')
      .format('YYYY-MM')
    // Review fix: a month before the time record began holds no recorded jobs, so it is not offered.
    const recordedFrom = (await this.timeWorkedRepository?.findRecordedFrom()) ?? null
    const firstMonth = monthOf(firstAt)
    const first = recordedFrom && monthOf(recordedFrom) > firstMonth ? monthOf(recordedFrom) : firstMonth
    return first > last ? [] : monthsBetween(first, last)
  }

  // AC-2, AC-3, AC-10: the month's model. A month outside the offered ones answers 400.
  async model(courierId: string, month: unknown, lang: StatementLang, now = new Date()): Promise<StatementModel> {
    const { first, last } = parseMonth(month)
    const asked = first.slice(0, 7)
    if (!(await this.offeredMonths(courierId, now)).includes(asked)) {
      throw new BadRequestException('There is no statement for that month: only complete months since you joined.')
    }
    const courier = await this.prisma.courier.findUnique({
      where: { id: courierId },
      select: { firstName: true, lastName: true },
    })
    if (!courier) throw new errors.NotFoundException('Courier not found')
    // Cross check 6: no reach for a statement; the screen's own function over the whole month.
    const view = await this.timeWorkedService.earnings(
      courierId,
      { from: first, to: last, reachFrom: null },
      { withAdminLabels: false },
      now
    )
    const jobsInShifts = view.shifts.flatMap((shift) => shift.jobs)
    const ids = [...jobsInShifts, ...view.jobsInNoShift].map((job) => job.deliveryId)
    const tips = ids.length
      ? await this.prisma.delivery.findMany({ where: { id: { in: ids } }, select: { id: true, tips: true } })
      : []
    // getDetails returns stored JSON unchecked, so `name` can be missing (as password-reset.service.ts reads it).
    const storedName = ((await this.configDomainService.instanceConfig.getDetails()).name as string | undefined)?.trim()
    return buildStatement({
      month: asked,
      monthStart: dayjs.tz(first, INSTANCE_TIMEZONE).toDate(),
      monthEnd: last,
      // Review fix: the next month's own first day in Athens time (adding a month to an instant is an hour off
      // in October and March when the server is not on Athens time).
      nextMonthStart: dayjs.tz(dayjs.utc(first).add(1, 'month').format('YYYY-MM-DD'), INSTANCE_TIMEZONE).toDate(),
      lang,
      coopName: storedName || (lang === 'el' ? 'Ο συνεταιρισμός' : 'The co-op'),
      riderName: `${courier.firstName} ${courier.lastName}`.trim(),
      madeAt: now,
      source: {
        days: view.days,
        jobsInShifts,
        jobsInNoShift: view.jobsInNoShift,
        recordedFrom: view.recordedFrom,
        currencyCode: view.currencyCode,
      },
      tipsByDelivery: new Map(tips.map((delivery) => [delivery.id, delivery.tips])),
    })
  }

  async file(
    courierId: string,
    month: unknown,
    format: StatementFormat,
    lang: StatementLang,
    now = new Date()
  ): Promise<StatementFile> {
    const model = await this.model(courierId, month, lang, now)
    const filename = `statement-${model.month}.${format}`
    if (format === 'csv') {
      return {
        body: Buffer.from(statementCsv(model), 'utf8'),
        contentType: 'text/csv; charset=utf-8',
        filename,
        disposition: 'attachment',
      }
    }
    return { body: await statementPdf(model), contentType: 'application/pdf', filename, disposition: 'inline' }
  }

  // AC-9, cross check 14: the same file for an admin, recorded once it is made (a refused month leaves no row).
  async fileForAdmin(
    courierId: string,
    month: unknown,
    format: StatementFormat,
    lang: StatementLang,
    adminUserId: string,
    now = new Date()
  ): Promise<StatementFile> {
    const file = await this.file(courierId, month, format, lang, now)
    const asked = file.filename.slice('statement-'.length, 'statement-'.length + 7)
    // Review fix: the download row and the rider's notice are written together, or neither (then no file).
    await this.prisma.$transaction(async (tx) => {
      await tx.statementDownload.create({ data: { adminUserId, courierId, month: asked, format } })
      await this.accounts.record(
        [
          {
            courierId,
            actorUserId: adminUserId,
            actorIsRider: false,
            kind: EnumCourierAccountChangeKind.STATEMENT_DOWNLOADED,
            field: 'statement',
            newValue: `${asked} ${format.toUpperCase()}`,
          },
        ],
        tx
      )
    })
    this.logger.log(`Admin ${adminUserId} downloaded the ${asked} ${format} statement of courier ${courierId}`)
    return file
  }

  // AC-9: this rider's statements downloaded by admins, newest first.
  async downloads(courierId: string): Promise<StatementDownloadRow[]> {
    const rows = await this.prisma.statementDownload.findMany({
      where: { courierId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // Review fix: the newest 50.
      take: 50,
      include: { admin: { select: { email: true } } },
    })
    return rows.map((row) => ({
      id: row.id,
      month: row.month,
      format: row.format,
      createdAt: row.createdAt,
      adminEmail: row.admin.email,
    }))
  }
}
