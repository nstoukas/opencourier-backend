import { ApiProperty } from '@nestjs/swagger'
import { EnumCourierCompensationReason, EnumDeliveryEventType } from '@prisma/types'
import { IsOptional, IsString } from 'class-validator'
import { EnumTimelineWho } from 'src/domains/time-worked/delivery-timeline'
import { PeriodFigures } from 'src/domains/time-worked/period-figures'
import { EnumJobEndLabel, WorkedJob, WorkedShift } from 'src/domains/time-worked/worked-shifts'
import {
  EarningsDay,
  EarningsDeliveryDetail,
  EarningsView,
  EarningsWeek,
} from 'src/services/time-worked/time-worked.service'
import { WorkedJobDto, WorkedShiftDto, toShiftDto } from './time-worked.dto'

// Spec 0042: the Earnings answers. As in time-worked.dto.ts, each class lists its fields one by one and
// each mapper copies them one by one, so nothing the pure functions add later reaches a client by
// accident (AC-12: never a house number, post code or address line; AC-11: never a message or amount on
// the timeline).

// `month` is checked by parseMonth, which answers 400 with a sentence; the decorators only let the
// string through the global ValidationPipe.
export class EarningsMonthArgs {
  @ApiProperty({ type: String, description: 'The month, YYYY-MM' })
  @IsOptional()
  @IsString()
  month?: string
}

export class EarningsFiguresDto {
  @ApiProperty({ type: Number }) workSeconds: number
  @ApiProperty({ type: Number }) jobSeconds: number
  @ApiProperty({ type: Number }) paidWaitSeconds: number
  @ApiProperty({ type: Number }) unpaidSeconds: number
  @ApiProperty({ type: Number, description: 'Includes unlinkedMoneyCents' }) moneyCents: number
  @ApiProperty({ type: Number }) unlinkedMoneyCents: number
  @ApiProperty({ type: Number, description: 'The part of unlinkedMoneyCents linked to no job at all' })
  noJobMoneyCents: number
  @ApiProperty({ type: Number, nullable: true }) centsPerHour: number | null
  @ApiProperty({ type: Number, nullable: true }) activeCentsPerHour: number | null
  @ApiProperty({ type: Number }) paidKm: number
  @ApiProperty({ type: Number, nullable: true }) centsPerPaidKm: number | null
  @ApiProperty({ type: Number, nullable: true }) medianPickupWaitSeconds: number | null
  @ApiProperty({ type: Number }) pickupWaitCount: number
  @ApiProperty({ type: Number }) dropOffCount: number
}

export class EarningsDayDto extends EarningsFiguresDto {
  @ApiProperty({ type: String }) date: string
}

export class EarningsWeekDto extends EarningsFiguresDto {
  @ApiProperty({ type: String }) weekStart: string
  @ApiProperty({ type: Boolean }) soFar: boolean
  @ApiProperty({ type: Boolean }) cutAtReach: boolean
}

export class EarningsJobDto extends WorkedJobDto {
  @ApiProperty({ type: Number, nullable: true }) paidKm: number | null
  @ApiProperty({ type: String, nullable: true }) dropoffArea: string | null
  @ApiProperty({ type: Number, nullable: true }) pickupWaitSeconds: number | null
  @ApiProperty({ type: Boolean }) cancelledAfterPickup: boolean
  @ApiProperty({ enum: EnumJobEndLabel, nullable: true }) endLabel: EnumJobEndLabel | null
}

export class EarningsShiftDto extends WorkedShiftDto {
  @ApiProperty({ type: () => [EarningsJobDto] }) jobs: EarningsJobDto[]
}

// What the rider's month and the admin's range share.
export class EarningsViewDto {
  @ApiProperty({ type: String }) from: string
  @ApiProperty({ type: String }) to: string
  @ApiProperty({ type: Date, nullable: true }) recordedFrom: Date | null
  @ApiProperty({ type: String }) currencyCode: string
  @ApiProperty({ type: () => [EarningsDayDto] }) days: EarningsDayDto[]
  @ApiProperty({ type: () => [EarningsWeekDto] }) weeks: EarningsWeekDto[]
  @ApiProperty({ type: () => [EarningsShiftDto] }) shifts: EarningsShiftDto[]
  @ApiProperty({ type: () => [EarningsJobDto] }) jobsInNoShift: EarningsJobDto[]
}

export class EarningsMonthDto extends EarningsViewDto {
  @ApiProperty({ type: String, description: 'YYYY-MM' }) month: string
  @ApiProperty({ type: String, description: 'The first day the rider can open' }) reachFrom: string
}

export class EarningsJobOnDeliveryDto {
  @ApiProperty({ type: Date }) acceptedAt: Date
  @ApiProperty({ type: Date, nullable: true }) endedAt: Date | null
  @ApiProperty({ enum: EnumJobEndLabel, nullable: true }) endLabel: EnumJobEndLabel | null
  @ApiProperty({ type: Number }) minutes: number
  @ApiProperty({ type: Number, nullable: true }) pickupWaitSeconds: number | null
}

export class EarningsCompensationLineDto {
  @ApiProperty({ enum: EnumCourierCompensationReason }) reason: EnumCourierCompensationReason
  @ApiProperty({ type: Number }) amountCents: number
  @ApiProperty({ type: Number, nullable: true }) waitMinutes: number | null
  @ApiProperty({ type: Date }) createdAt: Date
  @ApiProperty({ type: Boolean }) addedLater: boolean
}

export class EarningsBreakdownDto {
  @ApiProperty({ type: Number, nullable: true }) baseFeeCents: number | null
  @ApiProperty({ type: Number, nullable: true }) distanceFeeCents: number | null
  @ApiProperty({ type: Number }) deliveryPayCents: number
  @ApiProperty({ type: Number }) tipsCents: number
  @ApiProperty({ type: () => [EarningsCompensationLineDto] }) compensations: EarningsCompensationLineDto[]
  @ApiProperty({ type: Number }) totalCents: number
}

export class EarningsTimelineLineDto {
  @ApiProperty({ enum: EnumDeliveryEventType }) type: EnumDeliveryEventType
  @ApiProperty({ type: Date }) at: Date
  @ApiProperty({ enum: EnumTimelineWho, nullable: true }) who: EnumTimelineWho | null
  @ApiProperty({ type: Boolean, description: 'Another rider took it; never says who' }) anotherRider: boolean
}

export class EarningsDeliveryDto {
  @ApiProperty({ type: String }) deliveryId: string
  @ApiProperty({ type: String }) currencyCode: string
  @ApiProperty({ type: String }) pickupName: string
  @ApiProperty({ type: String, nullable: true }) dropoffArea: string | null
  @ApiProperty({ type: Number }) paidKm: number
  @ApiProperty({ type: () => [EarningsJobOnDeliveryDto] }) jobs: EarningsJobOnDeliveryDto[]
  @ApiProperty({ type: () => EarningsBreakdownDto }) breakdown: EarningsBreakdownDto
  @ApiProperty({ type: () => [EarningsTimelineLineDto] }) timeline: EarningsTimelineLineDto[]
}

// ---- Mapping, field by field ----

function toFiguresDto(figures: PeriodFigures): EarningsFiguresDto {
  return {
    workSeconds: figures.workSeconds,
    jobSeconds: figures.jobSeconds,
    paidWaitSeconds: figures.paidWaitSeconds,
    unpaidSeconds: figures.unpaidSeconds,
    moneyCents: figures.moneyCents,
    unlinkedMoneyCents: figures.unlinkedMoneyCents,
    noJobMoneyCents: figures.noJobMoneyCents,
    centsPerHour: figures.centsPerHour,
    activeCentsPerHour: figures.activeCentsPerHour,
    paidKm: figures.paidKm,
    centsPerPaidKm: figures.centsPerPaidKm,
    medianPickupWaitSeconds: figures.medianPickupWaitSeconds,
    pickupWaitCount: figures.pickupWaitCount,
    dropOffCount: figures.dropOffCount,
  }
}

export function toEarningsDayDto(day: EarningsDay): EarningsDayDto {
  return { ...toFiguresDto(day), date: day.date }
}

export function toEarningsWeekDto(week: EarningsWeek): EarningsWeekDto {
  return { ...toFiguresDto(week), weekStart: week.weekStart, soFar: week.soFar, cutAtReach: week.cutAtReach }
}

export function toEarningsJobDto(job: WorkedJob): EarningsJobDto {
  return {
    deliveryId: job.deliveryId,
    pickupName: job.pickupName,
    acceptedAt: job.acceptedAt,
    endedAt: job.endedAt,
    endEventType: job.endEventType,
    droppedOff: job.droppedOff,
    deliveryMoneyCents: job.deliveryMoneyCents,
    paidWaitSeconds: job.paidWaitSeconds,
    compensations: job.compensations.map((c) => ({
      id: c.id,
      reason: c.reason,
      amountCents: c.amountCents,
      createdAt: c.createdAt,
      addedLater: c.addedLater,
    })),
    paidKm: job.paidKm,
    dropoffArea: job.dropoffArea,
    pickupWaitSeconds: job.pickupWaitSeconds,
    cancelledAfterPickup: job.cancelledAfterPickup,
    endLabel: job.endLabel,
  }
}

export function toEarningsShiftDto(shift: WorkedShift, withAdminLabels: boolean): EarningsShiftDto {
  return { ...toShiftDto(shift, withAdminLabels), jobs: shift.jobs.map(toEarningsJobDto) }
}

export function toEarningsViewDto(view: EarningsView, withAdminLabels: boolean): EarningsViewDto {
  return {
    from: view.from,
    to: view.to,
    recordedFrom: view.recordedFrom,
    currencyCode: view.currencyCode,
    days: view.days.map(toEarningsDayDto),
    weeks: view.weeks.map(toEarningsWeekDto),
    shifts: view.shifts.map((s) => toEarningsShiftDto(s, withAdminLabels)),
    jobsInNoShift: view.jobsInNoShift.map(toEarningsJobDto),
  }
}

export function toEarningsMonthDto(view: EarningsView & { month: string; reachFrom: string }): EarningsMonthDto {
  // The rider's own view never carries which admin made a change (spec 0040 AC-15).
  return { ...toEarningsViewDto(view, false), month: view.month, reachFrom: view.reachFrom }
}

export function toEarningsDeliveryDto(detail: EarningsDeliveryDetail): EarningsDeliveryDto {
  return {
    deliveryId: detail.deliveryId,
    currencyCode: detail.currencyCode,
    pickupName: detail.pickupName,
    dropoffArea: detail.dropoffArea,
    paidKm: detail.paidKm,
    jobs: detail.jobs.map((j) => ({
      acceptedAt: j.acceptedAt,
      endedAt: j.endedAt,
      endLabel: j.endLabel,
      minutes: j.minutes,
      pickupWaitSeconds: j.pickupWaitSeconds,
    })),
    breakdown: {
      baseFeeCents: detail.breakdown.baseFeeCents,
      distanceFeeCents: detail.breakdown.distanceFeeCents,
      deliveryPayCents: detail.breakdown.deliveryPayCents,
      tipsCents: detail.breakdown.tipsCents,
      compensations: detail.breakdown.compensations.map((c) => ({
        reason: c.reason,
        amountCents: c.amountCents,
        waitMinutes: c.waitMinutes,
        createdAt: c.createdAt,
        addedLater: c.addedLater,
      })),
      totalCents: detail.breakdown.totalCents,
    },
    timeline: detail.timeline.map((line) => ({
      type: line.type,
      at: line.at,
      who: line.who,
      anotherRider: line.anotherRider,
    })),
  }
}
