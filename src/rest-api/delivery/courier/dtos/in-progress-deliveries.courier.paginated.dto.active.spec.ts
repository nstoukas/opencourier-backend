import { InProgressDeliveriesCourierPaginatedDto } from './in-progress-deliveries.courier.paginated.dto'
import { EnumDeliveryStatus } from '@prisma/types'

describe('InProgressDeliveriesCourierPaginatedDto (Spec 0020 AC-3)', () => {
  it('stamps serverNow as a Date on construction', () => {
    const before = Date.now()
    const dto = new InProgressDeliveriesCourierPaginatedDto({
      data: [],
      pagination: {
        totalItems: 0,
        totalPages: 1,
        currentItems: 0,
        currentPage: 1,
        perPage: 10,
        prevPage: null,
        nextPage: null,
      },
    }, 10)
    const after = Date.now()

    expect(dto.serverNow).toBeInstanceOf(Date)
    expect(dto.waitLimitMinutes).toBe(10)
    expect(dto.serverNow.getTime()).toBeGreaterThanOrEqual(before)
    expect(dto.serverNow.getTime()).toBeLessThanOrEqual(after)
  })

  it('maps data array to InProgressDeliveryCourierDto and assigns pagination', () => {
    const mockOrder: any = {
      id: 'del-prog-1',
      status: EnumDeliveryStatus.ACCEPTED,
      createdAt: new Date(),
      pickupBusinessName: 'Test Kitchen',
      pickupLocation: { id: 'loc-1', street: 'Iasonos 10' },
      dropoffLocation: { id: 'loc-2', street: 'Dimitriadis 20' },
      pickupLocationNotes: [],
      dropoffLocationNotes: [],
    }

    const pagination = {
      totalItems: 1,
      totalPages: 1,
      currentItems: 1,
      currentPage: 1,
      perPage: 10,
      prevPage: null,
      nextPage: null,
    }

    const dto = new InProgressDeliveriesCourierPaginatedDto({
      data: [mockOrder],
      pagination,
    }, 15)

    expect(dto.data).toHaveLength(1)
    expect(dto.data[0]?.id).toBe('del-prog-1')
    expect(dto.pagination).toEqual(pagination)
    expect(dto.waitLimitMinutes).toBe(15)
  })
})
