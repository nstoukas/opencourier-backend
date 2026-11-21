import { EnumQuoteSource } from '@prisma/types'
import { DeliveryCalculationService } from './delivery-calculation.service'

// Spec 0047 (AC-6, cross check 4): a leg made by a split has a copied quote marked SPLIT. Its rider is paid
// in full (the quote's baseFee + distanceFee, binding value 3), the customer pays nothing more, and the
// co-op takes no fee, so no negative fee is ever computed.
describe('DeliveryCalculationService - a split leg (spec 0047)', () => {
  const DELIVERY_ID = 'new-leg-2'
  const COURIER_ID = 'rider-2'

  function setup(quote: Record<string, unknown>) {
    const deliveryRepository = {
      findById: jest.fn().mockResolvedValue({ id: DELIVERY_ID, deliveryQuoteId: 'quote-split', matchedCourierId: COURIER_ID }),
    }
    const deliveryQuoteRepository = { findById: jest.fn().mockResolvedValue(quote) }
    // The rider's pay is worked out by its own service from the quote's two parts; here it answers their sum.
    const courierCompensationService = {
      calculateCourierCompensationForDelivery: jest
        .fn()
        .mockResolvedValue((quote.baseFee as number) + (quote.distanceFee as number)),
    }
    const service = new DeliveryCalculationService(
      { instanceConfig: {} } as any,
      deliveryRepository as any,
      deliveryQuoteRepository as any,
      {} as any,
      {} as any,
      courierCompensationService as any,
      {} as any
    )
    return { service, courierCompensationService }
  }

  const splitQuote = {
    id: 'quote-split',
    source: EnumQuoteSource.SPLIT,
    quote: 0,
    quoteRangeFrom: 0,
    quoteRangeTo: 0,
    feePercentage: 0,
    baseFee: 200,
    distanceFee: 156,
  }

  it("pays the rider in full and costs the customer nothing: pay 356, total 0, fee 0, fee % 0", async () => {
    const { service } = setup(splitQuote)

    const amounts = await service.calculateDeliveryAmountsForMatchedCourier({ deliveryId: DELIVERY_ID })

    expect(amounts).toEqual({
      deliveryId: DELIVERY_ID,
      totalCompensation: 356,
      totalCost: 0,
      fee: 0,
      feePercentage: 0,
    })
  })

  it('never computes a negative fee for a split leg (0 minus the rider pay would be -356)', async () => {
    const { service } = setup(splitQuote)
    const amounts = await service.calculateDeliveryAmountsForMatchedCourier({ deliveryId: DELIVERY_ID })
    expect(amounts.fee).toBe(0)
    expect(amounts.fee).toBeGreaterThanOrEqual(0)
  })

  it('forces price 0 and fee 0 for a SPLIT quote even if its stored price fields were not 0', async () => {
    // Cross check 4: "A SPLIT quote forces fee 0, fee % 0 and customer price 0".
    const { service } = setup({ ...splitQuote, quoteRangeFrom: 450, quoteRangeTo: 450, feePercentage: 20 })
    const amounts = await service.calculateDeliveryAmountsForMatchedCourier({ deliveryId: DELIVERY_ID })
    expect(amounts).toMatchObject({ totalCompensation: 356, totalCost: 0, fee: 0, feePercentage: 0 })
  })

  it("asks for this leg's own rider pay, for the rider it is matched to", async () => {
    const { service, courierCompensationService } = setup(splitQuote)
    await service.calculateDeliveryAmountsForMatchedCourier({ deliveryId: DELIVERY_ID })
    expect(courierCompensationService.calculateCourierCompensationForDelivery).toHaveBeenCalledWith({
      courierId: COURIER_ID,
      deliveryId: DELIVERY_ID,
    })
  })

  it("an ordinary restaurant quote is unchanged: the customer's price and the co-op's fee come from the quote", async () => {
    const { service } = setup({ ...splitQuote, source: EnumQuoteSource.PARTNER, quoteRangeFrom: 450, quoteRangeTo: 450, feePercentage: 20 })
    const amounts = await service.calculateDeliveryAmountsForMatchedCourier({ deliveryId: DELIVERY_ID })
    expect(amounts).toEqual({
      deliveryId: DELIVERY_ID,
      totalCompensation: 356,
      totalCost: 450,
      fee: 94,
      feePercentage: 20,
    })
  })
})
