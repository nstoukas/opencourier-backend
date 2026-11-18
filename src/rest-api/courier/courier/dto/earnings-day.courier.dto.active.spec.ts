import { EnumCourierCompensationReason } from '@prisma/types'
import {
  EarningsDelivery,
  CourierEarningsDeliveryRow,
  CourierCompensationDeliveryRow,
} from 'src/domains/delivery-event/types/earnings-summary.type'
import {
  listEarningsDeliveriesForDay,
  summarizeEarningsByDay,
} from 'src/domains/delivery-event/utils/earnings-summary.util'
import { EarningsDeliveryCourierDto, EarningsDayCourierDto } from './earnings-day.courier.dto'

/**
 * Spec 0015 AC-15 / Row 32 verify fix:
 * "The rider's earnings show a cancellation award as its own kind
 * (CANCELLATION_COMPENSATION, labelled 'Cancelled job' in the app), not as a reassignment."
 *
 * EarningsDeliveryCourierDto must preserve `kind` so GET /courier/earnings/day communicates
 * whether a line item is a completed drop-off, a reassignment award, or a cancellation award.
 */
describe('EarningsDeliveryCourierDto (Spec 0015 AC-15, Row 32 verify fix)', () => {
  const baseDelivery: EarningsDelivery = {
    deliveryId: 'del-completed-1',
    droppedOffAt: new Date('2026-07-10T10:00:00.000Z'),
    dropoffAddress: 'Iasonos 12, Volos',
    pickupBusinessName: 'Ta Koutsavakia',
    compensation: 500,
    tips: 100,
    total: 600,
  }

  test('sets kind to CANCELLATION_COMPENSATION when provided', () => {
    const data: EarningsDelivery = {
      ...baseDelivery,
      deliveryId: 'del-cancelled-1',
      kind: 'CANCELLATION_COMPENSATION',
    }
    const dto = new EarningsDeliveryCourierDto(data)

    expect(dto.kind).toBe('CANCELLATION_COMPENSATION')
    expect(dto.deliveryId).toBe('del-cancelled-1')
    expect(dto.compensation).toBe(500)
    expect(dto.total).toBe(600)
  })

  test('sets kind to REASSIGNMENT_COMPENSATION when provided', () => {
    const data: EarningsDelivery = {
      ...baseDelivery,
      deliveryId: 'del-reassigned-1',
      kind: 'REASSIGNMENT_COMPENSATION',
    }
    const dto = new EarningsDeliveryCourierDto(data)

    expect(dto.kind).toBe('REASSIGNMENT_COMPENSATION')
    expect(dto.deliveryId).toBe('del-reassigned-1')
  })

  test('leaves kind undefined for a standard drop-off delivery with no kind', () => {
    const dto = new EarningsDeliveryCourierDto(baseDelivery)

    expect(dto.kind).toBeUndefined()
    expect(dto.deliveryId).toBe('del-completed-1')
  })

  test('maps all delivery fields faithfully from domain data', () => {
    const data: EarningsDelivery = {
      deliveryId: 'del-full-data',
      droppedOffAt: new Date('2026-07-10T14:30:00.000Z'),
      dropoffAddress: 'Ermou 4, Volos',
      pickupBusinessName: 'O Gyros tis Elladas',
      compensation: 750,
      tips: 150,
      total: 900,
      kind: 'CANCELLATION_COMPENSATION',
    }
    const dto = new EarningsDeliveryCourierDto(data)

    expect(dto.deliveryId).toBe('del-full-data')
    expect(dto.droppedOffAt).toEqual(new Date('2026-07-10T14:30:00.000Z'))
    expect(dto.dropoffAddress).toBe('Ermou 4, Volos')
    expect(dto.pickupBusinessName).toBe('O Gyros tis Elladas')
    expect(dto.compensation).toBe(750)
    expect(dto.tips).toBe(150)
    expect(dto.total).toBe(900)
    expect(dto.kind).toBe('CANCELLATION_COMPENSATION')
  })
})

describe('EarningsDayCourierDto (Spec 0015 AC-15, Row 32 verify fix)', () => {
  const meta = {
    date: '2026-07-10',
    timezone: 'Europe/Athens',
    currency: 'EUR',
  }

  test('keeps each line item kind for a day with drop-off, reassignment, and cancellation', () => {
    const dropoff: EarningsDelivery = {
      deliveryId: 'del-dropoff-1',
      droppedOffAt: new Date('2026-07-10T10:00:00.000Z'),
      dropoffAddress: 'Iasonos 12, Volos',
      pickupBusinessName: 'Ta Koutsavakia',
      compensation: 500,
      tips: 100,
      total: 600,
    }

    const reassignment: EarningsDelivery = {
      deliveryId: 'del-reassigned-2',
      droppedOffAt: new Date('2026-07-10T12:00:00.000Z'),
      dropoffAddress: 'Ermou 4, Volos',
      pickupBusinessName: 'O Gyros tis Elladas',
      compensation: 300,
      tips: 0,
      total: 300,
      kind: 'REASSIGNMENT_COMPENSATION',
    }

    const cancellation: EarningsDelivery = {
      deliveryId: 'del-cancelled-3',
      droppedOffAt: new Date('2026-07-10T15:00:00.000Z'),
      dropoffAddress: 'Dimitriadis 100, Volos',
      pickupBusinessName: 'Taverna Nosh',
      compensation: 400,
      tips: 0,
      total: 400,
      kind: 'CANCELLATION_COMPENSATION',
    }

    const dto = new EarningsDayCourierDto([dropoff, reassignment, cancellation], meta)

    // Verify DTO structure and kinds
    expect(dto.deliveries).toHaveLength(3)
    expect(dto.deliveries[0]?.kind).toBeUndefined()
    expect(dto.deliveries[1]?.kind).toBe('REASSIGNMENT_COMPENSATION')
    expect(dto.deliveries[2]?.kind).toBe('CANCELLATION_COMPENSATION')

    // Under Row 112: only the completed drop-off line (no kind) counts as a delivery.
    // The reassignment and cancellation compensation lines do not increment deliveryCount.
    expect(dto.deliveryCount).toBe(1)
    expect(dto.compensation).toBe(1200) // 500 + 300 + 400
    expect(dto.tips).toBe(100) // 100 + 0 + 0
    expect(dto.total).toBe(1300) // 600 + 300 + 400

    // Verify wire JSON serialization (JSON.parse(JSON.stringify(dto)))
    const json = JSON.parse(JSON.stringify(dto))
    expect(json.date).toBe('2026-07-10')
    expect(json.timezone).toBe('Europe/Athens')
    expect(json.currency).toBe('EUR')
    expect(json.deliveries).toHaveLength(3)
    expect(json.deliveries[0]?.kind).toBeUndefined()
    expect(json.deliveries[1]?.kind).toBe('REASSIGNMENT_COMPENSATION')
    expect(json.deliveries[2]?.kind).toBe('CANCELLATION_COMPENSATION')
    expect(json.deliveryCount).toBe(1)
    expect(json.total).toBe(1300)
  })

  test('handles an empty day with zero totals and empty deliveries', () => {
    const dto = new EarningsDayCourierDto([], meta)

    expect(dto.deliveries).toEqual([])
    expect(dto.deliveryCount).toBe(0)
    expect(dto.compensation).toBe(0)
    expect(dto.tips).toBe(0)
    expect(dto.total).toBe(0)

    const json = JSON.parse(JSON.stringify(dto))
    expect(json.deliveries).toEqual([])
    expect(json.deliveryCount).toBe(0)
  })
})

/**
 * Row 112 / Decision 112.1:
 * "Honest labels for cancelled and removal only jobs.
 * Done when: a job the rider did not deliver never says 'Delivered'; a day with removal
 * or wait money but no delivery shows that money instead of 'No Orders Today'.
 * The backend half: the day endpoint's deliveryCount counts only lines without a `kind`,
 * as earnings-summary.util already does."
 */
describe('EarningsDayCourierDto (Row 112: honest delivery count)', () => {
  const meta = {
    date: '2026-07-10',
    timezone: 'Europe/Athens',
    currency: 'EUR',
  }

  // Helper to build a plain drop-off delivery (no kind)
  const makeDropoff = (
    id: string,
    compensation = 500,
    tips = 100
  ): EarningsDelivery => ({
    deliveryId: id,
    droppedOffAt: new Date('2026-07-10T10:00:00.000Z'),
    dropoffAddress: 'Iasonos 12, Volos',
    pickupBusinessName: 'Ta Koutsavakia',
    compensation,
    tips,
    total: compensation + tips,
  })

  // Helper to build a non-dropoff compensation line (has a kind)
  const makeCompensationLine = (
    id: string,
    kind: NonNullable<EarningsDelivery['kind']>,
    compensation = 300,
    tips = 0
  ): EarningsDelivery => ({
    deliveryId: id,
    droppedOffAt: new Date('2026-07-10T11:00:00.000Z'),
    dropoffAddress: 'Ermou 4, Volos',
    pickupBusinessName: 'O Gyros tis Elladas',
    compensation,
    tips,
    total: compensation + tips,
    kind,
  })

  test('a day of one plain drop off (no kind) has deliveryCount 1', () => {
    // One delivered order with piece-rate compensation and tips
    const dropoff = makeDropoff('del-1', 450, 150)
    const dto = new EarningsDayCourierDto([dropoff], meta)

    expect(dto.deliveryCount).toBe(1)
    expect(dto.compensation).toBe(450)
    expect(dto.tips).toBe(150)
    expect(dto.total).toBe(600)
    expect(dto.deliveries).toHaveLength(1)
    expect(dto.deliveries[0]?.kind).toBeUndefined()
  })

  describe('a day of only lines with a kind has deliveryCount 0, while compensation, tips and total still sum every line', () => {
    const allKinds: NonNullable<EarningsDelivery['kind']>[] = [
      'WAITING',
      'REMOVAL_COMPENSATION',
      'RETURN_TRIP',
      'CANCELLATION_COMPENSATION',
      'REASSIGNMENT_COMPENSATION',
    ]

    test.each(allKinds)(
      'a day of only a single %s line has deliveryCount 0 while summing totals',
      (kind) => {
        // Line item represents a compensation award without a completed delivery
        const line = makeCompensationLine(`comp-${kind}`, kind, 350, 50)
        const dto = new EarningsDayCourierDto([line], meta)

        expect(dto.deliveryCount).toBe(0)
        expect(dto.compensation).toBe(350)
        expect(dto.tips).toBe(50)
        expect(dto.total).toBe(400)
        expect(dto.deliveries).toHaveLength(1)
        expect(dto.deliveries[0]?.kind).toBe(kind)
      }
    )

    test('a day containing all five compensation kinds has deliveryCount 0 and sums all amounts', () => {
      // Setup one line item for each known compensation kind on the same day
      const lines: EarningsDelivery[] = [
        makeCompensationLine('comp-wait', 'WAITING', 200, 0),
        makeCompensationLine('comp-removal', 'REMOVAL_COMPENSATION', 300, 0),
        makeCompensationLine('comp-return', 'RETURN_TRIP', 400, 0),
        makeCompensationLine('comp-cancel', 'CANCELLATION_COMPENSATION', 500, 50),
        makeCompensationLine('comp-reassign', 'REASSIGNMENT_COMPENSATION', 250, 0),
      ]

      const dto = new EarningsDayCourierDto(lines, meta)

      // None of the compensation lines is a completed delivery
      expect(dto.deliveryCount).toBe(0)
      expect(dto.compensation).toBe(1650) // 200 + 300 + 400 + 500 + 250
      expect(dto.tips).toBe(50)
      expect(dto.total).toBe(1700)
      expect(dto.deliveries).toHaveLength(5)
    })
  })

  test('a mixed day (two drop offs, one wait, one cancelled job) has deliveryCount 2 and the totals of all four lines', () => {
    // Two completed drop-offs
    const dropoff1 = makeDropoff('del-dropoff-1', 500, 100)
    const dropoff2 = makeDropoff('del-dropoff-2', 650, 50)

    // Two compensation lines (wait pay at restaurant + cancellation award)
    const waitLine = makeCompensationLine('comp-wait-1', 'WAITING', 200, 0)
    const cancelledLine = makeCompensationLine('comp-cancel-1', 'CANCELLATION_COMPENSATION', 350, 0)

    const dto = new EarningsDayCourierDto(
      [dropoff1, dropoff2, waitLine, cancelledLine],
      meta
    )

    // Only the two drop-offs count towards deliveryCount
    expect(dto.deliveryCount).toBe(2)
    // Compensation sums all 4 lines: 500 + 650 + 200 + 350 = 1700
    expect(dto.compensation).toBe(1700)
    // Tips sum all 4 lines: 100 + 50 + 0 + 0 = 150
    expect(dto.tips).toBe(150)
    // Total is compensation + tips: 1700 + 150 = 1850
    expect(dto.total).toBe(1850)
    expect(dto.deliveries).toHaveLength(4)

    // Verify wire JSON output matches
    const json = JSON.parse(JSON.stringify(dto))
    expect(json.deliveryCount).toBe(2)
    expect(json.compensation).toBe(1700)
    expect(json.tips).toBe(150)
    expect(json.total).toBe(1850)
  })

  test('the day deliveryCount equals what earnings-summary.util gives for the same lines on that day', () => {
    // Feed the same domain rows to both listEarningsDeliveriesForDay (which builds
    // the day drilldown input) and summarizeEarningsByDay (which builds the summary)
    const deliveryRows: CourierEarningsDeliveryRow[] = [
      {
        deliveryId: 'del-dropoff-1',
        droppedOffAt: new Date('2026-07-10T09:30:00.000Z'),
        totalCompensation: 500,
        tips: 100,
        dropoffAddress: 'Iasonos 12, Volos',
        pickupBusinessName: 'Ta Koutsavakia',
      },
      {
        deliveryId: 'del-dropoff-2',
        droppedOffAt: new Date('2026-07-10T12:00:00.000Z'),
        totalCompensation: 600,
        tips: 50,
        dropoffAddress: 'Ermou 4, Volos',
        pickupBusinessName: 'O Gyros tis Elladas',
      },
    ]

    const compensationRows: CourierCompensationDeliveryRow[] = [
      {
        deliveryId: 'del-comp-wait',
        amount: 200,
        reason: EnumCourierCompensationReason.WAITING,
        createdAt: new Date('2026-07-10T14:00:00.000Z'),
        pickupBusinessName: 'Taverna Nosh',
        dropoffLocation: null,
      },
      {
        deliveryId: 'del-comp-cancel',
        amount: 350,
        reason: EnumCourierCompensationReason.CANCELLATION,
        createdAt: new Date('2026-07-10T16:00:00.000Z'),
        pickupBusinessName: 'Taverna Nosh',
        dropoffLocation: null,
      },
      {
        deliveryId: 'del-comp-removal',
        amount: 300,
        reason: EnumCourierCompensationReason.REMOVAL,
        createdAt: new Date('2026-07-10T18:00:00.000Z'),
        pickupBusinessName: 'O Gyros tis Elladas',
        dropoffLocation: null,
      },
    ]

    // 1. Generate EarningsDelivery[] via listEarningsDeliveriesForDay (drilldown path)
    const deliveries = listEarningsDeliveriesForDay(
      deliveryRows,
      '2026-07-10',
      'Europe/Athens',
      compensationRows
    )
    const dto = new EarningsDayCourierDto(deliveries, meta)

    // 2. Generate EarningsDaySummary[] via summarizeEarningsByDay (summary path)
    const summaries = summarizeEarningsByDay(
      deliveryRows,
      'Europe/Athens',
      compensationRows
    )
    const summary = summaries.find((s) => s.date === '2026-07-10')
    expect(summary).toBeDefined()

    // 3. Both must report the exact same deliveryCount and financial totals
    expect(dto.deliveryCount).toBe(summary!.deliveryCount)
    expect(dto.deliveryCount).toBe(2)
    expect(summary!.deliveryCount).toBe(2)

    expect(dto.compensation).toBe(summary!.compensation)
    expect(dto.compensation).toBe(1950) // 500 + 600 + 200 + 350 + 300

    expect(dto.tips).toBe(summary!.tips)
    expect(dto.tips).toBe(150) // 100 + 50

    expect(dto.total).toBe(summary!.total)
    expect(dto.total).toBe(2100) // 1950 + 150
  })

  test('deliveryCount equals what earnings-summary.util gives for a day of only compensation rows (zero deliveries)', () => {
    // A day with zero drop-offs and only compensation payments
    const compensationRows: CourierCompensationDeliveryRow[] = [
      {
        deliveryId: 'del-comp-wait-only',
        amount: 250,
        reason: EnumCourierCompensationReason.WAITING,
        createdAt: new Date('2026-07-10T11:00:00.000Z'),
        pickupBusinessName: 'Ta Koutsavakia',
        dropoffLocation: null,
      },
      {
        deliveryId: 'del-comp-cancel-only',
        amount: 400,
        reason: EnumCourierCompensationReason.CANCELLATION,
        createdAt: new Date('2026-07-10T15:00:00.000Z'),
        pickupBusinessName: 'O Gyros tis Elladas',
        dropoffLocation: null,
      },
    ]

    const deliveries = listEarningsDeliveriesForDay(
      [],
      '2026-07-10',
      'Europe/Athens',
      compensationRows
    )
    const dto = new EarningsDayCourierDto(deliveries, meta)

    const summaries = summarizeEarningsByDay(
      [],
      'Europe/Athens',
      compensationRows
    )
    const summary = summaries.find((s) => s.date === '2026-07-10')
    expect(summary).toBeDefined()

    // Both must agree on 0 deliveries, while reporting the compensation amount
    expect(dto.deliveryCount).toBe(summary!.deliveryCount)
    expect(dto.deliveryCount).toBe(0)
    expect(summary!.deliveryCount).toBe(0)

    expect(dto.compensation).toBe(summary!.compensation)
    expect(dto.compensation).toBe(650)
    expect(dto.total).toBe(summary!.total)
    expect(dto.total).toBe(650)
  })
})
