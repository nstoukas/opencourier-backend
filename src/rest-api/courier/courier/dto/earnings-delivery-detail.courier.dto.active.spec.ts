import { EarningsDelivery } from 'src/domains/delivery-event/types/earnings-summary.type'
import { EarningsDeliveryDetailCourierDto } from './earnings-delivery-detail.courier.dto'

describe('EarningsDeliveryDetailCourierDto (Spec 0035 AC-17)', () => {
  const baseEntry: EarningsDelivery = {
    deliveryId: 'del-dto-detail',
    droppedOffAt: new Date('2026-07-10T10:00:00.000Z'),
    dropoffAddress: 'Iasonos 12, Volos',
    pickupBusinessName: 'Ta Koutsavakia',
    compensation: 500,
    tips: 50,
    total: 700,
    removalPay: 150,
  }

  test('EarningsDeliveryDetailCourierDto carries removalPay: new EarningsDeliveryDetailCourierDto(entry, { currency }) has the entry\'s removalPay', () => {
    const dto = new EarningsDeliveryDetailCourierDto(baseEntry, { currency: 'EUR' })

    expect(dto.removalPay).toBe(150)
  })
})
