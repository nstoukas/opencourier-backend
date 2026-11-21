import { EnumDeliveryStatus } from '@prisma/types'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { DeliveryPartnerRestApiController } from './delivery.partner.rest-api.controller'

// Spec 0047 (AC-8, AC-10): the restaurant is told which of its orders were split at pickup (SPLIT) or left
// unsplit and cancelled to send again (LEFT). request-web words the two; this is the value it reads.
describe('DeliveryPartnerRestApiController - splitOutcome (spec 0047)', () => {
  const partner = new PartnerEntity({ id: 'partner-1' } as any)

  const delivery = (id: string, deliveryQuoteId: string, status: EnumDeliveryStatus = EnumDeliveryStatus.ACCEPTED) =>
    new DeliveryEntity({
      id,
      status,
      deliveryQuoteId,
      pickupLocationId: 'loc-1',
      dropoffLocationId: 'loc-2',
      pickupLocation: { id: 'loc-1' } as any,
      dropoffLocation: { id: 'loc-2' } as any,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any)

  const withRelations = (entity: DeliveryEntity) => ({
    delivery: entity,
    courierWithSettings: null,
    pickupLocation: { id: 'loc-1' },
    dropoffLocation: { id: 'loc-2' },
  })

  function setup(outcomes: Record<string, 'SPLIT' | 'LEFT'>) {
    const service = {
      getManyByPartnerId: jest.fn(),
      getByIdWithRelations: jest.fn(),
      getOrderLegsWithRelations: jest.fn(),
    }
    const splitRequestRepository = {
      findOutcomesForDeliveries: jest.fn().mockResolvedValue(new Map(Object.entries(outcomes))),
    }
    const controller = new DeliveryPartnerRestApiController(service as any, {} as any, splitRequestRepository as any)
    return { controller, service, splitRequestRepository }
  }

  it('the history list marks each order SPLIT, LEFT or null, asking by delivery id and quote id', async () => {
    const { controller, service, splitRequestRepository } = setup({ 'del-kept': 'SPLIT', 'del-left': 'LEFT' })
    service.getManyByPartnerId.mockResolvedValue({
      data: [delivery('del-kept', 'quote-1'), delivery('del-left', 'quote-2', EnumDeliveryStatus.CANCELED), delivery('del-plain', 'quote-3')],
      historyDays: 30,
      pagination: undefined,
    })

    const dto = await controller.listDeliveries({ page: 1, perPage: 10 }, partner)

    expect(splitRequestRepository.findOutcomesForDeliveries).toHaveBeenCalledWith([
      { id: 'del-kept', deliveryQuoteId: 'quote-1' },
      { id: 'del-left', deliveryQuoteId: 'quote-2' },
      { id: 'del-plain', deliveryQuoteId: 'quote-3' },
    ])
    expect(dto.data.map((row) => [row.id, row.splitOutcome])).toEqual([
      ['del-kept', 'SPLIT'],
      ['del-left', 'LEFT'],
      ['del-plain', null],
    ])
  })

  it('a single delivery carries its outcome', async () => {
    const { controller, service } = setup({ 'del-left': 'LEFT' })
    service.getByIdWithRelations.mockResolvedValue(withRelations(delivery('del-left', 'quote-2', EnumDeliveryStatus.CANCELED)))

    const dto = await controller.getDelivery('del-left', partner)

    expect(dto.splitOutcome).toBe('LEFT')
    // Restaurants read their own order only: the lookup goes through the ownership check.
    expect(service.getByIdWithRelations).toHaveBeenCalledWith('del-left', 'partner-1')
  })

  it('an order that was never split carries null, not undefined', async () => {
    const { controller, service } = setup({})
    service.getByIdWithRelations.mockResolvedValue(withRelations(delivery('del-plain', 'quote-3')))

    const dto = await controller.getDelivery('del-plain', partner)

    expect(dto.splitOutcome).toBeNull()
  })

  it("the order's legs each carry SPLIT after a split", async () => {
    const { controller, service } = setup({ 'del-kept': 'SPLIT', 'del-new': 'SPLIT' })
    service.getOrderLegsWithRelations.mockResolvedValue({
      legs: [withRelations(delivery('del-kept', 'quote-1')), withRelations(delivery('del-new', 'quote-split'))],
      missingLegNumbers: [],
    })

    const result = await controller.getOrderLegs('del-kept', partner)

    expect(result.legs.map((leg) => [leg.id, leg.splitOutcome])).toEqual([
      ['del-kept', 'SPLIT'],
      ['del-new', 'SPLIT'],
    ])
    expect(result.missingLegNumbers).toEqual([])
  })
})
