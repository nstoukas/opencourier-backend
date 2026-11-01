import { EarningsDelivery } from 'src/domains/delivery-event/types/earnings-summary.type'
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

    // Verify calculated totals
    expect(dto.deliveryCount).toBe(3)
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
    expect(json.deliveryCount).toBe(3)
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
