import { DeliveryPartnerPaginatedDto } from './delivery.partner.paginated.dto'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { EnumDeliveryStatus } from '@prisma/types'
import { PaginationDto } from 'src/core/dtos/PaginationDto'

describe('DeliveryPartnerPaginatedDto (Spec 0017, AC-2)', () => {
  const mockDelivery = new DeliveryEntity({
    id: 'del-123',
    status: EnumDeliveryStatus.ACCEPTED,
    pickupLocationId: 'loc-pickup-1',
    dropoffLocationId: 'loc-dropoff-1',
    pickupLocation: { id: 'loc-pickup-1' } as any,
    dropoffLocation: { id: 'loc-dropoff-1' } as any,
    createdAt: new Date('2026-11-01T10:00:00.000Z'),
    updatedAt: new Date('2026-11-01T10:00:00.000Z'),
  } as any)

  const mockPagination: PaginationDto = {
    totalItems: 1,
    currentItems: 1,
    totalPages: 1,
    currentPage: 1,
    perPage: 20,
    prevPage: null,
    nextPage: null,
  }

  it('carries historyDays and maps data and pagination', () => {
    const rawData = {
      data: [mockDelivery],
      pagination: mockPagination,
    }

    const dto = new DeliveryPartnerPaginatedDto(rawData, 30)

    expect(dto.historyDays).toBe(30)
    expect(dto.data).toHaveLength(1)
    expect(dto.data[0]?.id).toBe('del-123')
    expect(dto.pagination).toEqual(mockPagination)
  })

  it('exposes historyDays with configured value (e.g. 7 or 1)', () => {
    const rawData = {
      data: [],
      pagination: undefined,
    }

    const dto7 = new DeliveryPartnerPaginatedDto(rawData, 7)
    expect(dto7.historyDays).toBe(7)

    const dto1 = new DeliveryPartnerPaginatedDto(rawData, 1)
    expect(dto1.historyDays).toBe(1)
  })
})
