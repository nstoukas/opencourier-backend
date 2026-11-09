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

  describe('leaveFrom in job list (Spec 0033 AC-5, decision 23.15)', () => {
    const pagination = {
      totalItems: 1,
      totalPages: 1,
      currentItems: 1,
      currentPage: 1,
      perPage: 10,
      prevPage: null,
      nextPage: null,
    }

    const baseOrder: any = {
      id: 'del-prog-2',
      status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
      createdAt: new Date(),
      pickupBusinessName: 'Test Kitchen',
      pickupLocation: { id: 'loc-1', street: 'Iasonos 10' },
      dropoffLocation: { id: 'loc-2', street: 'Dimitriadis 20' },
      pickupLocationNotes: [],
      dropoffLocationNotes: [],
      foodReadyAt: null,
    }

    it('arrived before the promise: leaveFrom is promise plus the limit', () => {
      // Promised 10:00, arrived 09:50, limit 10 -> leaveFrom 10:10
      const order = {
        ...baseOrder,
        promisedReadyAt: new Date('2026-11-09T10:00:00.000Z'),
        arrivedAtPickupAt: new Date('2026-11-09T09:50:00.000Z'),
      }
      const dto = new InProgressDeliveriesCourierPaginatedDto(
        { data: [order], pagination },
        defaultWaitRules
      )
      expect(dto.data[0]?.leaveFrom).toEqual(new Date('2026-11-09T10:10:00.000Z'))
    })

    it('arrived after the promise (10:20 for 10:00, limit 10): leaveFrom is arrival plus the limit (10:30)', () => {
      // Promised 10:00, arrived 10:20, limit 10 -> leaveFrom 10:30
      const order = {
        ...baseOrder,
        promisedReadyAt: new Date('2026-11-09T10:00:00.000Z'),
        arrivedAtPickupAt: new Date('2026-11-09T10:20:00.000Z'),
      }
      const dto = new InProgressDeliveriesCourierPaginatedDto(
        { data: [order], pagination },
        defaultWaitRules
      )
      expect(dto.data[0]?.leaveFrom).toEqual(new Date('2026-11-09T10:30:00.000Z'))
    })

    it('leaveFrom is null when arrivedAtPickupAt is null or missing', () => {
      const order = {
        ...baseOrder,
        promisedReadyAt: new Date('2026-11-09T10:00:00.000Z'),
        arrivedAtPickupAt: null,
      }
      const dto = new InProgressDeliveriesCourierPaginatedDto(
        { data: [order], pagination },
        defaultWaitRules
      )
      expect(dto.data[0]?.leaveFrom).toBeNull()
    })

    it('leaveFrom is null when promisedReadyAt is null or missing', () => {
      const order = {
        ...baseOrder,
        promisedReadyAt: null,
        arrivedAtPickupAt: new Date('2026-11-09T10:00:00.000Z'),
      }
      const dto = new InProgressDeliveriesCourierPaginatedDto(
        { data: [order], pagination },
        defaultWaitRules
      )
      expect(dto.data[0]?.leaveFrom).toBeNull()
    })
  })
})
