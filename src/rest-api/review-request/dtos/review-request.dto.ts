import { ApiProperty } from '@nestjs/swagger'
import { EnumReviewOutcome, EnumReviewRequestStatus, EnumReviewTopic } from '@prisma/types'
import { PaginationDto } from 'src/core/dtos/PaginationDto'
import { ReviewRequestRecord } from 'src/persistence/repositories/review-request.repository'

// The delivery a request is about (spec 0038): enough to recognise it, nothing about the customer.
export class ReviewDeliverySummaryDto {
  @ApiProperty({ type: String }) id: string
  // The restaurant's name (the delivery's pickupBusinessName; pickupName can be a contact person).
  @ApiProperty({ type: String }) pickupName: string
  @ApiProperty({ type: Date }) createdAt: Date
}

// One review request as its rider sees it (spec 0038, AC-8).
export class ReviewRequestCourierDto {
  @ApiProperty({ type: String }) id: string
  @ApiProperty({ enum: EnumReviewTopic }) topic: EnumReviewTopic
  @ApiProperty({ type: String }) note: string
  @ApiProperty({ enum: EnumReviewRequestStatus }) status: EnumReviewRequestStatus
  @ApiProperty({ type: Date }) createdAt: Date
  @ApiProperty({ type: Date }) dueAt: Date
  // Worked out at read time, never stored: open, and now past dueAt.
  @ApiProperty({ type: Boolean }) overdue: boolean
  @ApiProperty({ enum: EnumReviewOutcome, nullable: true }) outcome: EnumReviewOutcome | null
  @ApiProperty({ type: String, nullable: true }) answer: string | null
  @ApiProperty({ type: Date, nullable: true }) answeredAt: Date | null
  @ApiProperty({ type: Date, nullable: true }) withdrawnAt: Date | null
  @ApiProperty({ type: Number, nullable: true }) correctionCents: number | null
  // The correction's currency (the delivery's), or null with no correction.
  @ApiProperty({ type: String, nullable: true }) correctionCurrency: string | null
  @ApiProperty({ type: () => ReviewDeliverySummaryDto, nullable: true }) delivery: ReviewDeliverySummaryDto | null

  constructor(request: ReviewRequestRecord, now: Date = new Date()) {
    this.id = request.id
    this.topic = request.topic
    this.note = request.note
    this.status = request.status
    this.createdAt = request.createdAt
    this.dueAt = request.dueAt
    this.overdue = request.status === EnumReviewRequestStatus.OPEN && now.getTime() > request.dueAt.getTime()
    this.outcome = request.outcome
    this.answer = request.answer
    this.answeredAt = request.answeredAt
    this.withdrawnAt = request.withdrawnAt
    this.correctionCents = request.correctionCents
    this.correctionCurrency = request.correctionCurrency
    this.delivery = request.delivery
      ? {
          id: request.delivery.id,
          pickupName: request.delivery.pickupBusinessName,
          createdAt: request.delivery.createdAt,
        }
      : null
  }
}

// The admin sees the same, plus the rider and who answered (spec 0038, AC-5).
export class ReviewRequestAdminDto extends ReviewRequestCourierDto {
  @ApiProperty({ type: String }) courierId: string
  @ApiProperty({ type: String }) courierName: string
  // The answering admin's label: email, else username, else id (the spec 0036 rule).
  @ApiProperty({ type: String, nullable: true }) answeredBy: string | null

  constructor(request: ReviewRequestRecord, now: Date = new Date()) {
    super(request, now)
    this.courierId = request.courierId
    this.courierName = `${request.courier.firstName} ${request.courier.lastName}`.trim()
    this.answeredBy = request.answeredBy
      ? request.answeredBy.email ?? request.answeredBy.username ?? request.answeredBy.id
      : null
  }
}

export class ReviewRequestCourierPageDto {
  @ApiProperty({ type: () => [ReviewRequestCourierDto] }) data: ReviewRequestCourierDto[]
  @ApiProperty({ type: () => PaginationDto, required: false }) pagination?: PaginationDto
}

export class ReviewRequestAdminPageDto {
  @ApiProperty({ type: () => [ReviewRequestAdminDto] }) data: ReviewRequestAdminDto[]
  @ApiProperty({ type: () => PaginationDto, required: false }) pagination?: PaginationDto
}

export class ReviewRequestCountAdminDto {
  @ApiProperty({ type: Number }) open: number
  @ApiProperty({ type: Number }) overdue: number
}
