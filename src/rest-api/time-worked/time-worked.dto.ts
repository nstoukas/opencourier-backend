import { ApiProperty } from '@nestjs/swagger'
import {
  EnumCourierCompensationReason,
  EnumCourierStatus,
  EnumCourierStatusChangeCause,
  EnumDeliveryEventType,
} from '@prisma/types'
import { IsIn, IsOptional, IsString } from 'class-validator'
import { WorkedDay, WorkedShift } from 'src/domains/time-worked/worked-shifts'
import { CoopWeek, TotalsRow } from 'src/services/time-worked/time-worked.service'

// Spec 0040: the time worked answers. Each class lists its fields one by one, so nothing the pure
// function adds later reaches a client by accident.

// A range of days (AC-18). Both are checked by parseDayRange, which answers 400 with a sentence; the
// decorators only let the strings through the global ValidationPipe.
export class TimeWorkedRangeArgs {
  @ApiProperty({ type: String, description: 'First day, YYYY-MM-DD in the instance timezone' })
  @IsOptional()
  @IsString()
  from?: string

  @ApiProperty({ type: String, description: 'Last day, YYYY-MM-DD in the instance timezone' })
  @IsOptional()
  @IsString()
  to?: string
}

export class TimeWorkedTotalsArgs extends TimeWorkedRangeArgs {
  @ApiProperty({ enum: ['day', 'week'] })
  @IsIn(['day', 'week'], { message: 'by must be day or week.' })
  by: 'day' | 'week'
}

export class WorkedStatusChangeDto {
  @ApiProperty({ type: Date }) at: Date
  @ApiProperty({ enum: EnumCourierStatus }) fromStatus: EnumCourierStatus
  @ApiProperty({ enum: EnumCourierStatus }) toStatus: EnumCourierStatus
  @ApiProperty({ enum: EnumCourierStatusChangeCause }) cause: EnumCourierStatusChangeCause
  @ApiProperty({ type: Boolean }) byAdmin: boolean
  // Admin view only (AC-15): the admin's email, else username.
  @ApiProperty({ type: String, nullable: true, required: false }) adminLabel?: string | null
}

export class WorkedCompensationDto {
  @ApiProperty({ type: String }) id: string
  @ApiProperty({ enum: EnumCourierCompensationReason }) reason: EnumCourierCompensationReason
  @ApiProperty({ type: Number }) amountCents: number
  @ApiProperty({ type: Date }) createdAt: Date
  @ApiProperty({ type: Boolean }) addedLater: boolean
}

export class WorkedJobDto {
  @ApiProperty({ type: String }) deliveryId: string
  @ApiProperty({ type: String }) pickupName: string
  @ApiProperty({ type: Date }) acceptedAt: Date
  @ApiProperty({ type: Date, nullable: true }) endedAt: Date | null
  @ApiProperty({ enum: EnumDeliveryEventType, nullable: true }) endEventType: EnumDeliveryEventType | null
  @ApiProperty({ type: Boolean }) droppedOff: boolean
  @ApiProperty({ type: Number }) deliveryMoneyCents: number
  @ApiProperty({ type: Number }) paidWaitSeconds: number
  @ApiProperty({ type: () => [WorkedCompensationDto] }) compensations: WorkedCompensationDto[]
}

export class WorkedBreakDto {
  @ApiProperty({ type: Date }) startedAt: Date
  @ApiProperty({ type: Date }) endedAt: Date
}

export class WorkedShiftDto {
  @ApiProperty({ type: Date }) startedAt: Date
  @ApiProperty({ type: Boolean }) startedBeforeRange: boolean
  @ApiProperty({ type: Date, nullable: true }) endedAt: Date | null
  @ApiProperty({ type: Date, nullable: true }) onBreakSince: Date | null
  @ApiProperty({ type: Number }) workSeconds: number
  @ApiProperty({ type: Number }) jobSeconds: number
  @ApiProperty({ type: Number }) paidWaitSeconds: number
  @ApiProperty({ type: Number }) unpaidSeconds: number
  @ApiProperty({ type: () => [WorkedBreakDto] }) breaks: WorkedBreakDto[]
  @ApiProperty({ type: Number }) moneyCents: number
  @ApiProperty({ type: Number }) lateMoneyCents: number
  @ApiProperty({ type: Number, nullable: true }) centsPerHour: number | null
  @ApiProperty({ type: String }) currencyCode: string
  @ApiProperty({ type: () => [WorkedStatusChangeDto] }) statusChanges: WorkedStatusChangeDto[]
  @ApiProperty({ type: () => [WorkedJobDto] }) jobs: WorkedJobDto[]
}

export class WorkedDayDto {
  @ApiProperty({ type: String }) date: string
  @ApiProperty({ type: Number }) workSeconds: number
  @ApiProperty({ type: Number }) jobSeconds: number
  @ApiProperty({ type: Number }) paidWaitSeconds: number
  @ApiProperty({ type: Number }) unpaidSeconds: number
  @ApiProperty({ type: Number, description: 'Includes unlinkedMoneyCents' }) moneyCents: number
  @ApiProperty({ type: Number, nullable: true }) centsPerHour: number | null
  @ApiProperty({ type: Number }) unlinkedMoneyCents: number
}

export class TimeWorkedDto {
  @ApiProperty({ type: Date, nullable: true }) recordedFrom: Date | null
  @ApiProperty({ type: String }) currencyCode: string
  @ApiProperty({ type: () => [WorkedDayDto] }) days: WorkedDayDto[]
  @ApiProperty({ type: () => [WorkedShiftDto] }) shifts: WorkedShiftDto[]
}

// The home counter's snapshot (AC-10): the shift without its lists.
export class CurrentShiftDto {
  @ApiProperty({ type: Date }) startedAt: Date
  @ApiProperty({ type: Date, nullable: true }) onBreakSince: Date | null
  @ApiProperty({ type: Number }) workSeconds: number
  @ApiProperty({ type: Number }) jobSeconds: number
  @ApiProperty({ type: Number }) paidWaitSeconds: number
  @ApiProperty({ type: Number }) unpaidSeconds: number
  @ApiProperty({ type: Number }) moneyCents: number
  @ApiProperty({ type: Number, nullable: true }) centsPerHour: number | null
  @ApiProperty({ type: String }) currencyCode: string
}

export class CurrentTimeWorkedDto {
  @ApiProperty({ type: Date }) asOf: Date
  @ApiProperty({ type: Number }) shiftBreakMinutes: number
  @ApiProperty({ type: () => CurrentShiftDto, nullable: true }) shift: CurrentShiftDto | null
}

export class CoopWeekDto {
  @ApiProperty({ type: String }) weekStart: string
  @ApiProperty({ type: Boolean }) tooFewRiders: boolean
  @ApiProperty({ type: Number, required: false }) workSeconds?: number
  @ApiProperty({ type: Number, nullable: true, required: false }) unpaidShare?: number | null
  @ApiProperty({ type: Number, nullable: true, required: false }) centsPerHour?: number | null
}

export class CoopTotalsDto {
  @ApiProperty({ type: () => CoopWeekDto }) thisWeek: CoopWeekDto
  @ApiProperty({ type: () => CoopWeekDto }) lastWeek: CoopWeekDto
}

// AC-14, AC-16: never a rider id, never a name.
export class TimeWorkedTotalsRowDto {
  @ApiProperty({ type: String }) period: string
  @ApiProperty({ type: Number }) riderCount: number
  @ApiProperty({ type: Number }) workSeconds: number
  @ApiProperty({ type: Number }) jobSeconds: number
  @ApiProperty({ type: Number }) paidWaitSeconds: number
  @ApiProperty({ type: Number }) unpaidSeconds: number
  @ApiProperty({ type: Number }) moneyCents: number
  @ApiProperty({ type: Number }) unlinkedMoneyCents: number
  @ApiProperty({ type: Number, nullable: true }) centsPerHour: number | null
}

export class TimeWorkedTotalsDto {
  @ApiProperty({ type: String }) currencyCode: string
  @ApiProperty({ type: () => [TimeWorkedTotalsRowDto] }) rows: TimeWorkedTotalsRowDto[]
}

// ---- Mapping, field by field ----

export function toShiftDto(shift: WorkedShift, withAdminLabels: boolean): WorkedShiftDto {
  return {
    startedAt: shift.startedAt,
    startedBeforeRange: shift.startedBeforeRange,
    endedAt: shift.endedAt,
    onBreakSince: shift.onBreakSince,
    workSeconds: shift.workSeconds,
    jobSeconds: shift.jobSeconds,
    paidWaitSeconds: shift.paidWaitSeconds,
    unpaidSeconds: shift.unpaidSeconds,
    breaks: shift.breaks.map((b) => ({ startedAt: b.startedAt, endedAt: b.endedAt })),
    moneyCents: shift.moneyCents,
    lateMoneyCents: shift.lateMoneyCents,
    centsPerHour: shift.centsPerHour,
    currencyCode: shift.currencyCode,
    statusChanges: shift.statusChanges.map((c) => ({
      at: c.at,
      fromStatus: c.fromStatus,
      toStatus: c.toStatus,
      cause: c.cause,
      byAdmin: c.byAdmin,
      // Only the admin view carries who the admin was (AC-15); the rider sees that an admin did it.
      ...(withAdminLabels ? { adminLabel: c.adminLabel ?? null } : {}),
    })),
    jobs: shift.jobs.map((j) => ({
      deliveryId: j.deliveryId,
      pickupName: j.pickupName,
      acceptedAt: j.acceptedAt,
      endedAt: j.endedAt,
      endEventType: j.endEventType,
      droppedOff: j.droppedOff,
      deliveryMoneyCents: j.deliveryMoneyCents,
      paidWaitSeconds: j.paidWaitSeconds,
      compensations: j.compensations.map((c) => ({
        id: c.id,
        reason: c.reason,
        amountCents: c.amountCents,
        createdAt: c.createdAt,
        addedLater: c.addedLater,
      })),
    })),
  }
}

export function toDayDto(day: WorkedDay): WorkedDayDto {
  return {
    date: day.date,
    workSeconds: day.workSeconds,
    jobSeconds: day.jobSeconds,
    paidWaitSeconds: day.paidWaitSeconds,
    unpaidSeconds: day.unpaidSeconds,
    moneyCents: day.moneyCents,
    centsPerHour: day.centsPerHour,
    unlinkedMoneyCents: day.unlinkedMoneyCents,
  }
}

export function toTimeWorkedDto(
  result: { recordedFrom: Date | null; currencyCode: string; days: WorkedDay[]; shifts: WorkedShift[] },
  withAdminLabels: boolean
): TimeWorkedDto {
  return {
    recordedFrom: result.recordedFrom,
    currencyCode: result.currencyCode,
    days: result.days.map(toDayDto),
    shifts: result.shifts.map((s) => toShiftDto(s, withAdminLabels)),
  }
}

export function toCurrentShiftDto(shift: WorkedShift | null): CurrentShiftDto | null {
  if (!shift) return null
  return {
    startedAt: shift.startedAt,
    onBreakSince: shift.onBreakSince,
    workSeconds: shift.workSeconds,
    jobSeconds: shift.jobSeconds,
    paidWaitSeconds: shift.paidWaitSeconds,
    unpaidSeconds: shift.unpaidSeconds,
    moneyCents: shift.moneyCents,
    centsPerHour: shift.centsPerHour,
    currencyCode: shift.currencyCode,
  }
}

export function toCoopWeekDto(week: CoopWeek): CoopWeekDto {
  // A small week carries no figure at all, not even the rider count (AC-12).
  if (week.tooFewRiders) return { weekStart: week.weekStart, tooFewRiders: true }
  return {
    weekStart: week.weekStart,
    tooFewRiders: false,
    workSeconds: week.workSeconds,
    unpaidShare: week.unpaidShare,
    centsPerHour: week.centsPerHour,
  }
}

export function toTotalsRowDto(row: TotalsRow): TimeWorkedTotalsRowDto {
  return {
    period: row.period,
    riderCount: row.riderCount,
    workSeconds: row.workSeconds,
    jobSeconds: row.jobSeconds,
    paidWaitSeconds: row.paidWaitSeconds,
    unpaidSeconds: row.unpaidSeconds,
    moneyCents: row.moneyCents,
    unlinkedMoneyCents: row.unlinkedMoneyCents,
    centsPerHour: row.centsPerHour,
  }
}
