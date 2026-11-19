import { ConflictException } from '@nestjs/common'
import { CourierDomainService, OFFLINE_POSITION_REFUSED_MESSAGE } from './courier.domain.service'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import { EnumCourierStatus, EnumCourierStatusChangeCause, Prisma } from '@prisma/types'
import { CourierEntity } from './entities/courier.entity'

describe('CourierDomainService', () => {
  let service: CourierDomainService
  let mockCourierRepository: jest.Mocked<CourierRepository>

  beforeEach(() => {
    mockCourierRepository = {
      findManyPaginated: jest.fn(),
      findByIdOrThrow: jest.fn(),
      findById: jest.fn(),
      updateById: jest.fn(),
      create: jest.fn(),
      updateCurrentLocationById: jest.fn(),
      changeStatus: jest.fn(),
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

  describe('updateCurrentLocation (spec 0038 AC-14)', () => {
    test('succeeds when location is stored (Online or busy rider)', async () => {
      mockCourierRepository.updateCurrentLocationById.mockResolvedValue(true)

      await expect(
        service.updateCurrentLocation('courier-1', { latitude: 39.36, longitude: 22.94 })
      ).resolves.toBeUndefined()

      expect(mockCourierRepository.updateCurrentLocationById).toHaveBeenCalledWith('courier-1', {
        latitude: 39.36,
        longitude: 22.94,
      })
    })

    test('refuses with 409 ConflictException when rider is Offline and holds no active delivery', async () => {
      mockCourierRepository.updateCurrentLocationById.mockResolvedValue(false)

      await expect(
        service.updateCurrentLocation('courier-1', { latitude: 39.36, longitude: 22.94 })
      ).rejects.toThrow(new ConflictException(OFFLINE_POSITION_REFUSED_MESSAGE))
    })
  })

  describe('update (spec 0040 AC-1)', () => {
    test('routes update through updateById', async () => {
      mockCourierRepository.updateById.mockResolvedValue({ id: 'courier-1' } as any)

      await service.update('courier-1', {
        firstName: 'Updated',
      } as any)

      expect(mockCourierRepository.updateById).toHaveBeenCalledWith('courier-1', { firstName: 'Updated' })
    })
  })

  describe('changeStatus (spec 0040 AC-1)', () => {
    test('forwards arguments to courierRepository.changeStatus', async () => {
      mockCourierRepository.changeStatus.mockResolvedValue({ changed: true, fromStatus: EnumCourierStatus.ONLINE })

      const result = await service.changeStatus('courier-1', EnumCourierStatus.OFFLINE, EnumCourierStatusChangeCause.RIDER)

      expect(mockCourierRepository.changeStatus).toHaveBeenCalledWith(
        'courier-1',
        EnumCourierStatus.OFFLINE,
        EnumCourierStatusChangeCause.RIDER,
        undefined
      )
      expect(result).toEqual({ changed: true, fromStatus: EnumCourierStatus.ONLINE })
    })

    test('forwards adminUserId when provided', async () => {
      mockCourierRepository.changeStatus.mockResolvedValue({ changed: true, fromStatus: EnumCourierStatus.ONLINE })

      await service.changeStatus(
        'courier-1',
        EnumCourierStatus.OFFLINE,
        EnumCourierStatusChangeCause.ADMIN,
        'admin-user-1'
      )

      expect(mockCourierRepository.changeStatus).toHaveBeenCalledWith(
        'courier-1',
        EnumCourierStatus.OFFLINE,
        EnumCourierStatusChangeCause.ADMIN,
        'admin-user-1'
      )
    })
  })
})
