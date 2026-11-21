import { EnumCourierCompensationReason } from '@prisma/types'
import { PeriodFigures } from 'src/domains/time-worked/period-figures'
import { WorkedCompensation, WorkedDay, WorkedJob } from 'src/domains/time-worked/worked-shifts'
import { StatementJobRow, StatementModel } from './statement-model'

// Test fixtures for spec 0050 (row 76). Not a spec file, so Jest does not run it; the statement specs
// import it to build jobs, days and models by hand.

export function compensation(
  reason: EnumCourierCompensationReason,
  amountCents: number,
  createdAt = '2026-10-05T08:00:00Z',
  extra: Partial<WorkedCompensation> = {}
): WorkedCompensation {
  return {
    id: `comp-${reason}-${amountCents}-${createdAt}`,
    reason,
    amountCents,
    waitMinutes: null,
    createdAt: new Date(createdAt),
    addedLater: false,
    ...extra,
  }
}

export function workedJob(overrides: Partial<WorkedJob> = {}): WorkedJob {
  return {
    deliveryId: 'del-1',
    pickupName: 'Souvlaki Bar',
    acceptedAt: new Date('2026-10-05T07:30:00Z'),
    endedAt: new Date('2026-10-05T08:00:00Z'),
    endEventType: null,
    droppedOff: true,
    deliveryMoneyCents: 450,
    paidWaitSeconds: 0,
    compensations: [],
    paidKm: 2.5,
    dropoffArea: 'Ermou',
    pickupWaitSeconds: null,
    cancelledAfterPickup: false,
    endLabel: null,
    ...overrides,
  }
}

export function day(date: string, overrides: Partial<WorkedDay & PeriodFigures> = {}): WorkedDay & PeriodFigures {
  return {
    date,
    workSeconds: 0,
    jobSeconds: 0,
    paidWaitSeconds: 0,
    unpaidSeconds: 0,
    moneyCents: 0,
    unlinkedMoneyCents: 0,
    noJobMoneyCents: 0,
    centsPerHour: null,
    activeCentsPerHour: null,
    paidKm: 0,
    centsPerPaidKm: null,
    medianPickupWaitSeconds: null,
    pickupWaitCount: 0,
    dropOffCount: 0,
    ...overrides,
  }
}

export function statementRow(overrides: Partial<StatementJobRow> = {}): StatementJobRow {
  return {
    deliveryId: 'del-1',
    // 10:30 in Athens (UTC+3 in early October).
    acceptedAt: new Date('2026-10-05T07:30:00Z'),
    pickupName: 'Souvlaki Bar',
    dropoffArea: 'Ermou',
    paidKm: 2.5,
    minutes: 30,
    end: 'DELIVERED',
    deliveryPayCents: 350,
    tipsCents: 100,
    waitingCents: 80,
    cancellationCents: 0,
    removalCents: 0,
    returnTripCents: 0,
    reviewCents: 0,
    otherCents: 0,
    otherReasons: [],
    totalCents: 530,
    ...overrides,
  }
}

export function statementModel(overrides: Partial<StatementModel> = {}): StatementModel {
  return {
    month: '2026-10',
    lang: 'el',
    coopName: 'Συνεταιρισμός Διανομέων Βόλου',
    riderName: 'Νίκος Παπαδόπουλος',
    madeAt: new Date('2026-11-21T10:00:00Z'),
    currencyCode: 'EUR',
    jobs: [statementRow()],
    unlinked: [],
    totals: {
      moneyCents: 530,
      dropOffCount: 1,
      paidKm: 2.5,
      workSeconds: 32400,
      jobSeconds: 7560,
      paidWaitSeconds: 240,
      unpaidSeconds: 24600,
      centsPerHour: 303,
      centsPerPaidKm: 203,
    },
    timeRecorded: true,
    addedLaterCents: 0,
    monthEnd: '2026-10-31',
    ...overrides,
  }
}
