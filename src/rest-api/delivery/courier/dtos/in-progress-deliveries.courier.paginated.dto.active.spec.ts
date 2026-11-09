import { InProgressDeliveriesCourierPaginatedDto } from './in-progress-deliveries.courier.paginated.dto'
import { EnumDeliveryStatus } from '@prisma/types'
import { CourierWaitRules } from 'src/domains/delivery/wait-pay'

describe('InProgressDeliveriesCourierPaginatedDto (Spec 0020 AC-3, Spec 0033 AC-5)', () => {
  const defaultWaitRules: CourierWaitRules = {
    leaveMinutes: 10,
    freeMinutes: 10,
    payOn: true,
  }

  it('stamps serverNow as a Date on construction and leaves out waitLimitMinutes', () => {
    const before = Date.now()
    const dto = new InProgressDeliveriesCourierPaginatedDto(
      {
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
      },
      defaultWaitRules
    )
    const after = Date.now()

    expect(dto.serverNow).toBeInstanceOf(Date)
    expect((dto as any).waitLimitMinutes).toBeUndefined()
    expect(dto.serverNow.getTime()).toBeGreaterThanOrEqual(before)
    expect(dto.serverNow.getTime()).toBeLessThanOrEqual(after)
  })

  it('maps data array to InProgressDeliveryCourierDto with waitRules and assigns pagination', () => {
    const mockOrder: any = {
      id: 'del-prog-1',
      status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
      promisedReadyAt: new Date('2026-11-09T10:00:00.000Z'),
      arrivedAtPickupAt: new Date('2026-11-09T09:58:00.000Z'),
      foodReadyAt: null,
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

    const dto = new InProgressDeliveriesCourierPaginatedDto(
      {
        data: [mockOrder],
        pagination,
      },
      { leaveMinutes: 15, freeMinutes: 10, payOn: true }
    )

    expect(dto.data).toHaveLength(1)
    expect(dto.data[0]?.id).toBe('del-prog-1')
    expect(dto.pagination).toEqual(pagination)
    expect((dto as any).waitLimitMinutes).toBeUndefined()
    // leaveFrom and paidFrom are calculated on the delivery DTO
    expect(dto.data[0]?.leaveFrom).toEqual(new Date('2026-11-09T10:15:00.000Z'))
    expect(dto.data[0]?.paidFrom).toEqual(new Date('2026-11-09T10:10:00.000Z'))
  })
})
