import { DeliveryNotFoundException } from 'src/errors'
import { EnumCancelledBy, EnumDeliveryStatus } from '@prisma/types'
import { DeliveryPartnerRestApiService } from './delivery.partner.rest-api.service'
import { partnerHistoryCutoff } from './partner-history'

describe('DeliveryPartnerRestApiService (Spec 0017, AC-2 & AC-3)', () => {
  let service: DeliveryPartnerRestApiService

  let mockDeliveryQuoteDomainService: any
  let mockDeliveryDomainService: any
  let mockPartnerDomainService: any
  let mockLocationDomainService: any
  let mockCourierDomainService: any
  let mockQuoteToDeliveryConversionService: any
  let mockDispatchStopRepository: any
  let mockConfigDomainService: any

  const partnerId = 'partner-nosh'
  const otherPartnerId = 'partner-other'

  beforeEach(() => {
    mockDeliveryQuoteDomainService = {}
    mockDeliveryDomainService = {
      getMany: jest.fn(),
      getById: jest.fn(),
      getByIdOrThrow: jest.fn(),
      update: jest.fn(),
      cancelDelivery: jest.fn(),
    }
    mockPartnerDomainService = {}
    mockLocationDomainService = {
      getByIds: jest.fn().mockResolvedValue([]),
      getById: jest.fn().mockResolvedValue({ id: 'loc-1' }),
    }
    mockCourierDomainService = {
      getByIdWithSettings: jest.fn(),
    }
    mockQuoteToDeliveryConversionService = {}
    mockDispatchStopRepository = {
      findOn: jest.fn().mockResolvedValue(null),
    }
    mockConfigDomainService = {
      instanceConfig: {
        getRestaurantHistoryDays: jest.fn().mockResolvedValue(30),
      },
    }

    service = new DeliveryPartnerRestApiService(
      mockDeliveryQuoteDomainService,
      mockDeliveryDomainService,
      mockPartnerDomainService,
      mockLocationDomainService,
      mockCourierDomainService,
      mockQuoteToDeliveryConversionService,
      mockDispatchStopRepository,
      mockConfigDomainService
    )
  })

  describe('getManyByPartnerId (Spec 0017, AC-2)', () => {
    it('passes partnerHistoryWhere with configured days to getMany and returns historyDays', async () => {
      mockConfigDomainService.instanceConfig.getRestaurantHistoryDays.mockResolvedValue(30)
      const mockResult = {
        data: [{ id: 'del-1', partnerId }],
        pagination: { totalItems: 1 },
      }
      mockDeliveryDomainService.getMany.mockResolvedValue(mockResult)

      const result = await service.getManyByPartnerId(partnerId, 1, 20)

      expect(mockConfigDomainService.instanceConfig.getRestaurantHistoryDays).toHaveBeenCalledTimes(1)
      expect(mockDeliveryDomainService.getMany).toHaveBeenCalledTimes(1)
      const callArgs = mockDeliveryDomainService.getMany.mock.calls[0]
      const calledWhere = callArgs[0]
      expect(calledWhere.partnerId).toBe(partnerId)
      expect(calledWhere.OR).toHaveLength(2)
      expect(calledWhere.OR[0]).toHaveProperty('createdAt.gte')
      expect(calledWhere.OR[1]).toEqual({
        status: {
          notIn: [
            EnumDeliveryStatus.DROPPED_OFF,
            EnumDeliveryStatus.CANCELED,
            EnumDeliveryStatus.FAILED,
          ],
        },
      })
      expect(callArgs[1]).toBe(1)
      expect(callArgs[2]).toBe(20)

      expect(result).toEqual({
        ...mockResult,
        historyDays: 30,
      })
    })

    it('uses updated configured days (e.g. 7) when setting changes', async () => {
      mockConfigDomainService.instanceConfig.getRestaurantHistoryDays.mockResolvedValue(7)
      mockDeliveryDomainService.getMany.mockResolvedValue({ data: [] })

      const beforeCall = Date.now()
      const result = await service.getManyByPartnerId(partnerId)
      const afterCall = Date.now()

      const calledWhere = mockDeliveryDomainService.getMany.mock.calls[0][0]
      const cutoffTime = calledWhere.OR[0].createdAt.gte.getTime()

      // Cutoff should be approximately now minus 7 days
      expect(cutoffTime).toBeGreaterThanOrEqual(beforeCall - 7 * 24 * 60 * 60 * 1000 - 100)
      expect(cutoffTime).toBeLessThanOrEqual(afterCall - 7 * 24 * 60 * 60 * 1000 + 100)
      expect(result.historyDays).toBe(7)
    })
  })

  describe('assertVisibleToPartner order and routes (Spec 0017, AC-3)', () => {
    const days = 30
    const now = new Date()
    const cutoff = partnerHistoryCutoff(days, now)

    describe('getByIdWithRelations', () => {
      it('throws 404 "Delivery not found" when delivery does not exist', async () => {
        mockDeliveryDomainService.getById.mockResolvedValue(null)

        await expect(service.getByIdWithRelations('non-existent', partnerId)).rejects.toThrow(
          new DeliveryNotFoundException('Delivery not found')
        )
      })

      it('throws 404 "Delivery not found" (never period sentence) for another restaurant\'s delivery even if old and ended', async () => {
        const ancientDate = new Date(cutoff.getTime() - 10 * 24 * 60 * 60 * 1000)
        mockDeliveryDomainService.getById.mockResolvedValue({
          id: 'del-other',
          partnerId: otherPartnerId,
          status: EnumDeliveryStatus.DROPPED_OFF,
          createdAt: ancientDate,
        })

        await expect(service.getByIdWithRelations('del-other', partnerId)).rejects.toThrow(
          new DeliveryNotFoundException('Delivery not found')
        )
        // Must NEVER reveal period sentence to another restaurant!
        try {
          await service.getByIdWithRelations('del-other', partnerId)
        } catch (err: any) {
          expect(err.message).toBe('Delivery not found')
          expect(err.message).not.toContain('older than')
        }
      })

      it('throws 404 with period sentence for own ended delivery created before the period (plural days)', async () => {
        const oldDate = new Date(cutoff.getTime() - 1000) // 1 second older than cutoff
        mockDeliveryDomainService.getById.mockResolvedValue({
          id: 'del-own-old',
          partnerId,
          status: EnumDeliveryStatus.DROPPED_OFF,
          createdAt: oldDate,
        })

        await expect(service.getByIdWithRelations('del-own-old', partnerId)).rejects.toThrow(
          new DeliveryNotFoundException('This order is older than 30 days. The co-op can look it up for you.')
        )
      })

      it('throws 404 with singular sentence ("1 day") when historyDays is 1', async () => {
        mockConfigDomainService.instanceConfig.getRestaurantHistoryDays.mockResolvedValue(1)
        const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) // 2 days old
        mockDeliveryDomainService.getById.mockResolvedValue({
          id: 'del-own-old-1',
          partnerId,
          status: EnumDeliveryStatus.CANCELED,
          createdAt: oldDate,
        })

        await expect(service.getByIdWithRelations('del-own-old-1', partnerId)).rejects.toThrow(
          new DeliveryNotFoundException('This order is older than 1 day. The co-op can look it up for you.')
        )
      })

      it('throws 404 with period sentence when own delivery is FAILED and older than period', async () => {
        const oldDate = new Date(cutoff.getTime() - 5000)
        mockDeliveryDomainService.getById.mockResolvedValue({
          id: 'del-failed',
          partnerId,
          status: EnumDeliveryStatus.FAILED,
          createdAt: oldDate,
        })

        await expect(service.getByIdWithRelations('del-failed', partnerId)).rejects.toThrow(
          new DeliveryNotFoundException('This order is older than 30 days. The co-op can look it up for you.')
        )
      })

      it('passes and loads relations for own ended delivery within the period', async () => {
        const recentDate = new Date(cutoff.getTime() + 10 * 24 * 60 * 60 * 1000)
        mockDeliveryDomainService.getById.mockResolvedValue({
          id: 'del-recent',
          partnerId,
          status: EnumDeliveryStatus.DROPPED_OFF,
          createdAt: recentDate,
          pickupLocationId: 'loc-pickup',
          dropoffLocationId: 'loc-dropoff',
        })

        const result = await service.getByIdWithRelations('del-recent', partnerId)
        expect(result).toBeDefined()
        expect(mockLocationDomainService.getByIds).toHaveBeenCalledWith(['loc-pickup', 'loc-dropoff'])
      })

      it('passes and loads relations for own OPEN delivery of any age (even older than cutoff)', async () => {
        const ancientDate = new Date(cutoff.getTime() - 50 * 24 * 60 * 60 * 1000)
        mockDeliveryDomainService.getById.mockResolvedValue({
          id: 'del-open-ancient',
          partnerId,
          status: EnumDeliveryStatus.ACCEPTED,
          createdAt: ancientDate,
          pickupLocationId: 'loc-pickup',
          dropoffLocationId: 'loc-dropoff',
        })

        const result = await service.getByIdWithRelations('del-open-ancient', partnerId)
        expect(result).toBeDefined()
        expect(mockLocationDomainService.getByIds).toHaveBeenCalledWith(['loc-pickup', 'loc-dropoff'])
      })
    })

    describe('update', () => {
      it('throws 404 "Delivery not found" for another restaurant\'s delivery', async () => {
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue({
          id: 'del-other',
          partnerId: otherPartnerId,
          status: EnumDeliveryStatus.ACCEPTED,
          createdAt: new Date(),
        })

        await expect(
          service.update('del-other', partnerId, {} as any)
        ).rejects.toThrow(new DeliveryNotFoundException('Delivery not found'))

        expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
      })

      it('refuses own old ended delivery before doing anything (no location lookup or update)', async () => {
        const oldDate = new Date(cutoff.getTime() - 24 * 60 * 60 * 1000)
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue({
          id: 'del-own-old',
          partnerId,
          status: EnumDeliveryStatus.DROPPED_OFF,
          createdAt: oldDate,
          dropoffLocationId: 'loc-dropoff',
        })

        await expect(
          service.update('del-own-old', partnerId, {} as any)
        ).rejects.toThrow(
          new DeliveryNotFoundException('This order is older than 30 days. The co-op can look it up for you.')
        )

        expect(mockLocationDomainService.getById).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
      })
    })

    describe('cancel', () => {
      it('throws 404 "Delivery not found" for another restaurant\'s delivery and never calls cancelDelivery', async () => {
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue({
          id: 'del-other',
          partnerId: otherPartnerId,
          status: EnumDeliveryStatus.ACCEPTED,
          createdAt: new Date(),
        })

        await expect(service.cancel('del-other', partnerId)).rejects.toThrow(
          new DeliveryNotFoundException('Delivery not found')
        )

        expect(mockDeliveryDomainService.cancelDelivery).not.toHaveBeenCalled()
      })

      it('refuses own old ended delivery before doing anything and never calls cancelDelivery', async () => {
        const oldDate = new Date(cutoff.getTime() - 24 * 60 * 60 * 1000)
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue({
          id: 'del-own-old',
          partnerId,
          status: EnumDeliveryStatus.CANCELED,
          createdAt: oldDate,
        })

        await expect(service.cancel('del-own-old', partnerId)).rejects.toThrow(
          new DeliveryNotFoundException('This order is older than 30 days. The co-op can look it up for you.')
        )

        expect(mockDeliveryDomainService.cancelDelivery).not.toHaveBeenCalled()
      })

      it('allows cancelling an own open delivery even when old', async () => {
        const ancientDate = new Date(cutoff.getTime() - 60 * 24 * 60 * 60 * 1000)
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue({
          id: 'del-own-open-old',
          partnerId,
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          createdAt: ancientDate,
        })
        mockDeliveryDomainService.cancelDelivery.mockResolvedValue({
          id: 'del-own-open-old',
          status: EnumDeliveryStatus.CANCELED,
        })

        const result = await service.cancel('del-own-open-old', partnerId, EnumCancelledBy.RESTAURANT)
        expect(result).toBeDefined()
        expect(mockDeliveryDomainService.cancelDelivery).toHaveBeenCalledWith(
          'del-own-open-old',
          EnumCancelledBy.RESTAURANT
        )
      })
    })
  })
})
