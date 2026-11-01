import { CourierDomainService } from './courier.domain.service'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import { EnumCourierStatus, Prisma } from '@prisma/types'
import { CourierEntity } from './entities/courier.entity'

describe('CourierDomainService (scope row 97, Clause 3)', () => {
  let service: CourierDomainService
  let mockCourierRepository: jest.Mocked<CourierRepository>

  beforeEach(() => {
    mockCourierRepository = {
      findManyPaginated: jest.fn(),
      findByIdOrThrow: jest.fn(),
      findById: jest.fn(),
      updateById: jest.fn(),
      create: jest.fn(),
    } as unknown as jest.Mocked<CourierRepository>

    service = new CourierDomainService(mockCourierRepository)
  })

  describe('getManyCouriers', () => {
    test('forwards where, page, and perPage to courierRepository.findManyPaginated', async () => {
      const mockResult = {
        data: [] as CourierEntity[],
        pagination: {
          perPage: 10,
          totalItems: 0,
          totalPages: 0,
          currentItems: 0,
          currentPage: 1,
          prevPage: null,
          nextPage: null,
        },
      }
      mockCourierRepository.findManyPaginated.mockResolvedValue(mockResult)

      const where: Prisma.CourierWhereInput = {
        status: { in: [EnumCourierStatus.ONLINE, EnumCourierStatus.LAST_CALL] },
        AND: [
          {
            OR: [
              { firstName: { contains: 'Giorgos', mode: Prisma.QueryMode.insensitive } },
            ],
          },
        ],
      }

      const result = await service.getManyCouriers(where, 1, 10)

      expect(mockCourierRepository.findManyPaginated).toHaveBeenCalledTimes(1)
      expect(mockCourierRepository.findManyPaginated).toHaveBeenCalledWith(where, 1, 10)
      expect(result).toBe(mockResult)
    })

    test('Clause 3: fails if where is dropped on the way to findManyPaginated', async () => {
      const where: Prisma.CourierWhereInput = {
        status: EnumCourierStatus.OFFLINE,
      }

      await service.getManyCouriers(where, 2, 20)

      const call = mockCourierRepository.findManyPaginated.mock.calls[0]
      expect(call).toBeDefined()
      expect(call![0]).toBe(where)
      expect(call![0]).toEqual({ status: EnumCourierStatus.OFFLINE })
    })

    test('Clause 3: fails if page or perPage is dropped on the way to findManyPaginated', async () => {
      const where: Prisma.CourierWhereInput = {}

      await service.getManyCouriers(where, 3, 50)

      const call = mockCourierRepository.findManyPaginated.mock.calls[0]
      expect(call).toBeDefined()
      expect(call![1]).toBe(3)
      expect(call![2]).toBe(50)
    })
  })
})
