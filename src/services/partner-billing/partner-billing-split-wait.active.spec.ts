import { EnumPartnerChargeReason } from '@prisma/types'
import { BillingChargeRow, PartnerBillingRepository } from 'src/persistence/repositories/partner-billing.repository'
import { PartnerBillingService } from './partner-billing.service'

// Spec 0047, cross check 3: on the restaurant's statement a split wait has its own wording ("Waiting while
// dispatch split the order"), so the line must say which WAITING charges are split waits. Adminweb words
// the line from this flag and from the reason SPLIT_LEG.
describe('PartnerBillingService - split charges on the statement (spec 0047)', () => {
  const PARTNER_ID = 'partner-1'
  const MONTH = '2026-11'

  const row = (overrides: Partial<BillingChargeRow>): BillingChargeRow => ({
    id: 'charge-1',
    partnerId: PARTNER_ID,
    deliveryId: 'del-1',
    amount: 100,
    currencyCode: 'EUR',
    reason: EnumPartnerChargeReason.WAITING,
    createdAt: new Date('2026-11-21T12:10:00Z'),
    billId: null,
    waitOf: null,
    removalOf: null,
    splitWaitOf: null,
    waitMinutes: 10,
    partner: { name: 'Volos Test Kitchen' },
    delivery: { orderReference: 'ORDER-77', cancelledAt: null },
    bill: null,
    ...overrides,
  })

  function setup(rows: BillingChargeRow[]) {
    const repository = {
      findChargesWrittenBetween: jest.fn().mockResolvedValue(rows),
      findUnbilledWrittenBefore: jest.fn().mockResolvedValue([]),
      findEventTimes: jest.fn().mockResolvedValue(new Map()),
      findRemovalRequests: jest.fn().mockResolvedValue(new Map()),
      findPartner: jest.fn().mockResolvedValue({ id: PARTNER_ID, name: 'Volos Test Kitchen', pickupLocation: null }),
      findBills: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<PartnerBillingRepository>
    return new PartnerBillingService(repository)
  }

  it('marks a WAITING charge keyed by a split request as a split wait, and an ordinary delay wait as not', async () => {
    const service = setup([
      row({ id: 'split-wait', splitWaitOf: 'split-req-1', waitMinutes: 7, amount: 70 }),
      row({ id: 'delay-wait', waitOf: 'del-1:evt-pickup', waitMinutes: 10, amount: 100 }),
    ])

    const month = await service.getPartnerMonth(MONTH, PARTNER_ID)

    const byId = Object.fromEntries(month.charges.map((line) => [line.id, line]))
    expect(byId['split-wait']).toMatchObject({ reason: EnumPartnerChargeReason.WAITING, splitWait: true, waitMinutes: 7, amount: 70 })
    expect(byId['delay-wait']).toMatchObject({ reason: EnumPartnerChargeReason.WAITING, splitWait: false, waitMinutes: 10, amount: 100 })
  })

  it("a new leg's charge keeps the reason SPLIT_LEG and its amount, and is not a split wait", async () => {
    const service = setup([
      row({ id: 'leg-charge', reason: EnumPartnerChargeReason.SPLIT_LEG, amount: 356, waitMinutes: null, deliveryId: 'new-leg-2' }),
    ])

    const month = await service.getPartnerMonth(MONTH, PARTNER_ID)

    expect(month.charges[0]).toMatchObject({
      id: 'leg-charge',
      reason: EnumPartnerChargeReason.SPLIT_LEG,
      amount: 356,
      deliveryId: 'new-leg-2',
      splitWait: false,
    })
  })

  it('the month total counts the split wait and the leg charge like any other charge', async () => {
    const service = setup([
      row({ id: 'split-wait', splitWaitOf: 'split-req-1', amount: 70 }),
      row({ id: 'leg-charge', reason: EnumPartnerChargeReason.SPLIT_LEG, amount: 356, waitMinutes: null }),
    ])

    const month = await service.getPartnerMonth(MONTH, PARTNER_ID)

    expect(month.totals).toEqual([{ currencyCode: 'EUR', charged: 426, billed: 0, unbilled: 426 }])
  })
})
