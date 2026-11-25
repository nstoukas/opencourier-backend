import { ConflictException } from '@nestjs/common'
import { DeliveryLocationDoesntMatchQuoteException, DeliveryNotFoundException, NotFoundException } from 'src/errors'
import {
  BoxSize,
  EnumCancelledBy,
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
} from '@prisma/types'
import { haversineDistanceInMetres } from 'src/core/utils/distance'
import { DeliveryPartnerRestApiService } from './delivery.partner.rest-api.service'
import { partnerHistoryCutoff } from './partner-history'
import { DeliveryUpdatePartnerInput } from './queries/delivery-update.partner.input'
import { PARTNER_EDIT_SENTENCES } from 'src/domains/delivery/partner-edit'
import { DELIVERY_ONGOING_STATUSES } from 'src/shared-types/stateMachine'
import { PARTNER_ENDED_STATUSES } from 'src/domains/delivery/ready-signals'

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
  let mockDeliveryEventService: any

  const partnerId = 'partner-nosh'
  const otherPartnerId = 'partner-other'

  beforeEach(() => {
    mockDeliveryQuoteDomainService = {
      getByIdOrThrow: jest.fn().mockResolvedValue({ id: 'quote-1', dropoffLocationId: 'loc-shared' }),
    }
    mockDeliveryDomainService = {
      getMany: jest.fn(),
      getById: jest.fn(),
      getByIdOrThrow: jest.fn(),
      update: jest.fn(),
      updateIfMatches: jest.fn().mockImplementation((id: string, where: any, data: any) => {
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue({ id, ...data })
        return Promise.resolve(true)
      }),
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
    mockDeliveryEventService = {
      recordDropoffPointCorrectedEvent: jest.fn().mockResolvedValue(undefined),
      recordTipChangedEvent: jest.fn().mockResolvedValue(undefined),
    }

    service = new DeliveryPartnerRestApiService(
      mockDeliveryQuoteDomainService,
      mockDeliveryDomainService,
      mockPartnerDomainService,
      mockLocationDomainService,
      mockCourierDomainService,
      mockQuoteToDeliveryConversionService,
      mockDispatchStopRepository,
      mockConfigDomainService,
      mockDeliveryEventService,
      {} as any
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
          notIn: [EnumDeliveryStatus.DROPPED_OFF, EnumDeliveryStatus.CANCELED, EnumDeliveryStatus.FAILED],
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

        await expect(service.update('del-other', partnerId, {} as any)).rejects.toThrow(
          new DeliveryNotFoundException('Delivery not found')
        )

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

        await expect(service.update('del-own-old', partnerId, {} as any)).rejects.toThrow(
          new DeliveryNotFoundException('This order is older than 30 days. The co-op can look it up for you.')
        )

        expect(mockLocationDomainService.getById).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
      })

      it('boxSize null changes nothing and calls no changeBoxSize', async () => {
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue({
          id: 'del-update-null-size',
          partnerId,
          status: EnumDeliveryStatus.CREATED,
          createdAt: new Date(),
          dropoffLocationId: 'loc-1',
          boxSize: BoxSize.MEDIUM,
        })
        mockLocationDomainService.getById.mockResolvedValue({
          id: 'loc-1',
          latitude: 39.36,
          longitude: 22.94,
        })
        mockDeliveryDomainService.changeBoxSize = jest.fn()
        mockDeliveryDomainService.updateIfMatches.mockResolvedValue(true)

        await service.update('del-update-null-size', partnerId, {
          boxSize: null,
          dropoffLatitude: 39.36,
          dropoffLongitude: 22.94,
        } as any)

        expect(mockDeliveryDomainService.changeBoxSize).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledWith(
          'del-update-null-size',
          expect.anything(),
          expect.anything()
        )
        expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
      })

      it('the size change runs after the drift check, so an update refused by the drift check leaves the size unchanged (changeBoxSize not called)', async () => {
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue({
          id: 'del-update-drift-fail',
          partnerId,
          status: EnumDeliveryStatus.CREATED,
          createdAt: new Date(),
          dropoffLocationId: 'loc-current',
          deliveryQuoteId: 'quote-1',
          boxSize: BoxSize.MEDIUM,
        })
        mockLocationDomainService.getById.mockImplementation(async (id: string) => {
          if (id === 'loc-current') return { id: 'loc-current', latitude: 39.36, longitude: 22.94 }
          if (id === 'loc-quoted') return { id: 'loc-quoted', latitude: 39.36, longitude: 22.94 }
          return null
        })
        mockDeliveryQuoteDomainService.getByIdOrThrow.mockResolvedValue({
          id: 'quote-1',
          dropoffLocationId: 'loc-quoted',
        })
        mockQuoteToDeliveryConversionService.isValidDeliveryLocationDrift = jest.fn().mockResolvedValue(false)
        mockDeliveryDomainService.changeBoxSize = jest.fn()

        await expect(
          service.update('del-update-drift-fail', partnerId, {
            boxSize: BoxSize.LARGE,
            dropoffLatitude: 40.0,
            dropoffLongitude: 23.0,
          } as any)
        ).rejects.toThrow(DeliveryLocationDoesntMatchQuoteException)

        expect(mockQuoteToDeliveryConversionService.isValidDeliveryLocationDrift).toHaveBeenCalled()
        expect(mockDeliveryDomainService.changeBoxSize).not.toHaveBeenCalled()
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

  // Row 102: a Location row is shared between deliveries and quotes (`findOrCreate` reuses one for the
  // same address and point), so a partner edit that moves the drop off must give the edited delivery a
  // row of its own and never update the shared row in place.
  describe('update moves only its own drop off point (row 102)', () => {
    const sharedLocation = {
      id: 'loc-shared',
      addressLine1: 'Iasonos 12',
      addressLine2: '3rd floor',
      city: 'Volos',
      state: 'Thessaly',
      street: 'Iasonos',
      zipCode: '38221',
      countryCode: 'GR',
      stateCode: 'TH',
      houseNumber: '12',
      formattedAddress: 'Iasonos 12, Volos 38221, Greece',
      latitude: 39.3621,
      longitude: 22.9425,
    }

    const ownDelivery = () => ({
      id: 'del-own',
      partnerId,
      status: EnumDeliveryStatus.ASSIGNING_COURIER,
      createdAt: new Date(),
      dropoffLocationId: 'loc-shared',
      deliveryQuoteId: 'quote-1',
    })

    const pickupReadyAt = new Date('2026-11-03T10:00:00Z')
    const pickupDeadlineAt = new Date('2026-11-03T10:30:00Z')
    const dropoffReadyAt = new Date('2026-11-03T10:40:00Z')
    const dropoffDeadlineAt = new Date('2026-11-03T11:00:00Z')

    const inputAt = (latitude: number, longitude: number) =>
      ({
        dropoffLatitude: latitude,
        dropoffLongitude: longitude,
        pickupNotes: 'Ring at the back door',
        pickupVerification: { signature: true },
        pickupReadyAt,
        pickupDeadlineAt,
        dropoffNotes: 'Leave with the concierge',
        dropoffReadyAt,
        dropoffDeadlineAt,
        dropoffVerification: { picture: true },
        orderReference: 'ORD-102',
        tipByCustomer: 150,
      } as unknown as DeliveryUpdatePartnerInput)

    const moved = () => inputAt(39.3625, 22.943)

    // Every field the delivery update carried before row 102, unchanged.
    const otherUpdateFields = {
      pickupNotes: 'Ring at the back door',
      pickupVerification: { signature: true },
      pickupReadyAt,
      pickupDeadlineAt,
      dropoffNotes: 'Leave with the concierge',
      dropoffReadyAt,
      dropoffDeadlineAt,
      dropoffVerification: { picture: true },
      orderReference: 'ORD-102',
      tips: 150,
    }

    beforeEach(() => {
      mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue(ownDelivery())
      mockDeliveryDomainService.updateIfMatches = jest
        .fn()
        .mockImplementation((id: string, where: any, data: Record<string, unknown>) => {
          mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue({ id, ...data })
          return Promise.resolve(true)
        })
      mockLocationDomainService.getById = jest.fn().mockResolvedValue({ ...sharedLocation })
      mockLocationDomainService.create = jest.fn().mockResolvedValue({ id: 'loc-new' })
      mockLocationDomainService.update = jest.fn()
      mockQuoteToDeliveryConversionService.isValidDeliveryLocationDrift = jest.fn().mockResolvedValue(true)
    })

    describe('a moved point', () => {
      it('never updates the shared Location row in place', async () => {
        await service.update('del-own', partnerId, moved())

        expect(mockLocationDomainService.update).not.toHaveBeenCalled()
      })

      it('creates one new Location with every address field copied and the new coordinates', async () => {
        await service.update('del-own', partnerId, moved())

        expect(mockLocationDomainService.create).toHaveBeenCalledTimes(1)
        expect(mockLocationDomainService.create).toHaveBeenCalledWith({
          addressLine1: 'Iasonos 12',
          addressLine2: '3rd floor',
          city: 'Volos',
          state: 'Thessaly',
          street: 'Iasonos',
          zipCode: '38221',
          countryCode: 'GR',
          stateCode: 'TH',
          houseNumber: '12',
          formattedAddress: 'Iasonos 12, Volos 38221, Greece',
          latitude: 39.3625,
          longitude: 22.943,
        })
      })

      it('points the delivery at the new row in the same update as its other fields', async () => {
        const result = await service.update('del-own', partnerId, moved())

        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledWith(
          'del-own',
          { status: EnumDeliveryStatus.ASSIGNING_COURIER, tips: undefined, dropoffLocationId: 'loc-shared' },
          {
            dropoffLocationId: 'loc-new',
            dropoffCorrectedLatitude: null,
            dropoffCorrectedLongitude: null,
            ...otherUpdateFields,
          }
        )
        expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
        expect(result).toEqual({
          id: 'del-own',
          dropoffLocationId: 'loc-new',
          dropoffCorrectedLatitude: null,
          dropoffCorrectedLongitude: null,
          ...otherUpdateFields,
        })
      })

      it('clears previously corrected dropoff coordinates to null when partner moves the point, leaving dropoffPointCorrectedAt untouched', async () => {
        const correctedAt = new Date('2026-11-01T12:00:00Z')
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue({
          ...ownDelivery(),
          dropoffCorrectedLatitude: 39.3655,
          dropoffCorrectedLongitude: 22.9495,
          dropoffPointCorrectedAt: correctedAt,
        })

        await service.update('del-own', partnerId, moved())

        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledWith(
          'del-own',
          expect.anything(),
          expect.objectContaining({
            dropoffLocationId: 'loc-new',
            dropoffCorrectedLatitude: null,
            dropoffCorrectedLongitude: null,
          })
        )
        const updatePayload = mockDeliveryDomainService.updateIfMatches.mock.calls[0][2]
        // dropoffPointCorrectedAt must NOT be overwritten or nulled (spec 0016 once-only mark stays)
        expect(updatePayload).not.toHaveProperty('dropoffPointCorrectedAt')
        expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
      })

      it('counts only the latitude moving as moved', async () => {
        await service.update('del-own', partnerId, inputAt(39.3625, sharedLocation.longitude))

        expect(mockLocationDomainService.update).not.toHaveBeenCalled()
        expect(mockLocationDomainService.create).toHaveBeenCalledTimes(1)
        expect(mockLocationDomainService.create).toHaveBeenCalledWith(
          expect.objectContaining({ latitude: 39.3625, longitude: sharedLocation.longitude })
        )
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledWith(
          'del-own',
          expect.anything(),
          expect.objectContaining({ dropoffLocationId: 'loc-new' })
        )
        expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
      })

      it('counts only the longitude moving as moved', async () => {
        await service.update('del-own', partnerId, inputAt(sharedLocation.latitude, 22.943))

        expect(mockLocationDomainService.update).not.toHaveBeenCalled()
        expect(mockLocationDomainService.create).toHaveBeenCalledTimes(1)
        expect(mockLocationDomainService.create).toHaveBeenCalledWith(
          expect.objectContaining({ latitude: sharedLocation.latitude, longitude: 22.943 })
        )
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledWith(
          'del-own',
          expect.anything(),
          expect.objectContaining({ dropoffLocationId: 'loc-new' })
        )
        expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
      })

      it('records one DROPOFF_POINT_CORRECTED event with actor PARTNER, source PARTNER_APP, no courierId, delivery status, and metres in message', async () => {
        await service.update('del-own', partnerId, moved())

        expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).toHaveBeenCalledTimes(1)
        expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).toHaveBeenCalledWith(
          {
            deliveryId: 'del-own',
            type: EnumDeliveryEventType.DROPOFF_POINT_CORRECTED,
            actor: EnumEventActor.PARTNER,
            source: EnumDeliveryEventSource.PARTNER_APP,
            message: 'Drop off pin moved 62 m by the restaurant, from 39.36210, 22.94250 to 39.36250, 22.94300',
            messageCode: 'DROPOFF_MOVED_BY_RESTAURANT',
            messageParams: {
              from: '39.36210, 22.94250',
              metres: 62,
              to: '39.36250, 22.94300',
            },
          },
          EnumDeliveryStatus.ASSIGNING_COURIER
        )
        const [recordedEvent] = mockDeliveryEventService.recordDropoffPointCorrectedEvent.mock.calls[0]
        expect(recordedEvent.courierId).toBeUndefined()
        expect('courierId' in recordedEvent).toBe(false)
      })
    })

    describe('an unmoved point', () => {
      it('creates nothing, updates no Location and keeps the old id', async () => {
        await service.update('del-own', partnerId, inputAt(sharedLocation.latitude, sharedLocation.longitude))

        expect(mockLocationDomainService.create).not.toHaveBeenCalled()
        expect(mockLocationDomainService.update).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledWith(
          'del-own',
          { status: EnumDeliveryStatus.ASSIGNING_COURIER, tips: undefined, dropoffLocationId: 'loc-shared' },
          {
            dropoffLocationId: 'loc-shared',
            ...otherUpdateFields,
          }
        )
        expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
        // Unmoved point does NOT pass dropoffCorrectedLatitude or dropoffCorrectedLongitude
        const updatePayload = mockDeliveryDomainService.updateIfMatches.mock.calls[0][2]
        expect(updatePayload).not.toHaveProperty('dropoffCorrectedLatitude')
        expect(updatePayload).not.toHaveProperty('dropoffCorrectedLongitude')
      })

      it('runs no drift check, records no event and creates no Location even when current point is far from the quote', async () => {
        const currentDeliveryLocation = {
          ...sharedLocation,
          id: 'loc-current-far',
          latitude: 39.375,
          longitude: 22.955,
        }
        const quoteLocation = {
          ...sharedLocation,
          id: 'loc-quote',
          latitude: 39.3621,
          longitude: 22.9425,
        }
        mockLocationDomainService.getById = jest.fn((id: string) => {
          if (id === 'loc-current-far') return Promise.resolve({ ...currentDeliveryLocation })
          if (id === 'loc-quote') return Promise.resolve({ ...quoteLocation })
          return Promise.resolve(null)
        })
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue({
          ...ownDelivery(),
          dropoffLocationId: 'loc-current-far',
          deliveryQuoteId: 'quote-1',
        })
        mockDeliveryQuoteDomainService.getByIdOrThrow.mockResolvedValue({
          id: 'quote-1',
          dropoffLocationId: 'loc-quote',
        })

        await service.update('del-own', partnerId, inputAt(39.375, 22.955))

        expect(mockQuoteToDeliveryConversionService.isValidDeliveryLocationDrift).not.toHaveBeenCalled()
        expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).not.toHaveBeenCalled()
        expect(mockLocationDomainService.create).not.toHaveBeenCalled()
        expect(mockLocationDomainService.update).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledWith(
          'del-own',
          expect.anything(),
          {
            dropoffLocationId: 'loc-current-far',
            ...otherUpdateFields,
          }
        )
        expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
      })
    })

    describe('checks that still come first', () => {
      it("refuses a point too far from the quote's drop off point before writing anything", async () => {
        mockQuoteToDeliveryConversionService.isValidDeliveryLocationDrift.mockResolvedValue(false)

        await expect(service.update('del-own', partnerId, inputAt(39.5, 23.2))).rejects.toThrow(
          "Delivery dropoff location doesn't match quote location"
        )

        expect(mockQuoteToDeliveryConversionService.isValidDeliveryLocationDrift).toHaveBeenCalledWith({
          fromLocation: { latitude: sharedLocation.latitude, longitude: sharedLocation.longitude },
          toLocation: { latitude: 39.5, longitude: 23.2 },
        })
        expect(mockLocationDomainService.create).not.toHaveBeenCalled()
        expect(mockLocationDomainService.update).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.updateIfMatches).not.toHaveBeenCalled()
        expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).not.toHaveBeenCalled()
      })

      it("answers NotFoundException when the quote's drop off point is gone, before anything is written", async () => {
        mockDeliveryQuoteDomainService.getByIdOrThrow.mockResolvedValue({
          id: 'quote-1',
          dropoffLocationId: 'loc-quote-deleted',
        })
        mockLocationDomainService.getById = jest.fn((id: string) => {
          if (id === 'loc-shared') return Promise.resolve({ ...sharedLocation })
          if (id === 'loc-quote-deleted') return Promise.resolve(null)
          return Promise.resolve(null)
        })

        await expect(service.update('del-own', partnerId, moved())).rejects.toThrow(
          new NotFoundException('Delivery locations not found')
        )

        expect(mockQuoteToDeliveryConversionService.isValidDeliveryLocationDrift).not.toHaveBeenCalled()
        expect(mockLocationDomainService.create).not.toHaveBeenCalled()
        expect(mockLocationDomainService.update).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.updateIfMatches).not.toHaveBeenCalled()
        expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).not.toHaveBeenCalled()
      })

      it("runs the visibility check first: another restaurant's delivery touches no Location", async () => {
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue({ ...ownDelivery(), partnerId: otherPartnerId })

        await expect(service.update('del-own', partnerId, inputAt(39.3625, 22.943))).rejects.toThrow(
          new DeliveryNotFoundException('Delivery not found')
        )

        expect(mockLocationDomainService.getById).not.toHaveBeenCalled()
        expect(mockQuoteToDeliveryConversionService.isValidDeliveryLocationDrift).not.toHaveBeenCalled()
        expect(mockLocationDomainService.create).not.toHaveBeenCalled()
        expect(mockLocationDomainService.update).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.updateIfMatches).not.toHaveBeenCalled()
      })

      it('reads the history period (visibility) before the drop off Location on an own delivery', async () => {
        await service.update('del-own', partnerId, inputAt(39.3625, 22.943))

        const visibilityOrder =
          mockConfigDomainService.instanceConfig.getRestaurantHistoryDays.mock.invocationCallOrder[0]
        const locationReadOrder = mockLocationDomainService.getById.mock.invocationCallOrder[0]
        const createOrder = mockLocationDomainService.create.mock.invocationCallOrder[0]
        expect(visibilityOrder).toBeLessThan(locationReadOrder)
        expect(visibilityOrder).toBeLessThan(createOrder)
      })
    })

    describe('drift measured from quote anchor across consecutive edits', () => {
      it("measures drift from the quote's drop off point rather than the delivery's current point", async () => {
        const quoteLocation = { ...sharedLocation, id: 'loc-quote', latitude: 39.3621, longitude: 22.9425 }
        const currentDeliveryLocation = {
          ...sharedLocation,
          id: 'loc-current-moved',
          latitude: 39.363,
          longitude: 22.943,
        }
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue({
          ...ownDelivery(),
          dropoffLocationId: 'loc-current-moved',
          deliveryQuoteId: 'quote-1',
        })
        mockDeliveryQuoteDomainService.getByIdOrThrow.mockResolvedValue({
          id: 'quote-1',
          dropoffLocationId: 'loc-quote',
        })
        mockLocationDomainService.getById = jest.fn((id: string) => {
          if (id === 'loc-current-moved') return Promise.resolve({ ...currentDeliveryLocation })
          if (id === 'loc-quote') return Promise.resolve({ ...quoteLocation })
          return Promise.resolve(null)
        })

        await service.update('del-own', partnerId, inputAt(39.3625, 22.9435))

        // Drift check MUST measure from quoteLocation, NOT from currentDeliveryLocation!
        expect(mockQuoteToDeliveryConversionService.isValidDeliveryLocationDrift).toHaveBeenCalledWith({
          fromLocation: { latitude: 39.3621, longitude: 22.9425 },
          toLocation: { latitude: 39.3625, longitude: 22.9435 },
        })
      })

      it('measures drift from the quote drop off point across consecutive small edits and refuses once farther than allowed', async () => {
        const quoteLocation = { ...sharedLocation, id: 'loc-quote', latitude: 39.3621, longitude: 22.9425 }
        let currentDelivery = {
          ...ownDelivery(),
          dropoffLocationId: 'loc-quote',
          deliveryQuoteId: 'quote-1',
        }
        const locationStore = new Map<string, any>([['loc-quote', { ...quoteLocation }]])

        mockDeliveryDomainService.getByIdOrThrow.mockImplementation(() => Promise.resolve({ ...currentDelivery }))
        mockDeliveryDomainService.updateIfMatches = jest.fn((id: string, where: any, data: any) => {
          currentDelivery = { ...currentDelivery, ...data }
          return Promise.resolve(true)
        })
        mockDeliveryQuoteDomainService.getByIdOrThrow.mockResolvedValue({
          id: 'quote-1',
          dropoffLocationId: 'loc-quote',
        })
        mockLocationDomainService.getById = jest.fn((id: string) => Promise.resolve(locationStore.get(id) ?? null))
        let nextLocId = 1
        mockLocationDomainService.create = jest.fn((data: any) => {
          const newId = `loc-new-${nextLocId++}`
          const created = { id: newId, ...data }
          locationStore.set(newId, created)
          return Promise.resolve(created)
        })

        // Max drift allowed is 100 metres from fromLocation
        mockQuoteToDeliveryConversionService.isValidDeliveryLocationDrift = jest.fn(
          async ({ fromLocation, toLocation }: { fromLocation: any; toLocation: any }) => {
            const distance = haversineDistanceInMetres(
              fromLocation.latitude,
              fromLocation.longitude,
              toLocation.latitude,
              toLocation.longitude
            )
            return distance <= 100
          }
        )

        // Edit 1: moves ~55.6m north (from 39.3621 to 39.3626).
        // Distance from quote is ~55.6m <= 100m -> allowed.
        const edit1Input = inputAt(39.3626, 22.9425)
        const edit1Result = await service.update('del-own', partnerId, edit1Input)
        expect(edit1Result.dropoffLocationId).toBe('loc-new-1')
        expect(mockQuoteToDeliveryConversionService.isValidDeliveryLocationDrift).toHaveBeenNthCalledWith(1, {
          fromLocation: { latitude: 39.3621, longitude: 22.9425 },
          toLocation: { latitude: 39.3626, longitude: 22.9425 },
        })

        // Edit 2: moves another ~66.7m north (from 39.3626 to 39.3632).
        // Distance from edit 1 point is ~66.7m (which would pass if measured from current delivery point).
        // Distance from quote point is ~122.3m > 100m -> MUST be refused!
        const edit2Input = inputAt(39.3632, 22.9425)
        await expect(service.update('del-own', partnerId, edit2Input)).rejects.toThrow(
          new DeliveryLocationDoesntMatchQuoteException("Delivery dropoff location doesn't match quote location")
        )

        // Verify that edit 2 measured from the quote point, NOT from the delivery's current point
        expect(mockQuoteToDeliveryConversionService.isValidDeliveryLocationDrift).toHaveBeenNthCalledWith(2, {
          fromLocation: { latitude: 39.3621, longitude: 22.9425 },
          toLocation: { latitude: 39.3632, longitude: 22.9425 },
        })

        // The second edit wrote nothing: delivery still has edit1's location
        expect(currentDelivery.dropoffLocationId).toBe('loc-new-1')
      })
    })

    // The Done when, end to end on an in-memory store: two deliveries and a quote share one Location
    // row; a partner edit of one delivery's drop off leaves the other two exactly where they were.
    describe('simulation: deliveries and a quote sharing one Location row', () => {
      type FakeLocation = typeof sharedLocation
      type FakeDelivery = ReturnType<typeof ownDelivery>
      let locations: Map<string, FakeLocation>
      let deliveries: Map<string, FakeDelivery>
      let quote: { id: string; dropoffLocationId: string }

      const rowOrThrow = <T>(map: Map<string, T>, id: string): T => {
        const row = map.get(id)
        if (!row) throw new Error(`no row ${id}`)
        return row
      }

      // What a reader of the database would see: the point a record resolves to right now.
      const pointOf = (record: { dropoffLocationId: string }) => {
        const location = rowOrThrow(locations, record.dropoffLocationId)
        return { latitude: location.latitude, longitude: location.longitude }
      }

      beforeEach(() => {
        locations = new Map([['loc-shared', { ...sharedLocation }]])
        deliveries = new Map([
          ['del-a', { ...ownDelivery(), id: 'del-a', dropoffLocationId: 'loc-shared' }],
          ['del-b', { ...ownDelivery(), id: 'del-b', dropoffLocationId: 'loc-shared' }],
        ])
        quote = { id: 'quote-1', dropoffLocationId: 'loc-shared' }

        let nextId = 1
        mockDeliveryQuoteDomainService.getByIdOrThrow = jest.fn((id: string) => Promise.resolve({ ...quote }))
        mockDeliveryDomainService.getByIdOrThrow.mockImplementation((id: string) =>
          Promise.resolve({ ...rowOrThrow(deliveries, id) })
        )
        mockDeliveryDomainService.updateIfMatches = jest.fn(
          (id: string, where: any, data: Partial<FakeDelivery>) => {
            const updated = { ...rowOrThrow(deliveries, id), ...data }
            deliveries.set(id, updated)
            return Promise.resolve(true)
          }
        )
        mockLocationDomainService.getById = jest.fn((id: string) => {
          const location = locations.get(id)
          return Promise.resolve(location ? { ...location } : null)
        })
        mockLocationDomainService.create = jest.fn((data: Omit<FakeLocation, 'id'>) => {
          const created = { ...data, id: `loc-created-${nextId++}` }
          locations.set(created.id, created)
          return Promise.resolve(created)
        })
        // Writes through to the shared row, as the real repository would.
        mockLocationDomainService.update = jest.fn((id: string, data: Partial<FakeLocation>) =>
          Promise.resolve(Object.assign(rowOrThrow(locations, id), data))
        )
      })

      it('moves only the edited delivery; the other delivery, the quote and the shared row keep the old point', async () => {
        const oldPoint = { latitude: sharedLocation.latitude, longitude: sharedLocation.longitude }

        await service.update('del-a', partnerId, inputAt(39.3625, 22.943))

        // The shared row itself is untouched.
        expect(locations.get('loc-shared')).toEqual(sharedLocation)
        // Everyone else still sharing it sees the old point.
        const other = rowOrThrow(deliveries, 'del-b')
        expect(other.dropoffLocationId).toBe('loc-shared')
        expect(pointOf(other)).toEqual(oldPoint)
        expect(quote.dropoffLocationId).toBe('loc-shared')
        expect(pointOf(quote)).toEqual(oldPoint)
        // The edited delivery points at a row of its own, at the new point, with the same address.
        const edited = rowOrThrow(deliveries, 'del-a')
        expect(edited.dropoffLocationId).not.toBe('loc-shared')
        expect(pointOf(edited)).toEqual({ latitude: 39.3625, longitude: 22.943 })
        const { id: _sharedId, latitude: _lat, longitude: _lng, ...sharedAddress } = sharedLocation
        expect(locations.get(edited.dropoffLocationId)).toEqual(
          expect.objectContaining({ ...sharedAddress, latitude: 39.3625, longitude: 22.943 })
        )
      })
    })
  })

  describe('partner edit status checks and tips (Row 152)', () => {
    const sharedLocation = {
      id: 'loc-shared',
      addressLine1: 'Iasonos 12',
      addressLine2: '3rd floor',
      city: 'Volos',
      state: 'Thessaly',
      street: 'Iasonos',
      zipCode: '38221',
      countryCode: 'GR',
      stateCode: 'TH',
      houseNumber: '12',
      formattedAddress: 'Iasonos 12, Volos 38221, Greece',
      latitude: 39.3621,
      longitude: 22.9425,
    }

    const testDelivery = (status: EnumDeliveryStatus, tips = 150) => ({
      id: 'del-152',
      partnerId,
      status,
      createdAt: new Date(),
      dropoffLocationId: 'loc-shared',
      deliveryQuoteId: 'quote-1',
      tips,
      currencyCode: 'EUR',
      orderReference: 'ORD-152',
    })

    const updateInput = (opts?: {
      dropoffLatitude?: number
      dropoffLongitude?: number
      tipByCustomer?: number
      notes?: string
      pickupReadyAt?: Date
    }) =>
      ({
        dropoffLatitude: opts?.dropoffLatitude ?? sharedLocation.latitude,
        dropoffLongitude: opts?.dropoffLongitude ?? sharedLocation.longitude,
        pickupNotes: opts?.notes ?? 'Pickup notes',
        dropoffNotes: opts?.notes ?? 'Dropoff notes',
        orderReference: 'ORD-152',
        tipByCustomer: opts?.tipByCustomer ?? 0,
        pickupReadyAt: opts?.pickupReadyAt,
      } as unknown as DeliveryUpdatePartnerInput)

    beforeEach(() => {
      mockDeliveryQuoteDomainService.getByIdOrThrow.mockResolvedValue({
        id: 'quote-1',
        dropoffLocationId: 'loc-shared',
      })
      mockLocationDomainService.getById = jest.fn().mockResolvedValue({ ...sharedLocation })
      mockLocationDomainService.create = jest.fn().mockResolvedValue({ id: 'loc-new' })
      mockLocationDomainService.update = jest.fn()
      mockDeliveryDomainService.updateIfMatches = jest
        .fn()
        .mockImplementation((id: string, where: any, data: Record<string, unknown>) => {
          mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue({ id, ...data })
          return Promise.resolve(true)
        })
      mockDeliveryDomainService.changeBoxSize = jest.fn()
      mockQuoteToDeliveryConversionService.isValidDeliveryLocationDrift = jest.fn().mockResolvedValue(true)
      mockDeliveryEventService.recordDropoffPointCorrectedEvent = jest.fn().mockResolvedValue(undefined)
      mockDeliveryEventService.recordTipChangedEvent = jest.fn().mockResolvedValue(undefined)
    })

    describe('clause 1: POST partner deliveries/:id on an ended delivery (DROPPED_OFF, CANCELED, FAILED) is refused 409', () => {
      test.each(PARTNER_ENDED_STATUSES)(
        'refuses edit on ended status %s with 409 ConflictException and PARTNER_EDIT_SENTENCES.ended',
        async (status) => {
          mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue(testDelivery(status))

          // Test with point unmoved
          await expect(service.update('del-152', partnerId, updateInput({ notes: 'New notes' }))).rejects.toThrow(
            new ConflictException(PARTNER_EDIT_SENTENCES.ended)
          )

          // Test with point moved
          await expect(
            service.update('del-152', partnerId, updateInput({ dropoffLatitude: 39.3625, dropoffLongitude: 22.943 }))
          ).rejects.toThrow(new ConflictException(PARTNER_EDIT_SENTENCES.ended))

          // Nothing is written or read: no location lookup or create, no delivery update, no event
          expect(mockLocationDomainService.getById).not.toHaveBeenCalled()
          expect(mockLocationDomainService.create).not.toHaveBeenCalled()
          expect(mockLocationDomainService.update).not.toHaveBeenCalled()
          expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
          expect(mockDeliveryDomainService.updateIfMatches).not.toHaveBeenCalled()
          expect(mockDeliveryDomainService.changeBoxSize).not.toHaveBeenCalled()
          expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).not.toHaveBeenCalled()
        }
      )
    })

    describe('clause 2: while a rider holds the order (every status in DELIVERY_ONGOING_STATUSES)', () => {
      test.each(DELIVERY_ONGOING_STATUSES)(
        'status %s refuses dropoff point move with 409 ConflictException and PARTNER_EDIT_SENTENCES.pointHeld',
        async (status) => {
          mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue(testDelivery(status))

          await expect(
            service.update('del-152', partnerId, updateInput({ dropoffLatitude: 39.3625, dropoffLongitude: 22.943 }))
          ).rejects.toThrow(new ConflictException(PARTNER_EDIT_SENTENCES.pointHeld))

          // Refused before quote read or any write
          expect(mockDeliveryQuoteDomainService.getByIdOrThrow).not.toHaveBeenCalled()
          expect(mockLocationDomainService.create).not.toHaveBeenCalled()
          expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
          expect(mockDeliveryDomainService.updateIfMatches).not.toHaveBeenCalled()
          expect(mockDeliveryDomainService.changeBoxSize).not.toHaveBeenCalled()
          expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).not.toHaveBeenCalled()
        }
      )

      test.each(DELIVERY_ONGOING_STATUSES)(
        'status %s allows notes and times to change when dropoff point does not move',
        async (status) => {
          mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue(testDelivery(status, 200))

          const newTime = new Date('2026-11-24T20:00:00Z')
          const result = await service.update(
            'del-152',
            partnerId,
            updateInput({ notes: 'Updated notes', pickupReadyAt: newTime, tipByCustomer: 0 })
          )

          expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
          expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
          expect(result.pickupNotes).toBe('Updated notes')
          expect(result.dropoffNotes).toBe('Updated notes')
          expect(result.pickupReadyAt).toEqual(newTime)
          // No new location created for unmoved point
          expect(mockLocationDomainService.create).not.toHaveBeenCalled()
        }
      )
    })

    describe('clause 3: an order with no rider yet (CREATED, ASSIGNING_COURIER) is edited as before', () => {
      test.each([EnumDeliveryStatus.CREATED, EnumDeliveryStatus.ASSIGNING_COURIER])(
        'status %s allows moving dropoff point, creating new Location and emitting event',
        async (status) => {
          mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue(testDelivery(status))

          await service.update(
            'del-152',
            partnerId,
            updateInput({ dropoffLatitude: 39.3625, dropoffLongitude: 22.943, notes: 'New notes' })
          )

          expect(mockLocationDomainService.create).toHaveBeenCalledTimes(1)
          expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledWith(
            'del-152',
            expect.anything(),
            expect.objectContaining({
              dropoffLocationId: 'loc-new',
              pickupNotes: 'New notes',
            })
          )
          expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
          expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).toHaveBeenCalledTimes(1)
          expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).toHaveBeenCalledWith(
            expect.objectContaining({
              type: EnumDeliveryEventType.DROPOFF_POINT_CORRECTED,
              actor: EnumEventActor.PARTNER,
              source: EnumDeliveryEventSource.PARTNER_APP,
            }),
            status
          )
        }
      )

      test.each([EnumDeliveryStatus.CREATED, EnumDeliveryStatus.ASSIGNING_COURIER])(
        'status %s allows editing notes without moving dropoff point',
        async (status) => {
          mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue(testDelivery(status))

          await service.update('del-152', partnerId, updateInput({ notes: 'Only note edit' }))

          expect(mockLocationDomainService.create).not.toHaveBeenCalled()
          expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledWith(
            'del-152',
            expect.anything(),
            expect.objectContaining({
              dropoffLocationId: 'loc-shared',
              pickupNotes: 'Only note edit',
            })
          )
          expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
          expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).not.toHaveBeenCalled()
        }
      )
    })

    describe('clause 4 (decision 152.4): tips behavior', () => {
      test.each(DELIVERY_ONGOING_STATUSES)(
        'held status %s preserves delivery tips even when restaurant sends tipByCustomer: 0',
        async (status) => {
          mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue(testDelivery(status, 250))

          await service.update('del-152', partnerId, updateInput({ tipByCustomer: 0 }))

          expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledWith(
            'del-152',
            expect.anything(),
            expect.objectContaining({ tips: 250 })
          )
          expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
          expect(mockDeliveryEventService.recordTipChangedEvent).not.toHaveBeenCalled()
        }
      )

      test.each(DELIVERY_ONGOING_STATUSES)(
        'held status %s preserves delivery tips even when restaurant sends different tipByCustomer',
        async (status) => {
          mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue(testDelivery(status, 150))

          await service.update('del-152', partnerId, updateInput({ tipByCustomer: 500 }))

          expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledWith(
            'del-152',
            expect.anything(),
            expect.objectContaining({ tips: 150 })
          )
          expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
          expect(mockDeliveryEventService.recordTipChangedEvent).not.toHaveBeenCalled()
        }
      )

      test.each([EnumDeliveryStatus.CREATED, EnumDeliveryStatus.ASSIGNING_COURIER])(
        'unassigned status %s applies sent tipByCustomer',
        async (status) => {
          mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue(testDelivery(status, 0))

          await service.update('del-152', partnerId, updateInput({ tipByCustomer: 300 }))

          expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledWith(
            'del-152',
            expect.anything(),
            expect.objectContaining({ tips: 300 })
          )
          expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
        }
      )

      test.each([EnumDeliveryStatus.CREATED, EnumDeliveryStatus.ASSIGNING_COURIER])(
        'unassigned status %s allows resetting tips to 0',
        async (status) => {
          mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue(testDelivery(status, 200))

          await service.update('del-152', partnerId, updateInput({ tipByCustomer: 0 }))

          expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledWith(
            'del-152',
            expect.anything(),
            expect.objectContaining({ tips: 0 })
          )
          expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
        }
      )
    })

    describe('Row 160: partner edit tip change event', () => {
      describe('clause 1: partner edit changing the tip on an unassigned order (CREATED, ASSIGNING_COURIER) writes ONE TIP_CHANGED event', () => {
        test.each([EnumDeliveryStatus.CREATED, EnumDeliveryStatus.ASSIGNING_COURIER])(
          'status %s: lowering tip to 0 writes ONE event with oldTip, newTip: 0, currency, status, no courierId',
          async (status) => {
            mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue(testDelivery(status, 150))

            await service.update('del-152', partnerId, updateInput({ tipByCustomer: 0 }))

            expect(mockDeliveryEventService.recordTipChangedEvent).toHaveBeenCalledTimes(1)
            expect(mockDeliveryEventService.recordTipChangedEvent).toHaveBeenCalledWith(
              {
                deliveryId: 'del-152',
                type: EnumDeliveryEventType.TIP_CHANGED,
                actor: EnumEventActor.PARTNER,
                source: EnumDeliveryEventSource.PARTNER_APP,
                message: 'Tip changed by the restaurant from 150 to 0 EUR (cents)',
                messageCode: 'TIP_CHANGED_BY_RESTAURANT',
                messageParams: {
                  oldTip: 150,
                  newTip: 0,
                  currency: 'EUR',
                },
              },
              status
            )
            const [recordedEvent] = mockDeliveryEventService.recordTipChangedEvent.mock.calls[0]
            expect(recordedEvent.courierId).toBeUndefined()
            expect('courierId' in recordedEvent).toBe(false)
          }
        )

        test.each([EnumDeliveryStatus.CREATED, EnumDeliveryStatus.ASSIGNING_COURIER])(
          'status %s: raising tip from 0 writes ONE event with oldTip: 0, newTip: 300',
          async (status) => {
            mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue(testDelivery(status, 0))

            await service.update('del-152', partnerId, updateInput({ tipByCustomer: 300 }))

            expect(mockDeliveryEventService.recordTipChangedEvent).toHaveBeenCalledTimes(1)
            expect(mockDeliveryEventService.recordTipChangedEvent).toHaveBeenCalledWith(
              {
                deliveryId: 'del-152',
                type: EnumDeliveryEventType.TIP_CHANGED,
                actor: EnumEventActor.PARTNER,
                source: EnumDeliveryEventSource.PARTNER_APP,
                message: 'Tip changed by the restaurant from 0 to 300 EUR (cents)',
                messageCode: 'TIP_CHANGED_BY_RESTAURANT',
                messageParams: {
                  oldTip: 0,
                  newTip: 300,
                  currency: 'EUR',
                },
              },
              status
            )
            const [recordedEvent] = mockDeliveryEventService.recordTipChangedEvent.mock.calls[0]
            expect(recordedEvent.courierId).toBeUndefined()
            expect('courierId' in recordedEvent).toBe(false)
          }
        )

        test.each([EnumDeliveryStatus.CREATED, EnumDeliveryStatus.ASSIGNING_COURIER])(
          'status %s: changing tip between non-zero amounts (100 to 250) writes ONE event',
          async (status) => {
            mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue(testDelivery(status, 100))

            await service.update('del-152', partnerId, updateInput({ tipByCustomer: 250 }))

            expect(mockDeliveryEventService.recordTipChangedEvent).toHaveBeenCalledTimes(1)
            expect(mockDeliveryEventService.recordTipChangedEvent).toHaveBeenCalledWith(
              {
                deliveryId: 'del-152',
                type: EnumDeliveryEventType.TIP_CHANGED,
                actor: EnumEventActor.PARTNER,
                source: EnumDeliveryEventSource.PARTNER_APP,
                message: 'Tip changed by the restaurant from 100 to 250 EUR (cents)',
                messageCode: 'TIP_CHANGED_BY_RESTAURANT',
                messageParams: {
                  oldTip: 100,
                  newTip: 250,
                  currency: 'EUR',
                },
              },
              status
            )
            const [recordedEvent] = mockDeliveryEventService.recordTipChangedEvent.mock.calls[0]
            expect(recordedEvent.courierId).toBeUndefined()
            expect('courierId' in recordedEvent).toBe(false)
          }
        )
      })

      describe('clause 2: an edit that leaves the tip alone writes no event', () => {
        test.each([EnumDeliveryStatus.CREATED, EnumDeliveryStatus.ASSIGNING_COURIER])(
          'status %s: sending same non-zero tip (150) writes no tip event',
          async (status) => {
            mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue(testDelivery(status, 150))

            await service.update('del-152', partnerId, updateInput({ tipByCustomer: 150 }))

            expect(mockDeliveryEventService.recordTipChangedEvent).not.toHaveBeenCalled()
          }
        )

        test.each([EnumDeliveryStatus.CREATED, EnumDeliveryStatus.ASSIGNING_COURIER])(
          'status %s: sending same zero tip (0) writes no tip event',
          async (status) => {
            mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue(testDelivery(status, 0))

            await service.update('del-152', partnerId, updateInput({ tipByCustomer: 0 }))

            expect(mockDeliveryEventService.recordTipChangedEvent).not.toHaveBeenCalled()
          }
        )
      })

      describe('clause 3: on an order a rider holds (DELIVERY_ONGOING_STATUSES), tip is kept and no event is written even with different tip', () => {
        test.each(DELIVERY_ONGOING_STATUSES)(
          'status %s preserves tip and calls no recordTipChangedEvent when restaurant sends 0',
          async (status) => {
            mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue(testDelivery(status, 250))

            await service.update('del-152', partnerId, updateInput({ tipByCustomer: 0 }))

            expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledWith(
              'del-152',
              expect.anything(),
              expect.objectContaining({ tips: 250 })
            )
            expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
            expect(mockDeliveryEventService.recordTipChangedEvent).not.toHaveBeenCalled()
          }
        )

        test.each(DELIVERY_ONGOING_STATUSES)(
          'status %s preserves tip and calls no recordTipChangedEvent when restaurant sends different tip (500)',
          async (status) => {
            mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue(testDelivery(status, 150))

            await service.update('del-152', partnerId, updateInput({ tipByCustomer: 500 }))

            expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledWith(
              'del-152',
              expect.anything(),
              expect.objectContaining({ tips: 150 })
            )
            expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
            expect(mockDeliveryEventService.recordTipChangedEvent).not.toHaveBeenCalled()
          }
        )
      })
    })
  })

  // Row 161: the partner edit's status check is a conditional write.
  // When an order changes between read and write, the conditional write fails (returns false),
  // causing the service to re-read and apply the rules for the newly observed state.
  describe('Row 161: partner edit conditional write and race handling', () => {
    const sharedLocation = {
      id: 'loc-shared',
      addressLine1: 'Iasonos 12',
      addressLine2: '3rd floor',
      city: 'Volos',
      state: 'Thessaly',
      street: 'Iasonos',
      zipCode: '38221',
      countryCode: 'GR',
      stateCode: 'TH',
      houseNumber: '12',
      formattedAddress: 'Iasonos 12, Volos 38221, Greece',
      latitude: 39.3621,
      longitude: 22.9425,
    }

    const testDelivery = (status: EnumDeliveryStatus, tips = 150) => ({
      id: 'del-161',
      partnerId,
      status,
      createdAt: new Date(),
      dropoffLocationId: 'loc-shared',
      deliveryQuoteId: 'quote-1',
      tips,
      currencyCode: 'EUR',
      orderReference: 'ORD-161',
    })

    const updateInput = (opts?: {
      dropoffLatitude?: number
      dropoffLongitude?: number
      tipByCustomer?: number
      notes?: string
    }) =>
      ({
        dropoffLatitude: opts?.dropoffLatitude ?? sharedLocation.latitude,
        dropoffLongitude: opts?.dropoffLongitude ?? sharedLocation.longitude,
        pickupNotes: opts?.notes ?? 'Pickup notes',
        dropoffNotes: opts?.notes ?? 'Dropoff notes',
        orderReference: 'ORD-161',
        tipByCustomer: opts?.tipByCustomer ?? 0,
      } as unknown as DeliveryUpdatePartnerInput)

    beforeEach(() => {
      mockDeliveryQuoteDomainService.getByIdOrThrow.mockResolvedValue({
        id: 'quote-1',
        dropoffLocationId: 'loc-shared',
      })
      mockLocationDomainService.getById = jest.fn().mockResolvedValue({ ...sharedLocation })
      mockLocationDomainService.create = jest.fn().mockResolvedValue({ id: 'loc-new' })
      mockLocationDomainService.update = jest.fn()
      mockDeliveryDomainService.updateIfMatches = jest
        .fn()
        .mockImplementation((id: string, where: any, data: Record<string, unknown>) => {
          mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue({ id, ...data })
          return Promise.resolve(true)
        })
      mockDeliveryDomainService.changeBoxSize = jest.fn()
      mockQuoteToDeliveryConversionService.isValidDeliveryLocationDrift = jest.fn().mockResolvedValue(true)
      mockDeliveryEventService.recordDropoffPointCorrectedEvent = jest.fn().mockResolvedValue(undefined)
      mockDeliveryEventService.recordTipChangedEvent = jest.fn().mockResolvedValue(undefined)
    })

    describe('clause 1: status changed between read and write writes nothing and gets row 152 refusal for new status', () => {
      test.each(PARTNER_ENDED_STATUSES)(
        'status moved to ended status %s: refuses with PARTNER_EDIT_SENTENCES.ended, writes nothing, records no event',
        async (endedStatus) => {
          // Read 1: ASSIGNING_COURIER (no rider)
          // Read 2: endedStatus (order ended while edit was in flight)
          mockDeliveryDomainService.getByIdOrThrow
            .mockResolvedValueOnce(testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER, 100))
            .mockResolvedValueOnce(testDelivery(endedStatus, 100))

          // First write attempt loses because status moved
          mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(false)

          await expect(
            service.update('del-161', partnerId, updateInput({ notes: 'Should not save' }))
          ).rejects.toThrow(new ConflictException(PARTNER_EDIT_SENTENCES.ended))

          // Exactly two reads were made
          expect(mockDeliveryDomainService.getByIdOrThrow).toHaveBeenCalledTimes(2)
          // Exactly one write attempt was made (which failed)
          expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
          expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledWith(
            'del-161',
            { status: EnumDeliveryStatus.ASSIGNING_COURIER, tips: 100, dropoffLocationId: 'loc-shared' },
            expect.anything()
          )
          // Nothing written unconditionally, and no event recorded
          expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
          expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).not.toHaveBeenCalled()
          expect(mockDeliveryEventService.recordTipChangedEvent).not.toHaveBeenCalled()
        }
      )

      test.each(DELIVERY_ONGOING_STATUSES)(
        'status moved to held status %s with point moved: refuses with PARTNER_EDIT_SENTENCES.pointHeld, writes nothing, records no event',
        async (heldStatus) => {
          // Read 1: ASSIGNING_COURIER
          // Read 2: heldStatus (courier accepted while edit was in flight)
          mockDeliveryDomainService.getByIdOrThrow
            .mockResolvedValueOnce(testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER, 100))
            .mockResolvedValueOnce(testDelivery(heldStatus, 100))

          mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(false)

          const inputWithMovedPoint = updateInput({
            dropoffLatitude: 39.3625,
            dropoffLongitude: 22.943,
            notes: 'Move point and edit notes',
          })

          await expect(service.update('del-161', partnerId, inputWithMovedPoint)).rejects.toThrow(
            new ConflictException(PARTNER_EDIT_SENTENCES.pointHeld)
          )

          expect(mockDeliveryDomainService.getByIdOrThrow).toHaveBeenCalledTimes(2)
          expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
          expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
          expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).not.toHaveBeenCalled()
          expect(mockDeliveryEventService.recordTipChangedEvent).not.toHaveBeenCalled()
        }
      )

      test.each(DELIVERY_ONGOING_STATUSES)(
        'status moved to held status %s with point unmoved: succeeds on 2nd try keeping delivery tip and emitting no tip event',
        async (heldStatus) => {
          const initialDelivery = testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER, 150)
          const heldDelivery = testDelivery(heldStatus, 150)

          // Read 1: ASSIGNING_COURIER
          // Read 2: heldStatus
          mockDeliveryDomainService.getByIdOrThrow
            .mockResolvedValueOnce(initialDelivery)
            .mockResolvedValueOnce(heldDelivery)

          // Write 1 loses (status moved from ASSIGNING_COURIER to heldStatus)
          // Write 2 succeeds
          mockDeliveryDomainService.updateIfMatches
            .mockResolvedValueOnce(false)
            .mockImplementationOnce((id: string, where: any, data: any) => {
              mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce({ ...heldDelivery, ...data })
              return Promise.resolve(true)
            })

          // Restaurant attempts to change tip to 500 along with notes
          const input = updateInput({ notes: 'Safe notes update', tipByCustomer: 500 })

          const result = await service.update('del-161', partnerId, input)

          // 3 reads: attempt 1 initial read, attempt 2 re-read, attempt 2 post-write read
          expect(mockDeliveryDomainService.getByIdOrThrow).toHaveBeenCalledTimes(3)
          expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(2)

          // Attempt 1 checked initial status
          expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenNthCalledWith(
            1,
            'del-161',
            { status: EnumDeliveryStatus.ASSIGNING_COURIER, tips: 150, dropoffLocationId: 'loc-shared' },
            expect.anything()
          )

          // Attempt 2 checked heldStatus and kept original tip 150 (decision 152.4)
          expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenNthCalledWith(
            2,
            'del-161',
            { status: heldStatus, tips: 150, dropoffLocationId: 'loc-shared' },
            expect.objectContaining({
              tips: 150,
              pickupNotes: 'Safe notes update',
              dropoffNotes: 'Safe notes update',
            })
          )

          expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
          expect(mockDeliveryEventService.recordTipChangedEvent).not.toHaveBeenCalled()
          expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).not.toHaveBeenCalled()
          expect(result.tips).toBe(150)
          expect(result.pickupNotes).toBe('Safe notes update')
        }
      )
    })

    describe('clause 2: an edit with no race behaves as today', () => {
      it('performs one read, one conditional write that succeeds, and records TIP_CHANGED and DROPOFF_POINT_CORRECTED events', async () => {
        const delivery = testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER, 100)
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue(delivery)

        const input = updateInput({
          dropoffLatitude: 39.3625,
          dropoffLongitude: 22.943,
          tipByCustomer: 300,
          notes: 'Fresh notes',
        })

        const result = await service.update('del-161', partnerId, input)

        // Exactly 2 reads: one before write, one after write to return saved delivery
        expect(mockDeliveryDomainService.getByIdOrThrow).toHaveBeenCalledTimes(2)
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledWith(
          'del-161',
          { status: EnumDeliveryStatus.ASSIGNING_COURIER, tips: 100, dropoffLocationId: 'loc-shared' },
          expect.objectContaining({
            dropoffLocationId: 'loc-new',
            dropoffCorrectedLatitude: null,
            dropoffCorrectedLongitude: null,
            tips: 300,
            pickupNotes: 'Fresh notes',
            dropoffNotes: 'Fresh notes',
          })
        )
        expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
        expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).toHaveBeenCalledTimes(1)
        expect(mockDeliveryEventService.recordTipChangedEvent).toHaveBeenCalledTimes(1)
        expect(result.tips).toBe(300)
        expect(result.dropoffLocationId).toBe('loc-new')
      })
    })

    describe('clause 3: write is conditional on status, tips and dropoffLocationId', () => {
      it('fails if the write is unconditional or if any where condition does not match what was read', async () => {
        const delivery = testDelivery(EnumDeliveryStatus.CREATED, 250)
        delivery.dropoffLocationId = 'loc-specific'
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue(delivery)
        mockLocationDomainService.getById.mockResolvedValue({ ...sharedLocation, id: 'loc-specific' })

        await service.update('del-161', partnerId, updateInput({ notes: 'Note edit' }))

        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
        const [calledId, calledWhere, calledInput] = mockDeliveryDomainService.updateIfMatches.mock.calls[0]

        expect(calledId).toBe('del-161')
        // Where condition must carry all three fields matching exactly what was read
        expect(calledWhere).toEqual({
          status: EnumDeliveryStatus.CREATED,
          tips: 250,
          dropoffLocationId: 'loc-specific',
        })
        expect(calledInput).toBeDefined()
        // Plain unconditional update must never be called
        expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
      })
    })

    describe('concurrent tip edits (folded in from row 160 review)', () => {
      it('two identical edits of tip at once write one TIP_CHANGED, not two', async () => {
        // Edit 1 changes tip from 100 to 200 and succeeds.
        // Edit 2 was in flight at the same time:
        // - First read of Edit 2 saw tip 100
        // - Edit 2 tries to write tip 200 with where { tips: 100 }, which returns false because Edit 1 already committed
        // - Edit 2 re-reads and sees tip 200
        // - Edit 2 second write attempt matches where { tips: 200 } and succeeds
        // - Because tip was already 200, Edit 2 records NO TIP_CHANGED event!
        const initialDelivery = testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER, 100)
        const updatedDeliveryAfterFirstEdit = testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER, 200)

        mockDeliveryDomainService.getByIdOrThrow
          .mockResolvedValueOnce(initialDelivery)
          .mockResolvedValueOnce(updatedDeliveryAfterFirstEdit)

        mockDeliveryDomainService.updateIfMatches
          .mockResolvedValueOnce(false) // First write loses (tips moved)
          .mockImplementationOnce((id: string, where: any, data: any) => {
            mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce({
              ...updatedDeliveryAfterFirstEdit,
              ...data,
            })
            return Promise.resolve(true)
          })

        const edit2Input = updateInput({ tipByCustomer: 200 })

        const result = await service.update('del-161', partnerId, edit2Input)

        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(2)
        // 1st attempt tried where tips: 100
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenNthCalledWith(
          1,
          'del-161',
          { status: EnumDeliveryStatus.ASSIGNING_COURIER, tips: 100, dropoffLocationId: 'loc-shared' },
          expect.anything()
        )
        // 2nd attempt matched where tips: 200
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenNthCalledWith(
          2,
          'del-161',
          { status: EnumDeliveryStatus.ASSIGNING_COURIER, tips: 200, dropoffLocationId: 'loc-shared' },
          expect.anything()
        )

        // Crucial assertion: no TIP_CHANGED event was written by Edit 2
        expect(mockDeliveryEventService.recordTipChangedEvent).not.toHaveBeenCalled()
        expect(result.tips).toBe(200)
      })
    })

    describe('retry loop limit and exhaustion', () => {
      it('three lost writes in a row answer ConflictException with PARTNER_EDIT_SENTENCES.changed after exactly three reads and writes with no event', async () => {
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue(
          testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER, 150)
        )
        // Every write attempt loses (returns false)
        mockDeliveryDomainService.updateIfMatches.mockResolvedValue(false)

        await expect(
          service.update('del-161', partnerId, updateInput({ notes: 'Attempt' }))
        ).rejects.toThrow(new ConflictException(PARTNER_EDIT_SENTENCES.changed))

        // Exactly three reads and three write attempts
        expect(mockDeliveryDomainService.getByIdOrThrow).toHaveBeenCalledTimes(3)
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(3)
        expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
        expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).not.toHaveBeenCalled()
        expect(mockDeliveryEventService.recordTipChangedEvent).not.toHaveBeenCalled()
      })
    })
  })
})
