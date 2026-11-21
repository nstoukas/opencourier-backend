import { ApiProperty } from '@nestjs/swagger'
import { EnumComplaintAbout, EnumComplaintCategory, EnumComplaintFiledBy, EnumComplaintStatus } from '@prisma/types'
import { PaginationDto } from 'src/core/dtos/PaginationDto'
import { ComplaintRecord } from 'src/persistence/repositories/complaint.repository'

// Spec 0052. Each DTO is built field by field from an explicit list (cross check 7): a rider's or a
// restaurant's never carries an admin's id or name (filerAdmin, decidedBy, withdrawnBy, replyEnteredBy).
// No DTO anywhere carries a number of complaints per rider (AC-8).

type AdminLabel = { id: string; email: string | null; username: string | null } | null

// The admin's label: email, else username, else id (the spec 0036 rule).
function adminLabel(user: AdminLabel): string | null {
  return user ? user.email ?? user.username ?? user.id : null
}

function riderName(rider: { firstName: string; lastName: string } | null): string | null {
  return rider ? `${rider.firstName} ${rider.lastName}`.trim() : null
}

// The job a complaint is on: enough to recognise it, nothing about the customer.
export class ComplaintDeliverySummaryDto {
  @ApiProperty({ type: String }) id: string
  // The restaurant's name (the delivery's pickupBusinessName).
  @ApiProperty({ type: String }) pickupName: string
  @ApiProperty({ type: Date }) createdAt: Date

  constructor(delivery: ComplaintRecord['delivery']) {
    this.id = delivery.id
    this.pickupName = delivery.pickupBusinessName
    this.createdAt = delivery.createdAt
  }
}

// Whether the rider reading filed this complaint or it is about them.
export enum ComplaintCourierRole {
  FILED_BY_YOU = 'FILED_BY_YOU',
  ABOUT_YOU = 'ABOUT_YOU',
}

// AC-4, AC-7: one complaint as a rider sees it, filed by them or about them. The filer is only a kind
// (RESTAURANT or ADMIN, worded "the restaurant" or "the co-op"), never an admin's name (AC-4).
export class ComplaintCourierDto {
  @ApiProperty({ type: String }) id: string
  @ApiProperty({ enum: ComplaintCourierRole }) role: ComplaintCourierRole
  @ApiProperty({ type: () => ComplaintDeliverySummaryDto }) delivery: ComplaintDeliverySummaryDto
  @ApiProperty({ enum: EnumComplaintFiledBy }) filedBy: EnumComplaintFiledBy
  @ApiProperty({ enum: EnumComplaintAbout }) about: EnumComplaintAbout
  @ApiProperty({ enum: EnumComplaintCategory }) category: EnumComplaintCategory
  @ApiProperty({ type: String }) text: string
  @ApiProperty({ enum: EnumComplaintStatus }) status: EnumComplaintStatus
  @ApiProperty({ type: Date }) createdAt: Date
  @ApiProperty({ type: String, nullable: true }) riderReply: string | null
  @ApiProperty({ type: Date, nullable: true }) repliedAt: Date | null
  // True when an admin entered the reply from a phone call, the rider's account being deactivated.
  @ApiProperty({ type: Boolean }) replyEnteredForRider: boolean
  @ApiProperty({ type: String, nullable: true }) outcome: string | null
  @ApiProperty({ type: Date, nullable: true }) decidedAt: Date | null
  @ApiProperty({ type: String, nullable: true }) withdrawnReason: string | null
  @ApiProperty({ type: Date, nullable: true }) withdrawnAt: Date | null

  constructor(complaint: ComplaintRecord, courierId: string) {
    this.id = complaint.id
    this.role = complaint.aboutCourierId === courierId ? ComplaintCourierRole.ABOUT_YOU : ComplaintCourierRole.FILED_BY_YOU
    this.delivery = new ComplaintDeliverySummaryDto(complaint.delivery)
    this.filedBy = complaint.filedBy
    this.about = complaint.about
    this.category = complaint.category
    this.text = complaint.text
    this.status = complaint.status
    this.createdAt = complaint.createdAt
    this.riderReply = complaint.riderReply
    this.repliedAt = complaint.repliedAt
    this.replyEnteredForRider = complaint.replyEnteredByUserId !== null
    this.outcome = complaint.outcome
    this.decidedAt = complaint.decidedAt
    this.withdrawnReason = complaint.withdrawnReason
    this.withdrawnAt = complaint.withdrawnAt
  }
}

// What a restaurant's status reads: whether the rider has replied is not the restaurant's to know, so
// AWAITING_REPLY reads OPEN (decision 83.1).
export enum ComplaintPartnerStatus {
  OPEN = 'OPEN',
  DECIDED = 'DECIDED',
  WITHDRAWN = 'WITHDRAWN',
}

// AC-7: a complaint as the restaurant that filed it sees it: its own words and the outcome. Never the
// rider's reply, never who decided.
export class ComplaintPartnerDto {
  @ApiProperty({ type: String }) id: string
  @ApiProperty({ type: String }) deliveryId: string
  @ApiProperty({ enum: EnumComplaintCategory }) category: EnumComplaintCategory
  @ApiProperty({ type: String }) text: string
  @ApiProperty({ enum: ComplaintPartnerStatus }) status: ComplaintPartnerStatus
  @ApiProperty({ type: Date }) createdAt: Date
  @ApiProperty({ type: String, nullable: true }) outcome: string | null
  @ApiProperty({ type: Date, nullable: true }) decidedAt: Date | null
  @ApiProperty({ type: String, nullable: true }) withdrawnReason: string | null
  @ApiProperty({ type: Date, nullable: true }) withdrawnAt: Date | null

  constructor(complaint: ComplaintRecord) {
    this.id = complaint.id
    this.deliveryId = complaint.deliveryId
    this.category = complaint.category
    this.text = complaint.text
    this.status =
      complaint.status === EnumComplaintStatus.DECIDED
        ? ComplaintPartnerStatus.DECIDED
        : complaint.status === EnumComplaintStatus.WITHDRAWN
          ? ComplaintPartnerStatus.WITHDRAWN
          : ComplaintPartnerStatus.OPEN
    this.createdAt = complaint.createdAt
    this.outcome = complaint.outcome
    this.decidedAt = complaint.decidedAt
    this.withdrawnReason = complaint.withdrawnReason
    this.withdrawnAt = complaint.withdrawnAt
  }
}

// AC-6: admins see everything, with every name.
export class ComplaintAdminDto {
  @ApiProperty({ type: String }) id: string
  @ApiProperty({ type: () => ComplaintDeliverySummaryDto }) delivery: ComplaintDeliverySummaryDto
  @ApiProperty({ enum: EnumComplaintFiledBy }) filedBy: EnumComplaintFiledBy
  // The rider, restaurant or admin who filed it, as a name or label (null if that admin user was deleted).
  @ApiProperty({ type: String, nullable: true }) filerName: string | null
  @ApiProperty({ type: String, nullable: true }) filerCourierId: string | null
  @ApiProperty({ type: String, nullable: true }) filerPartnerId: string | null
  @ApiProperty({ enum: EnumComplaintAbout }) about: EnumComplaintAbout
  @ApiProperty({ type: String, nullable: true }) aboutCourierId: string | null
  @ApiProperty({ type: String, nullable: true }) aboutCourierName: string | null
  // Cross check 2: only then may an admin enter the rider's reply for them.
  @ApiProperty({ type: Boolean }) aboutCourierDeactivated: boolean
  @ApiProperty({ enum: EnumComplaintCategory }) category: EnumComplaintCategory
  @ApiProperty({ type: String }) text: string
  @ApiProperty({ enum: EnumComplaintStatus }) status: EnumComplaintStatus
  @ApiProperty({ type: Date }) createdAt: Date
  @ApiProperty({ type: String, nullable: true }) riderReply: string | null
  @ApiProperty({ type: Date, nullable: true }) repliedAt: Date | null
  @ApiProperty({ type: String, nullable: true }) replyEnteredBy: string | null
  @ApiProperty({ type: String, nullable: true }) outcome: string | null
  @ApiProperty({ type: Date, nullable: true }) decidedAt: Date | null
  @ApiProperty({ type: String, nullable: true }) decidedBy: string | null
  @ApiProperty({ type: String, nullable: true }) withdrawnReason: string | null
  @ApiProperty({ type: Date, nullable: true }) withdrawnAt: Date | null
  @ApiProperty({ type: String, nullable: true }) withdrawnBy: string | null

  constructor(complaint: ComplaintRecord) {
    this.id = complaint.id
    this.delivery = new ComplaintDeliverySummaryDto(complaint.delivery)
    this.filedBy = complaint.filedBy
    this.filerName =
      complaint.filedBy === EnumComplaintFiledBy.RIDER
        ? riderName(complaint.filerCourier)
        : complaint.filedBy === EnumComplaintFiledBy.RESTAURANT
          ? complaint.filerPartner?.name ?? null
          : adminLabel(complaint.filerAdmin)
    this.filerCourierId = complaint.filerCourierId
    this.filerPartnerId = complaint.filerPartnerId
    this.about = complaint.about
    this.aboutCourierId = complaint.aboutCourierId
    this.aboutCourierName = riderName(complaint.aboutCourier)
    this.aboutCourierDeactivated = Boolean(complaint.aboutCourier?.deactivatedAt)
    this.category = complaint.category
    this.text = complaint.text
    this.status = complaint.status
    this.createdAt = complaint.createdAt
    this.riderReply = complaint.riderReply
    this.repliedAt = complaint.repliedAt
    this.replyEnteredBy = adminLabel(complaint.replyEnteredBy)
    this.outcome = complaint.outcome
    this.decidedAt = complaint.decidedAt
    this.decidedBy = adminLabel(complaint.decidedBy)
    this.withdrawnReason = complaint.withdrawnReason
    this.withdrawnAt = complaint.withdrawnAt
    this.withdrawnBy = adminLabel(complaint.withdrawnBy)
  }
}

export class ComplaintDeliveryRiderDto {
  @ApiProperty({ type: String }) id: string
  @ApiProperty({ type: String }) name: string
}

export class ComplaintCourierPageDto {
  @ApiProperty({ type: () => [ComplaintCourierDto] }) data: ComplaintCourierDto[]
  @ApiProperty({ type: () => PaginationDto, required: false }) pagination?: PaginationDto
}

export class ComplaintPartnerPageDto {
  @ApiProperty({ type: () => [ComplaintPartnerDto] }) data: ComplaintPartnerDto[]
  @ApiProperty({ type: () => PaginationDto, required: false }) pagination?: PaginationDto
}

export class ComplaintAdminPageDto {
  @ApiProperty({ type: () => [ComplaintAdminDto] }) data: ComplaintAdminDto[]
  @ApiProperty({ type: () => PaginationDto, required: false }) pagination?: PaginationDto
}
