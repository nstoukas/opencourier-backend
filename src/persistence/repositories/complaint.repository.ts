import { Injectable } from '@nestjs/common'
import {
  EnumComplaintAbout,
  EnumComplaintCategory,
  EnumComplaintFiledBy,
  EnumComplaintStatus,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  Prisma,
} from '@prisma/types'
import { buildPagination } from 'src/rest-api/Paginator'
import { PaginatedResult } from 'src/core/models/Pagination'
import { isUniqueConstraintError } from 'src/prisma.util'
import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'

// An admin's label: email, else username, else id (the spec 0036 rule). Only admin DTOs read it.
const ADMIN_LABEL = { select: { id: true, email: true, username: true } } as const
const RIDER_NAME = { select: { id: true, firstName: true, lastName: true } } as const

// What every reader needs besides the row. Each DTO then copies only the fields its audience may see
// (cross check 7): a courier or partner DTO never reads filerAdmin, decidedBy, withdrawnBy or
// replyEnteredBy. `satisfies` checks the object against Prisma's type without widening it.
const COMPLAINT_INCLUDE = {
  // Enough to recognise the job; nothing about the customer.
  delivery: { select: { id: true, pickupBusinessName: true, createdAt: true, status: true } },
  filerCourier: RIDER_NAME,
  filerPartner: { select: { id: true, name: true } },
  filerAdmin: ADMIN_LABEL,
  aboutCourier: { select: { id: true, firstName: true, lastName: true, deactivatedAt: true } },
  replyEnteredBy: ADMIN_LABEL,
  decidedBy: ADMIN_LABEL,
  withdrawnBy: ADMIN_LABEL,
} satisfies Prisma.ComplaintInclude

// `GetPayload` = the row's type plus the relations named in the include above.
export type ComplaintRecord = Prisma.ComplaintGetPayload<{ include: typeof COMPLAINT_INCLUDE }>

type ComplaintOrder = NonNullable<Prisma.ComplaintFindManyArgs['orderBy']>
type PageOptions = { page?: number; perPage?: number }

export type CreateComplaintInput = {
  deliveryId: string
  filedBy: EnumComplaintFiledBy
  filerCourierId?: string | null
  filerPartnerId?: string | null
  filerAdminId?: string | null
  about: EnumComplaintAbout
  aboutCourierId?: string | null
  category: EnumComplaintCategory
  text: string
  status: EnumComplaintStatus
  openFor: string | null
  // Slice 2: the stored photo's key, only on a rider's filing.
  photoKey?: string | null
}

// What a delivery tells a filing check: its owner, status, age and rider.
export type ComplaintDeliveryFacts = {
  id: string
  partnerId: string | null
  status: EnumDeliveryStatus
  createdAt: Date
  courierId: string | null
}

// Spec 0052 (row 83). Every status change is one conditional write (`WHERE id = ? AND status = ...`), so
// a reply, a decision and a withdrawal racing each other leave exactly one winner; the caller turns a
// miss into a 409. Nothing in this file counts or groups complaints by rider, and no matcher, fairness
// or pay code may import it (AC-8; a guard test fails if one does).
@Injectable()
export class ComplaintRepository extends EntityRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  async findDeliveryFacts(deliveryId: string): Promise<ComplaintDeliveryFacts | null> {
    return this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: { id: true, partnerId: true, status: true, createdAt: true, courierId: true },
    })
  }

  // When this rider accepted this delivery (successful ACCEPTED events), oldest first: the rider's own
  // jobs in Earnings (spec 0042) are exactly the deliveries they accepted.
  async findAcceptTimes(deliveryId: string, courierId: string): Promise<Date[]> {
    const rows = await this.prisma.deliveryEvent.findMany({
      where: { deliveryId, courierId, type: EnumDeliveryEventType.ACCEPTED, transitionSuccessful: true },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      select: { occurredAt: true },
    })
    return rows.map((row) => row.occurredAt)
  }

  // Cross check 3: every rider who accepted this delivery, newest accept first (no duplicates).
  async findRidersWhoAccepted(deliveryId: string): Promise<string[]> {
    const rows = await this.prisma.deliveryEvent.findMany({
      where: { deliveryId, type: EnumDeliveryEventType.ACCEPTED, transitionSuccessful: true, courierId: { not: null } },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      select: { courierId: true },
    })
    const ids: string[] = []
    for (const row of rows) if (row.courierId && !ids.includes(row.courierId)) ids.push(row.courierId)
    return ids
  }

  // The names of these riders, in the order given (the admin's picker when filing, cross check 3).
  async findRiderNames(courierIds: string[]): Promise<{ id: string; name: string }[]> {
    if (courierIds.length === 0) return []
    const rows = await this.prisma.courier.findMany({
      where: { id: { in: courierIds } },
      select: { id: true, firstName: true, lastName: true },
    })
    const byId = new Map(rows.map((row) => [row.id, `${row.firstName} ${row.lastName}`.trim()]))
    return courierIds.flatMap((id) => {
      const name = byId.get(id)
      return name === undefined ? [] : [{ id, name }]
    })
  }

  // Null when the unique `openFor` refused it: this filer already has an open complaint here.
  async create(input: CreateComplaintInput): Promise<ComplaintRecord | null> {
    try {
      const created = await this.prisma.complaint.create({ data: input, include: COMPLAINT_INCLUDE })
      return created
    } catch (error) {
      if (error instanceof Error && isUniqueConstraintError(error)) return null
      throw error
    }
  }

  async findById(id: string): Promise<ComplaintRecord | null> {
    return this.prisma.complaint.findUnique({ where: { id }, include: COMPLAINT_INCLUDE })
  }

  // AC-5: the reply, stored once. Only while AWAITING_REPLY; `riderReply: null` makes "once" hold even
  // if the status were ever moved back. `replyEnteredByUserId` is set only for an admin entering a
  // deactivated rider's reply (cross check 2). False when it lost (already replied, decided, withdrawn).
  async reply(id: string, reply: string, replyEnteredByUserId: string | null): Promise<boolean> {
    const { count } = await this.prisma.complaint.updateMany({
      where: { id, status: EnumComplaintStatus.AWAITING_REPLY, riderReply: null },
      data: { riderReply: reply, repliedAt: new Date(), replyEnteredByUserId, status: EnumComplaintStatus.OPEN },
    })
    return count === 1
  }

  // AC-5: only from OPEN, so a complaint about a rider can never be decided before the reply.
  async decide(id: string, outcome: string, decidedByUserId: string): Promise<boolean> {
    const { count } = await this.prisma.complaint.updateMany({
      where: { id, status: EnumComplaintStatus.OPEN },
      data: { status: EnumComplaintStatus.DECIDED, outcome, decidedAt: new Date(), decidedByUserId, openFor: null },
    })
    return count === 1
  }

  // AC-5, cross check 6: only admins, at any time while it is still open (waiting for a reply or not).
  async withdraw(id: string, reason: string, withdrawnByUserId: string): Promise<boolean> {
    const { count } = await this.prisma.complaint.updateMany({
      where: { id, status: { in: [EnumComplaintStatus.OPEN, EnumComplaintStatus.AWAITING_REPLY] } },
      data: {
        status: EnumComplaintStatus.WITHDRAWN,
        withdrawnReason: reason,
        withdrawnAt: new Date(),
        withdrawnByUserId,
        openFor: null,
      },
    })
    return count === 1
  }

  // AC-7: a rider's own page: the complaints they filed and the complaints about them, newest first.
  async findPageForCourier(courierId: string, options: PageOptions): Promise<PaginatedResult<ComplaintRecord>> {
    return this.findPage({ OR: [{ filerCourierId: courierId }, { aboutCourierId: courierId }] }, options)
  }

  // AC-7: a restaurant reads only the complaints it filed (cross check 5: never one about it).
  async findPageForPartner(
    partnerId: string,
    deliveryId: string | undefined,
    options: PageOptions
  ): Promise<PaginatedResult<ComplaintRecord>> {
    return this.findPage(deliveryId ? { filerPartnerId: partnerId, deliveryId } : { filerPartnerId: partnerId }, options)
  }

  // AC-6, cross check 13: newest first, filtered by status and `about` only. This query takes no rider
  // id: the admin list is never filtered, grouped, counted or sorted by rider.
  async findPageForAdmin(
    filters: { status?: EnumComplaintStatus; about?: EnumComplaintAbout },
    options: PageOptions
  ): Promise<PaginatedResult<ComplaintRecord>> {
    const where: Prisma.ComplaintWhereInput = {}
    if (filters.status) where.status = filters.status
    if (filters.about) where.about = filters.about
    return this.findPage(where, options)
  }

  private async findPage(where: Prisma.ComplaintWhereInput, options: PageOptions): Promise<PaginatedResult<ComplaintRecord>> {
    const page = options.page ?? 1
    const perPage = options.perPage ?? 20
    const orderBy: ComplaintOrder = [{ createdAt: 'desc' }, { id: 'desc' }]
    const [total, rows] = await Promise.all([
      this.prisma.complaint.count({ where }),
      this.prisma.complaint.findMany({ where, orderBy, include: COMPLAINT_INCLUDE, take: perPage, skip: (page - 1) * perPage }),
    ])
    return { data: rows, pagination: buildPagination(total, page, perPage, rows.length) }
  }
}
