import { BadRequestException, ConflictException } from '@nestjs/common'
import {
  BOX_SIZE_LOCKED_MESSAGE,
  DeliveryLocationDoesntMatchQuoteException,
  DeliveryNotFoundException,
  NotFoundException,
} from 'src/errors'
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
import { LEG_LABELS_LOCKED_SENTENCE } from 'src/domains/delivery/legs'

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
      boxSizeChangeFor: jest.fn().mockImplementation(async (delivery: any, newSize: BoxSize) => {
        if (delivery.matchedCourierId !== null || delivery.courierId !== null) {
          throw new ConflictException(BOX_SIZE_LOCKED_MESSAGE)
        }
        const unitsMap: Record<BoxSize, number> = {
          [BoxSize.SMALL]: 30,
          [BoxSize.MEDIUM]: 50,
          [BoxSize.LARGE]: 100,
        }
        return {
          where: { matchedCourierId: null, courierId: null, boxSize: delivery.boxSize },
          data: { boxSize: newSize, boxUnits: unitsMap[newSize], boxSizeAssumed: false },
        }
      }),
      recordBoxSizeChanged: jest.fn().mockResolvedValue(undefined),
    }
    mockPartnerDomainService = {}
    mockLocationDomainService = {
      getByIds: jest.fn().mockResolvedValue([]),
      getById: jest.fn().mockResolvedValue({ id: 'loc-1' }),
      create: jest.fn().mockResolvedValue({ id: 'loc-new' }),
      deleteIfUnused: jest.fn().mockResolvedValue(true),
    }
    mockCourierDomainService = {
      getByIdWithSettings: jest.fn(),
    }
    mockQuoteToDeliveryConversionService = {
      isValidDeliveryLocationDrift: jest.fn().mockResolvedValue(true),
    }
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
      recordBoxEvent: jest.fn().mockResolvedValue(undefined),
      notifyJobEdited: jest.fn().mockResolvedValue(undefined),
      processDeliveryEvent: jest.fn().mockResolvedValue(undefined),
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

      it('boxSize null changes nothing and calls no boxSizeChangeFor', async () => {
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
        mockDeliveryDomainService.updateIfMatches.mockResolvedValue(true)

        await service.update('del-update-null-size', partnerId, {
          boxSize: null,
          dropoffLatitude: 39.36,
          dropoffLongitude: 22.94,
        } as any)

        expect(mockDeliveryDomainService.boxSizeChangeFor).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.recordBoxSizeChanged).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledWith(
          'del-update-null-size',
          expect.anything(),
          expect.anything()
        )
        expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
      })

      it('the size change runs after the drift check, so an update refused by the drift check leaves the size unchanged (boxSizeChangeFor not called)', async () => {
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue({
          id: 'del-update-drift-fail',
          partnerId,
          status: EnumDeliveryStatus.CREATED,
          createdAt: new Date(),
          dropoffLocationId: 'loc-current',
          deliveryQuoteId: 'quote-1',
          boxSize: BoxSize.MEDIUM,
          courierId: null,
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

        await expect(
          service.update('del-update-drift-fail', partnerId, {
            boxSize: BoxSize.LARGE,
            dropoffLatitude: 40.0,
            dropoffLongitude: 23.0,
          } as any)
        ).rejects.toThrow(DeliveryLocationDoesntMatchQuoteException)

        expect(mockQuoteToDeliveryConversionService.isValidDeliveryLocationDrift).toHaveBeenCalled()
        expect(mockDeliveryDomainService.boxSizeChangeFor).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.recordBoxSizeChanged).not.toHaveBeenCalled()
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
      tips: 150,
      courierId: null,
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
      mockLocationDomainService.deleteIfUnused = jest.fn().mockResolvedValue(true)
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
          { status: EnumDeliveryStatus.ASSIGNING_COURIER, tips: 150, dropoffLocationId: 'loc-shared', courierId: null },
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
          { status: EnumDeliveryStatus.ASSIGNING_COURIER, tips: 150, dropoffLocationId: 'loc-shared', courierId: null },
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
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledWith('del-own', expect.anything(), {
          dropoffLocationId: 'loc-current-far',
          ...otherUpdateFields,
        })
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
        mockDeliveryDomainService.updateIfMatches = jest.fn((id: string, where: any, data: Partial<FakeDelivery>) => {
          const updated = { ...rowOrThrow(deliveries, id), ...data }
          deliveries.set(id, updated)
          return Promise.resolve(true)
        })
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
      matchedCourierId: null,
      courierId: null,
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
        ...(opts && 'tipByCustomer' in opts ? { tipByCustomer: opts.tipByCustomer } : {}),
        pickupReadyAt: opts?.pickupReadyAt,
      } as unknown as DeliveryUpdatePartnerInput)

    beforeEach(() => {
      mockDeliveryQuoteDomainService.getByIdOrThrow.mockResolvedValue({
        id: 'quote-1',
        dropoffLocationId: 'loc-shared',
      })
      mockLocationDomainService.getById = jest.fn().mockResolvedValue({ ...sharedLocation })
      mockLocationDomainService.create = jest.fn().mockResolvedValue({ id: 'loc-new' })
      mockLocationDomainService.deleteIfUnused = jest.fn().mockResolvedValue(true)
      mockLocationDomainService.update = jest.fn()
      mockDeliveryDomainService.updateIfMatches = jest
        .fn()
        .mockImplementation((id: string, where: any, data: Record<string, unknown>) => {
          mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue({ id, ...data })
          return Promise.resolve(true)
        })
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
          expect(mockDeliveryDomainService.boxSizeChangeFor).not.toHaveBeenCalled()
          expect(mockDeliveryDomainService.recordBoxSizeChanged).not.toHaveBeenCalled()
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
          expect(mockDeliveryDomainService.boxSizeChangeFor).not.toHaveBeenCalled()
          expect(mockDeliveryDomainService.recordBoxSizeChanged).not.toHaveBeenCalled()
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
      matchedCourierId: null,
      courierId: null,
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
        ...(opts && 'tipByCustomer' in opts ? { tipByCustomer: opts.tipByCustomer } : {}),
      } as unknown as DeliveryUpdatePartnerInput)

    beforeEach(() => {
      mockDeliveryQuoteDomainService.getByIdOrThrow.mockResolvedValue({
        id: 'quote-1',
        dropoffLocationId: 'loc-shared',
      })
      mockLocationDomainService.getById = jest.fn().mockResolvedValue({ ...sharedLocation })
      mockLocationDomainService.create = jest.fn().mockResolvedValue({ id: 'loc-new' })
      mockLocationDomainService.deleteIfUnused = jest.fn().mockResolvedValue(true)
      mockLocationDomainService.update = jest.fn()
      mockDeliveryDomainService.updateIfMatches = jest
        .fn()
        .mockImplementation((id: string, where: any, data: Record<string, unknown>) => {
          mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue({ id, ...data })
          return Promise.resolve(true)
        })
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

          await expect(service.update('del-161', partnerId, updateInput({ notes: 'Should not save' }))).rejects.toThrow(
            new ConflictException(PARTNER_EDIT_SENTENCES.ended)
          )

          // Exactly two reads were made
          expect(mockDeliveryDomainService.getByIdOrThrow).toHaveBeenCalledTimes(2)
          // Exactly one write attempt was made (which failed)
          expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
          expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledWith(
            'del-161',
            {
              status: EnumDeliveryStatus.ASSIGNING_COURIER,
              tips: 100,
              dropoffLocationId: 'loc-shared',
              courierId: null,
            },
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
            {
              status: EnumDeliveryStatus.ASSIGNING_COURIER,
              tips: 150,
              dropoffLocationId: 'loc-shared',
              courierId: null,
            },
            expect.anything()
          )

          // Attempt 2 checked heldStatus and kept original tip 150 (decision 152.4)
          expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenNthCalledWith(
            2,
            'del-161',
            { status: heldStatus, tips: 150, dropoffLocationId: 'loc-shared', courierId: null },
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
          { status: EnumDeliveryStatus.ASSIGNING_COURIER, tips: 100, dropoffLocationId: 'loc-shared', courierId: null },
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
          courierId: null,
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
          { status: EnumDeliveryStatus.ASSIGNING_COURIER, tips: 100, dropoffLocationId: 'loc-shared', courierId: null },
          expect.anything()
        )
        // 2nd attempt matched where tips: 200
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenNthCalledWith(
          2,
          'del-161',
          { status: EnumDeliveryStatus.ASSIGNING_COURIER, tips: 200, dropoffLocationId: 'loc-shared', courierId: null },
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

        await expect(service.update('del-161', partnerId, updateInput({ notes: 'Attempt' }))).rejects.toThrow(
          new ConflictException(PARTNER_EDIT_SENTENCES.changed)
        )

        // Exactly three reads and three write attempts
        expect(mockDeliveryDomainService.getByIdOrThrow).toHaveBeenCalledTimes(3)
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(3)
        expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
        expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).not.toHaveBeenCalled()
        expect(mockDeliveryEventService.recordTipChangedEvent).not.toHaveBeenCalled()
      })
    })

    describe('point race retry (Minor 2)', () => {
      it('measures move from point B on retry when point was moved from A to B between read and write, with B in where and event', async () => {
        // Point A: initial dropoff location
        const locA = { ...sharedLocation, id: 'loc-A', latitude: 39.3621, longitude: 22.9425 }
        // Point B: someone else moved the point concurrently to B
        const locB = { ...sharedLocation, id: 'loc-B', latitude: 39.363, longitude: 22.943 }
        // Destination C in the restaurant update input
        const destLat = 39.365
        const destLon = 22.945
        const locC = { id: 'loc-C' }

        const delivery1 = {
          ...testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER, 150),
          dropoffLocationId: 'loc-A',
        }
        const delivery2 = {
          ...testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER, 150),
          dropoffLocationId: 'loc-B',
        }

        mockLocationDomainService.getById = jest.fn((id: string) => {
          if (id === 'loc-A') return Promise.resolve(locA)
          if (id === 'loc-B') return Promise.resolve(locB)
          if (id === 'loc-shared') return Promise.resolve(sharedLocation)
          return Promise.resolve(null)
        })
        mockLocationDomainService.create = jest.fn().mockResolvedValue(locC)

        // Read 1 sees point A; Read 2 sees point B; Read 3 (after write 2) returns saved delivery
        mockDeliveryDomainService.getByIdOrThrow
          .mockResolvedValueOnce(delivery1)
          .mockResolvedValueOnce(delivery2)
          .mockResolvedValueOnce({ ...delivery2, dropoffLocationId: 'loc-C' })

        // Write 1 loses (returns false, e.g. someone moved point A to B)
        // Write 2 succeeds
        mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

        const input = updateInput({
          dropoffLatitude: destLat,
          dropoffLongitude: destLon,
        })

        const result = await service.update('del-161', partnerId, input)

        // Two write attempts
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(2)

        // First write matched on point A
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenNthCalledWith(
          1,
          'del-161',
          { status: EnumDeliveryStatus.ASSIGNING_COURIER, tips: 150, dropoffLocationId: 'loc-A', courierId: null },
          expect.anything()
        )

        // Second write carried point B's dropoffLocationId in where
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenNthCalledWith(
          2,
          'del-161',
          { status: EnumDeliveryStatus.ASSIGNING_COURIER, tips: 150, dropoffLocationId: 'loc-B', courierId: null },
          expect.objectContaining({
            dropoffLocationId: 'loc-C',
            dropoffCorrectedLatitude: null,
            dropoffCorrectedLongitude: null,
          })
        )

        // Exactly one DROPOFF_POINT_CORRECTED event recorded (not two!)
        expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).toHaveBeenCalledTimes(1)
        expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            deliveryId: 'del-161',
            type: EnumDeliveryEventType.DROPOFF_POINT_CORRECTED,
            messageParams: expect.objectContaining({
              from: '39.36300, 22.94300',
              to: '39.36500, 22.94500',
            }),
          }),
          EnumDeliveryStatus.ASSIGNING_COURIER
        )

        // Event message explicitly names point B as the old point
        const [recordedEvent] = mockDeliveryEventService.recordDropoffPointCorrectedEvent.mock.calls[0]
        expect(recordedEvent.message).toContain('39.36300, 22.94300')

        expect(result.dropoffLocationId).toBe('loc-C')
      })
    })

    describe('size change then lost write (Row 167)', () => {
      it('calls boxSizeChangeFor on each try and recordBoxSizeChanged once when updateIfMatches loses once and lands on try 2', async () => {
        const initialDelivery = {
          ...testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER, 150),
          matchedCourierId: null,
          courierId: null,
          boxSize: BoxSize.SMALL,
          boxUnits: 30,
        }
        const savedDelivery = {
          ...initialDelivery,
          boxSize: BoxSize.LARGE,
          boxUnits: 100,
          boxSizeAssumed: false,
          pickupNotes: 'Updated notes',
        }

        // Read 1: delivery with BoxSize.SMALL
        // Read 2: delivery still has BoxSize.SMALL (since lost write did not write size)
        // Read 3 (after write 2 succeeds): returns saved delivery
        mockDeliveryDomainService.getByIdOrThrow
          .mockResolvedValueOnce(initialDelivery)
          .mockResolvedValueOnce(initialDelivery)
          .mockResolvedValueOnce(savedDelivery)

        // Write 1 loses (returns false)
        // Write 2 succeeds
        mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

        const input = {
          ...updateInput({ notes: 'Updated notes' }),
          boxSize: BoxSize.LARGE,
        }

        const result = await service.update('del-161', partnerId, input)

        // boxSizeChangeFor was called on each try
        expect(mockDeliveryDomainService.boxSizeChangeFor).toHaveBeenCalledTimes(2)
        expect(mockDeliveryDomainService.boxSizeChangeFor).toHaveBeenCalledWith(initialDelivery, BoxSize.LARGE)

        // recordBoxSizeChanged was called exactly once after the write landed
        expect(mockDeliveryDomainService.recordBoxSizeChanged).toHaveBeenCalledTimes(1)

        // updateIfMatches was attempted twice
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(2)

        // The edit succeeds
        expect(result).toBeDefined()
        expect(result.boxSize).toBe(BoxSize.LARGE)
        expect(result.pickupNotes).toBe('Updated notes')
      })
    })

    describe('visibility check on retry (Minor 2)', () => {
      it('refuses with 404 when the second read after a lost write belongs to another restaurant (fails assertVisibleToPartner)', async () => {
        const initialDelivery = testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER, 150)
        const invisibleDelivery = {
          ...initialDelivery,
          partnerId: otherPartnerId,
        }

        mockDeliveryDomainService.getByIdOrThrow
          .mockResolvedValueOnce(initialDelivery)
          .mockResolvedValueOnce(invisibleDelivery)

        // First write attempt loses
        mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(false)

        await expect(
          service.update('del-161', partnerId, updateInput({ notes: 'Will fail on retry' }))
        ).rejects.toThrow(new DeliveryNotFoundException('Delivery not found'))

        // Second updateIfMatches was never called
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledWith(
          'del-161',
          { status: EnumDeliveryStatus.ASSIGNING_COURIER, tips: 150, dropoffLocationId: 'loc-shared', courierId: null },
          expect.anything()
        )

        // No event recorded
        expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).not.toHaveBeenCalled()
        expect(mockDeliveryEventService.recordTipChangedEvent).not.toHaveBeenCalled()
      })

      it('refuses with 404 period sentence when the second read after a lost write is an own old ended delivery past the history cutoff', async () => {
        const initialDelivery = testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER, 150)
        const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
        const oldEndedDelivery = {
          ...initialDelivery,
          status: EnumDeliveryStatus.CANCELED,
          createdAt: oldDate,
        }

        mockDeliveryDomainService.getByIdOrThrow
          .mockResolvedValueOnce(initialDelivery)
          .mockResolvedValueOnce(oldEndedDelivery)

        mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(false)

        await expect(
          service.update('del-161', partnerId, updateInput({ notes: 'Will fail on retry' }))
        ).rejects.toThrow(
          new DeliveryNotFoundException('This order is older than 30 days. The co-op can look it up for you.')
        )

        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
        expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).not.toHaveBeenCalled()
        expect(mockDeliveryEventService.recordTipChangedEvent).not.toHaveBeenCalled()
      })
    })
  })

  // Row 166: a lost partner edit leaves no unused address behind
  // A point move makes its new Location row before the conditional write. If the write loses a race,
  // the row is kept and reused across tries while the order still has the drop off row it was copied from.
  // When the edit ends by any way out (landed, refused, three losses, or error), any row not used by a
  // landed write is deleted in finally.
  describe('Row 166: a lost partner edit leaves no unused address behind', () => {
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

    const testDelivery = (status: EnumDeliveryStatus, opts?: Record<string, unknown>) => ({
      id: 'del-166',
      partnerId,
      status,
      createdAt: new Date(),
      dropoffLocationId: (opts?.dropoffLocationId as string) ?? 'loc-shared',
      deliveryQuoteId: 'quote-1',
      tips: (opts?.tips as number) ?? 150,
      currencyCode: 'EUR',
      orderReference: 'ORD-166',
      matchedCourierId: null,
      courierId: null,
      ...opts,
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
        orderReference: 'ORD-166',
        ...(opts && 'tipByCustomer' in opts ? { tipByCustomer: opts.tipByCustomer } : {}),
      } as unknown as DeliveryUpdatePartnerInput)

    const newPointInput = updateInput({
      dropoffLatitude: 39.365,
      dropoffLongitude: 22.945,
    })

    beforeEach(() => {
      mockDeliveryQuoteDomainService.getByIdOrThrow.mockResolvedValue({
        id: 'quote-1',
        dropoffLocationId: 'loc-shared',
      })
      mockLocationDomainService.getById = jest.fn().mockImplementation((id: string) => {
        if (id === 'loc-shared') return Promise.resolve({ ...sharedLocation })
        return Promise.resolve({ ...sharedLocation, id })
      })
      mockLocationDomainService.create = jest.fn().mockResolvedValue({ id: 'loc-new-1' })
      mockLocationDomainService.deleteIfUnused = jest.fn().mockResolvedValue(true)
      mockDeliveryDomainService.updateIfMatches = jest
        .fn()
        .mockImplementation((id: string, where: any, data: Record<string, unknown>) => {
          mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue({ id, ...data })
          return Promise.resolve(true)
        })
      mockQuoteToDeliveryConversionService.isValidDeliveryLocationDrift = jest.fn().mockResolvedValue(true)
      mockDeliveryEventService.recordDropoffPointCorrectedEvent = jest.fn().mockResolvedValue(undefined)
      mockDeliveryEventService.recordTipChangedEvent = jest.fn().mockResolvedValue(undefined)
    })

    describe('clause 1: point move losing conditional write and refused on next try leaves no new Location row', () => {
      it('deletes created Location row when next try is refused because courier accepted (PARTNER_EDIT_POINT_HELD)', async () => {
        // Read 1: ASSIGNING_COURIER (no courier held yet)
        // Read 2: ACCEPTED (courier accepted during try 1)
        mockDeliveryDomainService.getByIdOrThrow
          .mockResolvedValueOnce(testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER))
          .mockResolvedValueOnce(testDelivery(EnumDeliveryStatus.ACCEPTED))

        // Write 1 loses race
        mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(false)

        await expect(service.update('del-166', partnerId, newPointInput)).rejects.toThrow(
          new ConflictException(PARTNER_EDIT_SENTENCES.pointHeld)
        )

        // Location was created once on try 1
        expect(mockLocationDomainService.create).toHaveBeenCalledTimes(1)
        // In finally, because write never landed, the unused row was deleted
        expect(mockLocationDomainService.deleteIfUnused).toHaveBeenCalledTimes(1)
        expect(mockLocationDomainService.deleteIfUnused).toHaveBeenCalledWith('loc-new-1')
        // No delivery fields or events written
        expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).not.toHaveBeenCalled()
      })

      it('deletes created Location row when next try is refused because order ended (PARTNER_EDIT_SENTENCES.ended)', async () => {
        mockDeliveryDomainService.getByIdOrThrow
          .mockResolvedValueOnce(testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER))
          .mockResolvedValueOnce(testDelivery(EnumDeliveryStatus.DROPPED_OFF))

        mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(false)

        await expect(service.update('del-166', partnerId, newPointInput)).rejects.toThrow(
          new ConflictException(PARTNER_EDIT_SENTENCES.ended)
        )

        expect(mockLocationDomainService.create).toHaveBeenCalledTimes(1)
        expect(mockLocationDomainService.deleteIfUnused).toHaveBeenCalledTimes(1)
        expect(mockLocationDomainService.deleteIfUnused).toHaveBeenCalledWith('loc-new-1')
      })
    })

    describe('clause 2: point move losing and then landing leaves exactly one Location row', () => {
      it('creates Location row once, reuses it on retry, writes dropoffLocationId, and never calls delete', async () => {
        const initialDelivery = testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER, { tips: 100 })
        const retryDelivery = testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER, { tips: 200 })

        // Read 1: initial tips 100
        // Read 2: tips changed to 200 concurrently, but still ASSIGNING_COURIER with same dropoffLocationId
        // Read 3: post-write read returning saved delivery
        mockDeliveryDomainService.getByIdOrThrow
          .mockResolvedValueOnce(initialDelivery)
          .mockResolvedValueOnce(retryDelivery)
          .mockResolvedValueOnce({ ...retryDelivery, dropoffLocationId: 'loc-new-1' })

        // Write 1 loses race (tips mismatch)
        // Write 2 succeeds
        mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

        const result = await service.update('del-166', partnerId, newPointInput)

        // Location was created only once across both tries (reused on try 2)
        expect(mockLocationDomainService.create).toHaveBeenCalledTimes(1)
        // Two write attempts
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(2)
        // Second write used the created location id
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenNthCalledWith(
          2,
          'del-166',
          expect.anything(),
          expect.objectContaining({ dropoffLocationId: 'loc-new-1' })
        )
        // Delete was never called because landed write used the row
        expect(mockLocationDomainService.deleteIfUnused).not.toHaveBeenCalled()
        expect(result.dropoffLocationId).toBe('loc-new-1')
      })
    })

    describe('clause 3: three losses or any other error thrown inside a try deletes the row in finally', () => {
      it('deletes the created Location row in finally after three lost writes (PARTNER_EDIT_CHANGED)', async () => {
        const delivery = testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER)
        mockDeliveryDomainService.getByIdOrThrow
          .mockResolvedValueOnce(delivery)
          .mockResolvedValueOnce(delivery)
          .mockResolvedValueOnce(delivery)

        // Three lost writes in a row
        mockDeliveryDomainService.updateIfMatches.mockResolvedValue(false)

        await expect(service.update('del-166', partnerId, newPointInput)).rejects.toThrow(
          new ConflictException(PARTNER_EDIT_SENTENCES.changed)
        )

        // Created once on try 1 and reused on tries 2 and 3
        expect(mockLocationDomainService.create).toHaveBeenCalledTimes(1)
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(3)
        // Deleted in finally
        expect(mockLocationDomainService.deleteIfUnused).toHaveBeenCalledTimes(1)
        expect(mockLocationDomainService.deleteIfUnused).toHaveBeenCalledWith('loc-new-1')
      })

      it('deletes the created Location row in finally when an error is thrown inside tryPartnerEdit', async () => {
        const delivery = testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER)
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(delivery).mockResolvedValueOnce(delivery)

        mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(false)
        // On try 1, drift check passes; on try 2, drift check fails unexpectedly
        mockQuoteToDeliveryConversionService.isValidDeliveryLocationDrift
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(false)

        await expect(service.update('del-166', partnerId, newPointInput)).rejects.toThrow(
          DeliveryLocationDoesntMatchQuoteException
        )

        expect(mockLocationDomainService.create).toHaveBeenCalledTimes(1)
        expect(mockLocationDomainService.deleteIfUnused).toHaveBeenCalledTimes(1)
        expect(mockLocationDomainService.deleteIfUnused).toHaveBeenCalledWith('loc-new-1')
      })

      it('deletes the created Location row in finally when updateIfMatches throws an unexpected error on try 1', async () => {
        const delivery = testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER)
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(delivery)

        // updateIfMatches throws an unexpected database error
        mockDeliveryDomainService.updateIfMatches.mockRejectedValueOnce(new Error('Database disk error'))

        await expect(service.update('del-166', partnerId, newPointInput)).rejects.toThrow('Database disk error')

        expect(mockLocationDomainService.create).toHaveBeenCalledTimes(1)
        expect(mockLocationDomainService.deleteIfUnused).toHaveBeenCalledTimes(1)
        expect(mockLocationDomainService.deleteIfUnused).toHaveBeenCalledWith('loc-new-1')
      })

      it('deletes the created Location row in finally when assertVisibleToPartner throws on retry', async () => {
        const delivery = testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER)
        const otherDelivery = testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER, { partnerId: 'other-partner' })

        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(delivery).mockResolvedValueOnce(otherDelivery)

        mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(false)

        await expect(service.update('del-166', partnerId, newPointInput)).rejects.toThrow(
          new DeliveryNotFoundException('Delivery not found')
        )

        expect(mockLocationDomainService.create).toHaveBeenCalledTimes(1)
        expect(mockLocationDomainService.deleteIfUnused).toHaveBeenCalledTimes(1)
        expect(mockLocationDomainService.deleteIfUnused).toHaveBeenCalledWith('loc-new-1')
      })
    })

    describe('clause 4: dropoff row changed between tries deletes old copy and makes fresh one', () => {
      it('deletes old copy and creates a new one when fresh read has different dropoffLocationId', async () => {
        const locA = { ...sharedLocation, id: 'loc-A', latitude: 39.3621, longitude: 22.9425 }
        const locB = { ...sharedLocation, id: 'loc-B', latitude: 39.363, longitude: 22.943 }

        mockLocationDomainService.getById = jest.fn((id: string) => {
          if (id === 'loc-A') return Promise.resolve(locA)
          if (id === 'loc-B') return Promise.resolve(locB)
          if (id === 'loc-shared') return Promise.resolve(sharedLocation)
          return Promise.resolve(null)
        })

        // Try 1 creates loc-copy-A, try 2 creates loc-copy-B
        mockLocationDomainService.create
          .mockResolvedValueOnce({ id: 'loc-copy-A' })
          .mockResolvedValueOnce({ id: 'loc-copy-B' })

        const deliveryA = testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER, { dropoffLocationId: 'loc-A' })
        const deliveryB = testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER, { dropoffLocationId: 'loc-B' })

        // Read 1: delivery on loc-A
        // Read 2: delivery on loc-B (e.g. concurrent address change)
        // Read 3: post-write read
        mockDeliveryDomainService.getByIdOrThrow
          .mockResolvedValueOnce(deliveryA)
          .mockResolvedValueOnce(deliveryB)
          .mockResolvedValueOnce({ ...deliveryB, dropoffLocationId: 'loc-copy-B' })

        // Write 1 loses race
        // Write 2 succeeds
        mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

        const result = await service.update('del-166', partnerId, newPointInput)

        // Created twice: once for loc-A, once for loc-B
        expect(mockLocationDomainService.create).toHaveBeenCalledTimes(2)
        // loc-copy-A was deleted when try 2 noticed dropoffLocationId changed
        expect(mockLocationDomainService.deleteIfUnused).toHaveBeenCalledTimes(1)
        expect(mockLocationDomainService.deleteIfUnused).toHaveBeenCalledWith('loc-copy-A')
        // Landed write used loc-copy-B
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenNthCalledWith(
          2,
          'del-166',
          expect.anything(),
          expect.objectContaining({ dropoffLocationId: 'loc-copy-B' })
        )
        // loc-copy-B was not deleted in finally because it was used
        expect(result.dropoffLocationId).toBe('loc-copy-B')
      })
    })

    describe('clause 5: no point move makes no row; fresh read already having input point deletes unused row', () => {
      it('makes no Location row and deletes nothing when input has no point move', async () => {
        const delivery = testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER)
        mockDeliveryDomainService.getByIdOrThrow
          .mockResolvedValueOnce(delivery)
          .mockResolvedValueOnce({ ...delivery, pickupNotes: 'Only notes changed' })

        const input = updateInput({ notes: 'Only notes changed' })
        const result = await service.update('del-166', partnerId, input)

        expect(mockLocationDomainService.create).not.toHaveBeenCalled()
        expect(mockLocationDomainService.deleteIfUnused).not.toHaveBeenCalled()
        expect(result.dropoffLocationId).toBe('loc-shared')
      })

      it('deletes unused row when try 1 moved point but fresh read on try 2 already has input point (pointMoved false)', async () => {
        const targetLat = 39.365
        const targetLon = 22.945

        const locInitial = { ...sharedLocation, id: 'loc-initial', latitude: 39.3621, longitude: 22.9425 }
        const locAlreadyTarget = { ...sharedLocation, id: 'loc-target', latitude: targetLat, longitude: targetLon }

        mockLocationDomainService.getById = jest.fn((id: string) => {
          if (id === 'loc-initial') return Promise.resolve(locInitial)
          if (id === 'loc-target') return Promise.resolve(locAlreadyTarget)
          if (id === 'quote-1' || id === 'loc-shared') return Promise.resolve(sharedLocation)
          return Promise.resolve(null)
        })

        mockLocationDomainService.create.mockResolvedValueOnce({ id: 'loc-unused-try1' })

        const delivery1 = testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER, { dropoffLocationId: 'loc-initial' })
        const delivery2 = testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER, { dropoffLocationId: 'loc-target' })

        // Read 1: loc-initial (pointMoved is true)
        // Read 2: loc-target (concurrent edit already updated dropoff to targetLat, targetLon; pointMoved is false)
        // Read 3: post-write read
        mockDeliveryDomainService.getByIdOrThrow
          .mockResolvedValueOnce(delivery1)
          .mockResolvedValueOnce(delivery2)
          .mockResolvedValueOnce({ ...delivery2, pickupNotes: 'Updated notes' })

        // Write 1 loses
        // Write 2 succeeds
        mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

        const input = updateInput({
          dropoffLatitude: targetLat,
          dropoffLongitude: targetLon,
          notes: 'Updated notes',
        })

        const result = await service.update('del-166', partnerId, input)

        // Create was called on try 1
        expect(mockLocationDomainService.create).toHaveBeenCalledTimes(1)
        // On try 2 pointMoved was false, so madePoint.used remained false, causing finally to delete loc-unused-try1
        expect(mockLocationDomainService.deleteIfUnused).toHaveBeenCalledTimes(1)
        expect(mockLocationDomainService.deleteIfUnused).toHaveBeenCalledWith('loc-unused-try1')
        // Landed write kept loc-target
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenNthCalledWith(
          2,
          'del-166',
          expect.anything(),
          expect.objectContaining({ dropoffLocationId: 'loc-target' })
        )
        expect(result.dropoffLocationId).toBe('loc-target')
      })
    })

    describe('clause 6: failed delete is logged and never changes the answer', () => {
      it('logs a warning and still returns saved delivery when removeUnusedPoint fails during landed edit', async () => {
        const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {})

        const locA = { ...sharedLocation, id: 'loc-A', latitude: 39.3621, longitude: 22.9425 }
        const locB = { ...sharedLocation, id: 'loc-B', latitude: 39.363, longitude: 22.943 }

        mockLocationDomainService.getById = jest.fn((id: string) => {
          if (id === 'loc-A') return Promise.resolve(locA)
          if (id === 'loc-B') return Promise.resolve(locB)
          return Promise.resolve(sharedLocation)
        })

        mockLocationDomainService.create
          .mockResolvedValueOnce({ id: 'loc-copy-A' })
          .mockResolvedValueOnce({ id: 'loc-copy-B' })

        // Deleting loc-copy-A fails with an unexpected error
        mockLocationDomainService.deleteIfUnused.mockRejectedValueOnce(new Error('Database disk error'))

        const deliveryA = testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER, { dropoffLocationId: 'loc-A' })
        const deliveryB = testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER, { dropoffLocationId: 'loc-B' })

        mockDeliveryDomainService.getByIdOrThrow
          .mockResolvedValueOnce(deliveryA)
          .mockResolvedValueOnce(deliveryB)
          .mockResolvedValueOnce({ ...deliveryB, dropoffLocationId: 'loc-copy-B' })

        mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

        const result = await service.update('del-166', partnerId, newPointInput)

        // Warning was logged
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Could not remove the unused drop off point loc-copy-A')
        )
        // Saved delivery is still returned!
        expect(result).toBeDefined()
        expect(result.dropoffLocationId).toBe('loc-copy-B')

        warnSpy.mockRestore()
      })

      it('logs a warning and still throws the refusal when removeUnusedPoint fails in finally', async () => {
        const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {})

        mockDeliveryDomainService.getByIdOrThrow
          .mockResolvedValueOnce(testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER))
          .mockResolvedValueOnce(testDelivery(EnumDeliveryStatus.ACCEPTED))

        mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(false)
        mockLocationDomainService.deleteIfUnused.mockRejectedValueOnce(new Error('Connection failure'))

        await expect(service.update('del-166', partnerId, newPointInput)).rejects.toThrow(
          new ConflictException(PARTNER_EDIT_SENTENCES.pointHeld)
        )

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Could not remove the unused drop off point loc-new-1')
        )

        warnSpy.mockRestore()
      })

      it('logs that row is in use and still returns saved delivery when deleteIfUnused answers false during landed edit', async () => {
        const logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => {})

        const locA = { ...sharedLocation, id: 'loc-A', latitude: 39.3621, longitude: 22.9425 }
        const locB = { ...sharedLocation, id: 'loc-B', latitude: 39.363, longitude: 22.943 }

        mockLocationDomainService.getById = jest.fn((id: string) => {
          if (id === 'loc-A') return Promise.resolve(locA)
          if (id === 'loc-B') return Promise.resolve(locB)
          return Promise.resolve(sharedLocation)
        })

        mockLocationDomainService.create
          .mockResolvedValueOnce({ id: 'loc-copy-A' })
          .mockResolvedValueOnce({ id: 'loc-copy-B' })

        // deleteIfUnused answers false: loc-copy-A is in use by another record
        mockLocationDomainService.deleteIfUnused.mockResolvedValueOnce(false)

        const deliveryA = testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER, { dropoffLocationId: 'loc-A' })
        const deliveryB = testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER, { dropoffLocationId: 'loc-B' })

        mockDeliveryDomainService.getByIdOrThrow
          .mockResolvedValueOnce(deliveryA)
          .mockResolvedValueOnce(deliveryB)
          .mockResolvedValueOnce({ ...deliveryB, dropoffLocationId: 'loc-copy-B' })

        mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

        const result = await service.update('del-166', partnerId, newPointInput)

        // In use log line was written
        expect(logSpy).toHaveBeenCalledWith('Drop off point loc-copy-A is in use by another record, so it stays')
        // Saved delivery is still returned!
        expect(result).toBeDefined()
        expect(result.dropoffLocationId).toBe('loc-copy-B')

        logSpy.mockRestore()
      })

      it('logs that row is in use and still throws refusal when deleteIfUnused answers false in finally', async () => {
        const logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => {})

        mockDeliveryDomainService.getByIdOrThrow
          .mockResolvedValueOnce(testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER))
          .mockResolvedValueOnce(testDelivery(EnumDeliveryStatus.ACCEPTED))

        mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(false)
        // deleteIfUnused answers false: loc-new-1 is in use
        mockLocationDomainService.deleteIfUnused.mockResolvedValueOnce(false)

        await expect(service.update('del-166', partnerId, newPointInput)).rejects.toThrow(
          new ConflictException(PARTNER_EDIT_SENTENCES.pointHeld)
        )

        // In use log line was written
        expect(logSpy).toHaveBeenCalledWith('Drop off point loc-new-1 is in use by another record, so it stays')

        logSpy.mockRestore()
      })
    })

    describe('clause 7: edit with no race behaves as today', () => {
      it('calls create once, never calls delete, and lands on attempt 1 when there is no race', async () => {
        const delivery = testDelivery(EnumDeliveryStatus.ASSIGNING_COURIER)
        mockDeliveryDomainService.getByIdOrThrow
          .mockResolvedValueOnce(delivery)
          .mockResolvedValueOnce({ ...delivery, dropoffLocationId: 'loc-new-1' })

        mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(true)

        const result = await service.update('del-166', partnerId, newPointInput)

        // Created exactly once
        expect(mockLocationDomainService.create).toHaveBeenCalledTimes(1)
        // Never deleted
        expect(mockLocationDomainService.deleteIfUnused).not.toHaveBeenCalled()
        // Single write landed
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledWith(
          'del-166',
          expect.anything(),
          expect.objectContaining({ dropoffLocationId: 'loc-new-1' })
        )
        expect(result.dropoffLocationId).toBe('loc-new-1')
      })
    })
  })

  describe('Row 167: a box size change lands only with the edit it belongs to', () => {
    const row167Delivery = (opts?: {
      status?: EnumDeliveryStatus
      matchedCourierId?: string | null
      courierId?: string | null
      boxSize?: BoxSize
      boxUnits?: number
    }) => ({
      id: 'del-167',
      partnerId,
      status: opts?.status ?? EnumDeliveryStatus.ASSIGNING_COURIER,
      createdAt: new Date(),
      dropoffLocationId: 'loc-shared',
      deliveryQuoteId: 'quote-1',
      tips: 150,
      currencyCode: 'EUR',
      orderReference: 'ORD-167',
      matchedCourierId: opts?.matchedCourierId !== undefined ? opts.matchedCourierId : null,
      courierId: opts?.courierId !== undefined ? opts.courierId : null,
      boxSize: opts?.boxSize ?? BoxSize.SMALL,
      boxUnits: opts?.boxUnits ?? 30,
      boxSizeAssumed: false,
    })

    describe('clause 1: an edit refused after a lost write leaves the size and its events as they were', () => {
      it('refuses with BOX_SIZE_LOCKED when updateIfMatches loses and next try sees a rider offered/holding: records no event and attempts no write other than the conditional one', async () => {
        const initial = row167Delivery({ boxSize: BoxSize.SMALL })
        const offeredOnRetry = row167Delivery({
          boxSize: BoxSize.SMALL,
          matchedCourierId: 'courier-offered',
        })

        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(offeredOnRetry)

        // Try 1 loses write race
        mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(false)

        await expect(
          service.update('del-167', partnerId, { boxSize: BoxSize.LARGE, pickupNotes: 'Updated' } as any)
        ).rejects.toThrow(new ConflictException(BOX_SIZE_LOCKED_MESSAGE))

        // No BOX_SIZE_CHANGED event recorded
        expect(mockDeliveryDomainService.recordBoxSizeChanged).not.toHaveBeenCalled()
        expect(mockDeliveryEventService.recordBoxEvent).not.toHaveBeenCalled()

        // No write other than the one conditional attempt was made
        expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
      })

      it('refuses with ended sentence when updateIfMatches loses and next try sees order ended: records no event and attempts no other write with the size', async () => {
        const initial = row167Delivery({ boxSize: BoxSize.SMALL })
        const endedOnRetry = row167Delivery({
          boxSize: BoxSize.SMALL,
          status: EnumDeliveryStatus.CANCELED,
        })

        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(endedOnRetry)

        // Try 1 loses write race
        mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(false)

        await expect(service.update('del-167', partnerId, { boxSize: BoxSize.LARGE } as any)).rejects.toThrow(
          new ConflictException(PARTNER_EDIT_SENTENCES.ended)
        )

        // No BOX_SIZE_CHANGED event recorded
        expect(mockDeliveryDomainService.recordBoxSizeChanged).not.toHaveBeenCalled()
        expect(mockDeliveryEventService.recordBoxEvent).not.toHaveBeenCalled()

        // No other write
        expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
      })
    })

    describe('clause 2: an edit that lands changes the size once with one BOX_SIZE_CHANGED', () => {
      it('includes size fields in same updateIfMatches data as edit, adds matchedCourierId null, courierId null and boxSize to where, and records event once after write landed', async () => {
        const initial = row167Delivery({
          boxSize: BoxSize.SMALL,
          boxUnits: 30,
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
        })
        const saved = {
          ...initial,
          boxSize: BoxSize.LARGE,
          boxUnits: 100,
          boxSizeAssumed: false,
          pickupNotes: 'New notes',
        }

        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(saved)

        mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(true)

        const result = await service.update('del-167', partnerId, {
          boxSize: BoxSize.LARGE,
          pickupNotes: 'New notes',
        } as any)

        // updateIfMatches where adds matchedCourierId null, courierId null and old boxSize
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledWith(
          'del-167',
          expect.objectContaining({
            status: EnumDeliveryStatus.ASSIGNING_COURIER,
            tips: 150,
            dropoffLocationId: 'loc-shared',
            matchedCourierId: null,
            courierId: null,
            boxSize: BoxSize.SMALL,
          }),
          expect.objectContaining({
            boxSize: BoxSize.LARGE,
            boxUnits: 100,
            boxSizeAssumed: false,
            pickupNotes: 'New notes',
          })
        )

        // recordBoxSizeChanged runs once, after the write landed, with old delivery and change
        expect(mockDeliveryDomainService.recordBoxSizeChanged).toHaveBeenCalledTimes(1)
        expect(mockDeliveryDomainService.recordBoxSizeChanged).toHaveBeenCalledWith(
          initial,
          expect.objectContaining({
            where: { matchedCourierId: null, courierId: null, boxSize: BoxSize.SMALL },
            data: { boxSize: BoxSize.LARGE, boxUnits: 100, boxSizeAssumed: false },
          })
        )

        expect(result.boxSize).toBe(BoxSize.LARGE)
        expect(result.pickupNotes).toBe('New notes')
      })

      it('records BOX_SIZE_CHANGED once after write lands on retry when try 1 loses race', async () => {
        const initial = row167Delivery({ boxSize: BoxSize.SMALL, boxUnits: 30 })
        const saved = { ...initial, boxSize: BoxSize.LARGE, boxUnits: 100, boxSizeAssumed: false }

        mockDeliveryDomainService.getByIdOrThrow
          .mockResolvedValueOnce(initial)
          .mockResolvedValueOnce(initial)
          .mockResolvedValueOnce(saved)

        mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

        const result = await service.update('del-167', partnerId, { boxSize: BoxSize.LARGE } as any)

        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(2)
        expect(mockDeliveryDomainService.recordBoxSizeChanged).toHaveBeenCalledTimes(1)
        expect(result.boxSize).toBe(BoxSize.LARGE)
      })

      it('a retry whose fresh read already shows the asked for size lands with no size fields in where or data and no BOX_SIZE_CHANGED', async () => {
        // Read 1: delivery with BoxSize.SMALL (30 units)
        const try1Delivery = row167Delivery({ boxSize: BoxSize.SMALL, boxUnits: 30 })
        // Read 2: another edit in between changed size to BoxSize.LARGE (100 units)
        const try2Delivery = row167Delivery({ boxSize: BoxSize.LARGE, boxUnits: 100 })
        const saved = { ...try2Delivery, pickupNotes: 'Updated notes' }

        mockDeliveryDomainService.getByIdOrThrow
          .mockResolvedValueOnce(try1Delivery)
          .mockResolvedValueOnce(try2Delivery)
          .mockResolvedValueOnce(saved)

        // Try 1 loses write race; Try 2 lands
        mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

        const result = await service.update('del-167', partnerId, {
          boxSize: BoxSize.LARGE,
          pickupNotes: 'Updated notes',
        } as any)

        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(2)

        // Try 1 had the size change fields in where and data
        const [, try1Where, try1Data] = mockDeliveryDomainService.updateIfMatches.mock.calls[0]
        expect(try1Where.boxSize).toBe(BoxSize.SMALL)
        expect(try1Where.matchedCourierId).toBeNull()
        expect(try1Where.courierId).toBeNull()
        expect(try1Data.boxSize).toBe(BoxSize.LARGE)
        expect(try1Data.boxUnits).toBe(100)
        expect(try1Data.boxSizeAssumed).toBe(false)

        // Try 2 landed with NO size fields in where or data (courierId remains the rider as read)
        const [, try2Where, try2Data] = mockDeliveryDomainService.updateIfMatches.mock.calls[1]
        expect(try2Where.boxSize).toBeUndefined()
        expect(try2Where.matchedCourierId).toBeUndefined()
        expect(try2Where.courierId).toBeNull()
        expect(try2Data.boxSize).toBeUndefined()
        expect(try2Data.boxUnits).toBeUndefined()
        expect(try2Data.boxSizeAssumed).toBeUndefined()
        expect(try2Data.pickupNotes).toBe('Updated notes')

        // boxSizeChangeFor was called only on try 1 (try 2 already had asked size)
        expect(mockDeliveryDomainService.boxSizeChangeFor).toHaveBeenCalledTimes(1)
        expect(mockDeliveryDomainService.boxSizeChangeFor).toHaveBeenCalledWith(try1Delivery, BoxSize.LARGE)

        // No BOX_SIZE_CHANGED event recorded because size did not change on the landed try
        expect(mockDeliveryDomainService.recordBoxSizeChanged).not.toHaveBeenCalled()

        expect(result.boxSize).toBe(BoxSize.LARGE)
        expect(result.pickupNotes).toBe('Updated notes')
      })

      it('on a retry, the event old size and units come from the second read (the try that landed), not the first', async () => {
        // Read 1: delivery with BoxSize.SMALL (30 units)
        const try1Delivery = row167Delivery({ boxSize: BoxSize.SMALL, boxUnits: 30 })
        // Read 2: between tries, another edit changed size to BoxSize.MEDIUM (50 units)
        const try2Delivery = row167Delivery({ boxSize: BoxSize.MEDIUM, boxUnits: 50 })
        const saved = { ...try2Delivery, boxSize: BoxSize.LARGE, boxUnits: 100, boxSizeAssumed: false }

        mockDeliveryDomainService.getByIdOrThrow
          .mockResolvedValueOnce(try1Delivery)
          .mockResolvedValueOnce(try2Delivery)
          .mockResolvedValueOnce(saved)

        // Try 1 loses race; Try 2 lands
        mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

        const result = await service.update('del-167', partnerId, {
          boxSize: BoxSize.LARGE,
        } as any)

        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(2)

        // Try 2 write where and data used the second read's values
        const [, try2Where, try2Data] = mockDeliveryDomainService.updateIfMatches.mock.calls[1]
        expect(try2Where.boxSize).toBe(BoxSize.MEDIUM)
        expect(try2Where.matchedCourierId).toBeNull()
        expect(try2Where.courierId).toBeNull()
        expect(try2Data.boxSize).toBe(BoxSize.LARGE)
        expect(try2Data.boxUnits).toBe(100)

        // Event recorded exactly once
        expect(mockDeliveryDomainService.recordBoxSizeChanged).toHaveBeenCalledTimes(1)
        // Pinned: the event receives the second read's delivery (MEDIUM, 50 units), NOT the first (SMALL, 30 units)
        expect(mockDeliveryDomainService.recordBoxSizeChanged).toHaveBeenCalledWith(
          try2Delivery,
          expect.objectContaining({
            where: { matchedCourierId: null, courierId: null, boxSize: BoxSize.MEDIUM },
            data: { boxSize: BoxSize.LARGE, boxUnits: 100, boxSizeAssumed: false },
          })
        )
        expect(mockDeliveryDomainService.recordBoxSizeChanged).not.toHaveBeenCalledWith(try1Delivery, expect.anything())

        expect(result.boxSize).toBe(BoxSize.LARGE)
      })
    })

    describe('clause 3: a size change alone behaves as today', () => {
      it('refuses with BOX_SIZE_LOCKED when rider is offered (matchedCourierId set), answered before anything is made (no Location created, no write)', async () => {
        const offered = row167Delivery({ matchedCourierId: 'courier-1', boxSize: BoxSize.SMALL })
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(offered)

        // Point move included: verifies that refusal happens before Location is created
        await expect(
          service.update('del-167', partnerId, {
            boxSize: BoxSize.LARGE,
            dropoffLatitude: 39.37,
            dropoffLongitude: 22.95,
          } as any)
        ).rejects.toThrow(new ConflictException(BOX_SIZE_LOCKED_MESSAGE))

        // Answered before anything is made: no Location created, no write
        expect(mockLocationDomainService.create).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.updateIfMatches).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.recordBoxSizeChanged).not.toHaveBeenCalled()
      })

      it('refuses with BOX_SIZE_LOCKED for a size change alone when rider is offered (matchedCourierId set), writing nothing', async () => {
        const offered = row167Delivery({ matchedCourierId: 'courier-1', boxSize: BoxSize.SMALL })
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(offered)

        await expect(
          service.update('del-167', partnerId, {
            boxSize: BoxSize.LARGE,
          } as any)
        ).rejects.toThrow(new ConflictException(BOX_SIZE_LOCKED_MESSAGE))

        expect(mockLocationDomainService.create).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.updateIfMatches).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.recordBoxSizeChanged).not.toHaveBeenCalled()
      })

      it('refuses with BOX_SIZE_LOCKED for a size change alone when rider holds order (courierId set), answered before anything is made (no Location created, no write)', async () => {
        const held = row167Delivery({
          courierId: 'courier-1',
          status: EnumDeliveryStatus.ACCEPTED,
          boxSize: BoxSize.SMALL,
        })
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(held)

        // Size change alone on held order (notes allowed, but size change refused)
        await expect(
          service.update('del-167', partnerId, {
            boxSize: BoxSize.LARGE,
            pickupNotes: 'Notes allowed on held order',
          } as any)
        ).rejects.toThrow(new ConflictException(BOX_SIZE_LOCKED_MESSAGE))

        expect(mockLocationDomainService.create).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.updateIfMatches).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.recordBoxSizeChanged).not.toHaveBeenCalled()
      })

      it('the same size adds nothing to where or data and calls no boxSizeChangeFor', async () => {
        const initial = row167Delivery({ boxSize: BoxSize.MEDIUM })
        mockDeliveryDomainService.getByIdOrThrow
          .mockResolvedValueOnce(initial)
          .mockResolvedValueOnce({ ...initial, pickupNotes: 'Same size' })
        mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(true)

        await service.update('del-167', partnerId, {
          boxSize: BoxSize.MEDIUM,
          pickupNotes: 'Same size',
        } as any)

        expect(mockDeliveryDomainService.boxSizeChangeFor).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.recordBoxSizeChanged).not.toHaveBeenCalled()

        const [, where, data] = mockDeliveryDomainService.updateIfMatches.mock.calls[0]
        expect(where.matchedCourierId).toBeUndefined()
        expect(where.courierId).toBeNull()
        expect(where.boxSize).toBeUndefined()
        expect(data.boxSize).toBeUndefined()
        expect(data.boxUnits).toBeUndefined()
        expect(data.boxSizeAssumed).toBeUndefined()
      })

      it('no boxSize (undefined) adds nothing to where or data and calls no boxSizeChangeFor', async () => {
        const initial = row167Delivery({ boxSize: BoxSize.MEDIUM })
        mockDeliveryDomainService.getByIdOrThrow
          .mockResolvedValueOnce(initial)
          .mockResolvedValueOnce({ ...initial, pickupNotes: 'No size' })
        mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(true)

        await service.update('del-167', partnerId, { pickupNotes: 'No size' } as any)

        expect(mockDeliveryDomainService.boxSizeChangeFor).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.recordBoxSizeChanged).not.toHaveBeenCalled()

        const [, where, data] = mockDeliveryDomainService.updateIfMatches.mock.calls[0]
        expect(where.matchedCourierId).toBeUndefined()
        expect(where.courierId).toBeNull()
        expect(where.boxSize).toBeUndefined()
        expect(data.boxSize).toBeUndefined()
        expect(data.boxUnits).toBeUndefined()
      })

      it('JSON null boxSize adds nothing to where or data and calls no boxSizeChangeFor', async () => {
        const initial = row167Delivery({ boxSize: BoxSize.MEDIUM })
        mockDeliveryDomainService.getByIdOrThrow
          .mockResolvedValueOnce(initial)
          .mockResolvedValueOnce({ ...initial, pickupNotes: 'Null size' })
        mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(true)

        await service.update('del-167', partnerId, { boxSize: null, pickupNotes: 'Null size' } as any)

        expect(mockDeliveryDomainService.boxSizeChangeFor).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.recordBoxSizeChanged).not.toHaveBeenCalled()

        const [, where, data] = mockDeliveryDomainService.updateIfMatches.mock.calls[0]
        expect(where.matchedCourierId).toBeUndefined()
        expect(where.courierId).toBeNull()
        expect(where.boxSize).toBeUndefined()
        expect(data.boxSize).toBeUndefined()
        expect(data.boxUnits).toBeUndefined()
      })
    })

    describe('clause 4: size is written only when edit is known to land', () => {
      it('fails if size or event is written before updateIfMatches lands: calls recordBoxSizeChanged strictly after landed write', async () => {
        const initial = row167Delivery({ boxSize: BoxSize.SMALL, boxUnits: 30 })
        const saved = { ...initial, boxSize: BoxSize.LARGE, boxUnits: 100, boxSizeAssumed: false }

        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(saved)

        const callSequence: string[] = []
        mockDeliveryDomainService.updateIfMatches.mockImplementation(async () => {
          callSequence.push('updateIfMatches')
          // Verify event has not been recorded before write completes
          expect(mockDeliveryDomainService.recordBoxSizeChanged).not.toHaveBeenCalled()
          return true
        })
        mockDeliveryDomainService.recordBoxSizeChanged.mockImplementation(async () => {
          callSequence.push('recordBoxSizeChanged')
        })

        await service.update('del-167', partnerId, { boxSize: BoxSize.LARGE } as any)

        // updateIfMatches ran first, recordBoxSizeChanged ran strictly after
        expect(callSequence).toEqual(['updateIfMatches', 'recordBoxSizeChanged'])
      })

      it('does not write size or record event when updateIfMatches throws an error', async () => {
        const initial = row167Delivery({ boxSize: BoxSize.SMALL, boxUnits: 30 })
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial)

        mockDeliveryDomainService.updateIfMatches.mockRejectedValueOnce(new Error('DB failure'))

        await expect(service.update('del-167', partnerId, { boxSize: BoxSize.LARGE } as any)).rejects.toThrow(
          'DB failure'
        )

        expect(mockDeliveryDomainService.recordBoxSizeChanged).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
      })
    })
  })

  // Row 164: the rider sees a restaurant's edit to a held order
  describe("Row 164: the rider sees a restaurant's edit to a held order", () => {
    const sharedDropoffLocation = {
      id: 'loc-shared',
      formattedAddress: 'Iasonos 12, Volos 38221, Greece',
      latitude: 39.3621,
      longitude: 22.9425,
    }

    const row164Delivery = (opts?: Record<string, unknown>) => ({
      id: 'del-164',
      partnerId,
      pickupBusinessName: 'Nosh Tavern',
      status: (opts?.status as EnumDeliveryStatus) ?? EnumDeliveryStatus.DISPATCHED,
      createdAt: new Date(),
      dropoffLocationId: 'loc-shared',
      deliveryQuoteId: 'quote-1',
      tips: 150,
      currencyCode: 'EUR',
      orderReference: 'ORD-164',
      matchedCourierId: null,
      courierId: (opts?.courierId as string | null) !== undefined ? (opts?.courierId as string | null) : 'courier-1',
      pickupNotes:
        (opts?.pickupNotes as string | null) !== undefined ? (opts?.pickupNotes as string | null) : 'Old pickup notes',
      dropoffNotes:
        (opts?.dropoffNotes as string | null) !== undefined
          ? (opts?.dropoffNotes as string | null)
          : 'Old dropoff notes',
      pickupReadyAt:
        (opts?.pickupReadyAt as Date | null) !== undefined
          ? (opts?.pickupReadyAt as Date | null)
          : new Date('2026-11-25T12:00:00.000Z'),
      pickupDeadlineAt:
        (opts?.pickupDeadlineAt as Date | null) !== undefined
          ? (opts?.pickupDeadlineAt as Date | null)
          : new Date('2026-11-25T12:30:00.000Z'),
      dropoffReadyAt:
        (opts?.dropoffReadyAt as Date | null) !== undefined
          ? (opts?.dropoffReadyAt as Date | null)
          : new Date('2026-11-25T12:35:00.000Z'),
      dropoffDeadlineAt:
        (opts?.dropoffDeadlineAt as Date | null) !== undefined
          ? (opts?.dropoffDeadlineAt as Date | null)
          : new Date('2026-11-25T13:00:00.000Z'),
      boxSize: BoxSize.SMALL,
      boxUnits: 30,
      boxSizeAssumed: false,
    })

    const updateInput = (overrides: Record<string, unknown> = {}) => ({
      dropoffLatitude: 39.3621,
      dropoffLongitude: 22.9425,
      ...overrides,
    })

    beforeEach(() => {
      mockDeliveryQuoteDomainService.getByIdOrThrow.mockResolvedValue({
        id: 'quote-1',
        pickupLocationId: 'loc-pickup',
        dropoffLocationId: 'loc-shared',
      })
      mockLocationDomainService.getById = jest.fn().mockResolvedValue(sharedDropoffLocation)
      mockDeliveryDomainService.updateIfMatches = jest.fn().mockResolvedValue(true)
      mockDeliveryEventService.notifyJobEdited = jest.fn().mockResolvedValue(undefined)
    })

    describe("clause 1: partner edit that lands and changes held order's notes or times calls notifyJobEdited at once", () => {
      it('calls notifyJobEdited with NOTES when pickup notes change', async () => {
        const initial = row164Delivery({ pickupNotes: 'Old pickup notes' })
        const saved = { ...initial, pickupNotes: 'New pickup notes' }

        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(saved)

        await service.update('del-164', partnerId, updateInput({ pickupNotes: 'New pickup notes' }) as any)

        expect(mockDeliveryEventService.notifyJobEdited).toHaveBeenCalledTimes(1)
        expect(mockDeliveryEventService.notifyJobEdited).toHaveBeenCalledWith(initial, ['NOTES'])
      })

      it('calls notifyJobEdited with NOTES when dropoff notes change', async () => {
        const initial = row164Delivery({ dropoffNotes: 'Old dropoff notes' })
        const saved = { ...initial, dropoffNotes: 'New dropoff notes' }

        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(saved)

        await service.update('del-164', partnerId, updateInput({ dropoffNotes: 'New dropoff notes' }) as any)

        expect(mockDeliveryEventService.notifyJobEdited).toHaveBeenCalledTimes(1)
        expect(mockDeliveryEventService.notifyJobEdited).toHaveBeenCalledWith(initial, ['NOTES'])
      })

      it('calls notifyJobEdited with TIMES when any window time changes', async () => {
        const initial = row164Delivery()
        const newTime = new Date('2026-11-25T12:45:00.000Z')
        const saved = { ...initial, pickupDeadlineAt: newTime }

        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(saved)

        await service.update('del-164', partnerId, updateInput({ pickupDeadlineAt: newTime }) as any)

        expect(mockDeliveryEventService.notifyJobEdited).toHaveBeenCalledTimes(1)
        expect(mockDeliveryEventService.notifyJobEdited).toHaveBeenCalledWith(initial, ['TIMES'])
      })

      it('calls notifyJobEdited with NOTES and TIMES in order when both notes and times change', async () => {
        const initial = row164Delivery({ pickupNotes: 'Old pickup notes' })
        const newTime = new Date('2026-11-25T12:45:00.000Z')
        const saved = { ...initial, pickupNotes: 'New pickup notes', pickupReadyAt: newTime }

        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(saved)

        await service.update(
          'del-164',
          partnerId,
          updateInput({
            pickupNotes: 'New pickup notes',
            pickupReadyAt: newTime,
          }) as any
        )

        expect(mockDeliveryEventService.notifyJobEdited).toHaveBeenCalledTimes(1)
        expect(mockDeliveryEventService.notifyJobEdited).toHaveBeenCalledWith(initial, ['NOTES', 'TIMES'])
      })
    })

    describe('clause 2: edit before any rider holds the order sends nothing', () => {
      it('calls notifyJobEdited with empty changed list when courierId is null', async () => {
        const initial = row164Delivery({ courierId: null, status: EnumDeliveryStatus.ASSIGNING_COURIER })
        const saved = { ...initial, pickupNotes: 'New pickup notes' }

        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(saved)

        await service.update('del-164', partnerId, updateInput({ pickupNotes: 'New pickup notes' }) as any)

        expect(mockDeliveryEventService.notifyJobEdited).toHaveBeenCalledTimes(1)
        expect(mockDeliveryEventService.notifyJobEdited).toHaveBeenCalledWith(initial, [])
      })

      it('calls notifyJobEdited with empty changed list when notes and times are unchanged', async () => {
        const initial = row164Delivery({ orderReference: 'REF-1' })
        const saved = { ...initial, orderReference: 'REF-2' }

        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(saved)

        await service.update('del-164', partnerId, updateInput({ orderReference: 'REF-2' }) as any)

        expect(mockDeliveryEventService.notifyJobEdited).toHaveBeenCalledTimes(1)
        expect(mockDeliveryEventService.notifyJobEdited).toHaveBeenCalledWith(initial, [])
      })
    })

    describe('clause 3: no read or seen record is kept', () => {
      it('writes no DeliveryEvent and no repository change for the edit message itself', async () => {
        const initial = row164Delivery({ pickupNotes: 'Old' })
        const saved = { ...initial, pickupNotes: 'New' }

        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(saved)

        await service.update('del-164', partnerId, updateInput({ pickupNotes: 'New' }) as any)

        // Only notifyJobEdited is called; no ready/tip/box/dropoff events are recorded
        expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).not.toHaveBeenCalled()
        expect(mockDeliveryEventService.recordTipChangedEvent).not.toHaveBeenCalled()
        expect(mockDeliveryEventService.recordBoxEvent).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.recordBoxSizeChanged).not.toHaveBeenCalled()
      })
    })

    describe('clause 4: lost write sends nothing for that try; only landed write sends once', () => {
      it('calls notifyJobEdited only once when first try loses conditional write and second try lands', async () => {
        const initial = row164Delivery({ pickupNotes: 'Old' })
        const retryDelivery = row164Delivery({ pickupNotes: 'Old' })
        const saved = { ...initial, pickupNotes: 'New' }

        mockDeliveryDomainService.getByIdOrThrow
          .mockResolvedValueOnce(initial)
          .mockResolvedValueOnce(retryDelivery)
          .mockResolvedValueOnce(saved)

        // First attempt loses race (returns false), second attempt lands (returns true)
        mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

        await service.update('del-164', partnerId, updateInput({ pickupNotes: 'New' }) as any)

        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(2)
        expect(mockDeliveryEventService.notifyJobEdited).toHaveBeenCalledTimes(1)
        expect(mockDeliveryEventService.notifyJobEdited).toHaveBeenCalledWith(retryDelivery, ['NOTES'])
      })

      it('never calls notifyJobEdited when all updateIfMatches attempts fail', async () => {
        const initial = row164Delivery({ pickupNotes: 'Old' })

        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue(initial)
        mockDeliveryDomainService.updateIfMatches.mockResolvedValue(false)

        await expect(service.update('del-164', partnerId, updateInput({ pickupNotes: 'New' }) as any)).rejects.toThrow(
          new ConflictException(PARTNER_EDIT_SENTENCES.changed)
        )

        expect(mockDeliveryEventService.notifyJobEdited).not.toHaveBeenCalled()
      })
    })

    describe('clause 5: Minor 1 - courierId matched as read, and reassignment sends notice only to new rider on landed try', () => {
      it('includes courierId matching the courier as read in updateIfMatches where (null when no rider)', async () => {
        // Case A: held delivery has courierId 'courier-1'
        const held = row164Delivery({ courierId: 'courier-1', pickupNotes: 'Old' })
        mockDeliveryDomainService.getByIdOrThrow
          .mockResolvedValueOnce(held)
          .mockResolvedValueOnce({ ...held, pickupNotes: 'New' })
        mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(true)

        await service.update('del-164', partnerId, updateInput({ pickupNotes: 'New' }) as any)

        const [, whereHeld] = mockDeliveryDomainService.updateIfMatches.mock.calls[0]
        expect(whereHeld.courierId).toBe('courier-1')

        // Case B: unheld delivery has courierId null
        const unheld = row164Delivery({ courierId: null, status: EnumDeliveryStatus.ASSIGNING_COURIER })
        mockDeliveryDomainService.getByIdOrThrow
          .mockResolvedValueOnce(unheld)
          .mockResolvedValueOnce({ ...unheld, pickupNotes: 'New' })
        mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(true)

        await service.update('del-164', partnerId, updateInput({ pickupNotes: 'New' }) as any)

        const [, whereUnheld] = mockDeliveryDomainService.updateIfMatches.mock.calls[1]
        expect(whereUnheld.courierId).toBeNull()
      })

      it('reassignment between read and write (updateIfMatches false, fresh read has another courierId) sends JOB_EDITED once to new courier, never old one', async () => {
        const initial = row164Delivery({ courierId: 'courier-old', pickupNotes: 'Old' })
        const reassigned = row164Delivery({ courierId: 'courier-new', pickupNotes: 'Old' })
        const saved = { ...reassigned, pickupNotes: 'New' }

        // Read 1: sees courier-old
        // Read 2: sees courier-new (reassigned and accepted)
        // Read 3: post-write read
        mockDeliveryDomainService.getByIdOrThrow
          .mockResolvedValueOnce(initial)
          .mockResolvedValueOnce(reassigned)
          .mockResolvedValueOnce(saved)

        // Try 1 loses (courier changed in DB, where.courierId: 'courier-old' doesn't match)
        // Try 2 lands (where.courierId: 'courier-new')
        mockDeliveryDomainService.updateIfMatches.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

        await service.update('del-164', partnerId, updateInput({ pickupNotes: 'New' }) as any)

        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(2)

        // Try 1 matched courier-old
        const [, where1] = mockDeliveryDomainService.updateIfMatches.mock.calls[0]
        expect(where1.courierId).toBe('courier-old')

        // Try 2 matched courier-new
        const [, where2] = mockDeliveryDomainService.updateIfMatches.mock.calls[1]
        expect(where2.courierId).toBe('courier-new')

        // Exactly one notification sent: to the new courier, NEVER to the old one
        expect(mockDeliveryEventService.notifyJobEdited).toHaveBeenCalledTimes(1)
        expect(mockDeliveryEventService.notifyJobEdited).toHaveBeenCalledWith(reassigned, ['NOTES'])
        expect(mockDeliveryEventService.notifyJobEdited).not.toHaveBeenCalledWith(initial, expect.anything())
      })
    })

    describe('clause 6: refused edits (ended order, moved point on held order) send nothing', () => {
      it('sends nothing when edit is refused on an ended order', async () => {
        const ended = row164Delivery({ status: EnumDeliveryStatus.DROPPED_OFF })
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue(ended)

        await expect(service.update('del-164', partnerId, updateInput({ pickupNotes: 'New' }) as any)).rejects.toThrow(
          new ConflictException(PARTNER_EDIT_SENTENCES.ended)
        )

        expect(mockDeliveryEventService.notifyJobEdited).not.toHaveBeenCalled()
      })

      it('sends nothing when point move is refused on a held order', async () => {
        const held = row164Delivery({ status: EnumDeliveryStatus.ACCEPTED, courierId: 'courier-1' })
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue(held)

        await expect(
          service.update(
            'del-164',
            partnerId,
            updateInput({
              pickupNotes: 'New',
              dropoffLatitude: 39.364,
              dropoffLongitude: 22.944,
            }) as any
          )
        ).rejects.toThrow(new ConflictException(PARTNER_EDIT_SENTENCES.pointHeld))

        expect(mockDeliveryEventService.notifyJobEdited).not.toHaveBeenCalled()
      })
    })
  })

  // Row 168: time updates in partner edit (decision 168.2)
  // Left out (undefined) keeps the stored time; null clears it. Empty string was refused by input pipe.
  describe('Row 168: time updates in partner edit (decision 168.2)', () => {
    const TIME_FIELDS = ['pickupReadyAt', 'pickupDeadlineAt', 'dropoffReadyAt', 'dropoffDeadlineAt'] as const

    const sharedDropoffLocation = {
      id: 'loc-shared',
      formattedAddress: 'Iasonos 12, Volos 38221, Greece',
      latitude: 39.3621,
      longitude: 22.9425,
    }

    const row168Delivery = (opts?: Record<string, unknown>) => ({
      id: 'del-168',
      partnerId,
      pickupBusinessName: 'Nosh Tavern',
      status: (opts?.status as EnumDeliveryStatus) ?? EnumDeliveryStatus.DISPATCHED,
      createdAt: new Date(),
      dropoffLocationId: 'loc-shared',
      deliveryQuoteId: 'quote-1',
      tips: 150,
      currencyCode: 'EUR',
      orderReference: 'ORD-168',
      matchedCourierId: null,
      courierId: (opts?.courierId as string | null) !== undefined ? (opts?.courierId as string | null) : 'courier-1',
      pickupNotes:
        (opts?.pickupNotes as string | null) !== undefined ? (opts?.pickupNotes as string | null) : 'Old pickup notes',
      dropoffNotes:
        (opts?.dropoffNotes as string | null) !== undefined
          ? (opts?.dropoffNotes as string | null)
          : 'Old dropoff notes',
      pickupReadyAt:
        (opts?.pickupReadyAt as Date | null) !== undefined
          ? (opts?.pickupReadyAt as Date | null)
          : new Date('2026-11-25T12:00:00.000Z'),
      pickupDeadlineAt:
        (opts?.pickupDeadlineAt as Date | null) !== undefined
          ? (opts?.pickupDeadlineAt as Date | null)
          : new Date('2026-11-25T12:30:00.000Z'),
      dropoffReadyAt:
        (opts?.dropoffReadyAt as Date | null) !== undefined
          ? (opts?.dropoffReadyAt as Date | null)
          : new Date('2026-11-25T12:35:00.000Z'),
      dropoffDeadlineAt:
        (opts?.dropoffDeadlineAt as Date | null) !== undefined
          ? (opts?.dropoffDeadlineAt as Date | null)
          : new Date('2026-11-25T13:00:00.000Z'),
      boxSize: BoxSize.SMALL,
      boxUnits: 30,
      boxSizeAssumed: false,
    })

    const updateInput = (overrides: Record<string, unknown> = {}) => ({
      dropoffLatitude: 39.3621,
      dropoffLongitude: 22.9425,
      ...overrides,
    })

    beforeEach(() => {
      mockDeliveryQuoteDomainService.getByIdOrThrow.mockResolvedValue({
        id: 'quote-1',
        pickupLocationId: 'loc-pickup',
        dropoffLocationId: 'loc-shared',
      })
      mockLocationDomainService.getById = jest.fn().mockResolvedValue(sharedDropoffLocation)
      mockDeliveryDomainService.updateIfMatches = jest.fn().mockResolvedValue(true)
      mockDeliveryEventService.notifyJobEdited = jest.fn().mockResolvedValue(undefined)
    })

    describe('null time reaches the conditional write data as null', () => {
      it.each(TIME_FIELDS)('a null time for %s reaches the conditional write data as null', async (field) => {
        const initial = row168Delivery()
        mockDeliveryDomainService.getByIdOrThrow
          .mockResolvedValueOnce(initial)
          .mockResolvedValueOnce({ ...initial, [field]: null })

        await service.update('del-168', partnerId, updateInput({ [field]: null }) as any)

        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
        const [, , data] = mockDeliveryDomainService.updateIfMatches.mock.calls[0]
        expect(data[field]).toBeNull()
      })

      it('setting all four times to null reaches the conditional write data as null for all four', async () => {
        const initial = row168Delivery()
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce({
          ...initial,
          pickupReadyAt: null,
          pickupDeadlineAt: null,
          dropoffReadyAt: null,
          dropoffDeadlineAt: null,
        })

        await service.update(
          'del-168',
          partnerId,
          updateInput({
            pickupReadyAt: null,
            pickupDeadlineAt: null,
            dropoffReadyAt: null,
            dropoffDeadlineAt: null,
          }) as any
        )

        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
        const [, , data] = mockDeliveryDomainService.updateIfMatches.mock.calls[0]
        expect(data.pickupReadyAt).toBeNull()
        expect(data.pickupDeadlineAt).toBeNull()
        expect(data.dropoffReadyAt).toBeNull()
        expect(data.dropoffDeadlineAt).toBeNull()
      })
    })

    describe('a time left out of the input is absent (undefined) from conditional write data', () => {
      it.each(TIME_FIELDS)(
        'a time left out of the input (%s) is absent (undefined) from data so Prisma keeps it',
        async (field) => {
          const initial = row168Delivery()
          mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(initial)

          const input = updateInput({ pickupNotes: 'Updated notes' })
          delete (input as any)[field]

          await service.update('del-168', partnerId, input as any)

          expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
          const [, , data] = mockDeliveryDomainService.updateIfMatches.mock.calls[0]
          expect(data[field]).toBeUndefined()
        }
      )

      it('all four times left out of input are absent (undefined) from conditional write data', async () => {
        const initial = row168Delivery()
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(initial)

        const input = updateInput({ pickupNotes: 'Updated notes' })
        for (const field of TIME_FIELDS) {
          delete (input as any)[field]
        }

        await service.update('del-168', partnerId, input as any)

        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
        const [, , data] = mockDeliveryDomainService.updateIfMatches.mock.calls[0]
        expect(data.pickupReadyAt).toBeUndefined()
        expect(data.pickupDeadlineAt).toBeUndefined()
        expect(data.dropoffReadyAt).toBeUndefined()
        expect(data.dropoffDeadlineAt).toBeUndefined()
      })
    })

    describe('riderVisibleEdits in notifyJobEdited for left out vs null times', () => {
      it('reports no TIMES when times are left out of the input (stored times kept)', async () => {
        const initial = row168Delivery({
          pickupReadyAt: new Date('2026-11-25T12:00:00.000Z'),
          pickupDeadlineAt: new Date('2026-11-25T12:30:00.000Z'),
          dropoffReadyAt: new Date('2026-11-25T12:35:00.000Z'),
          dropoffDeadlineAt: new Date('2026-11-25T13:00:00.000Z'),
          pickupNotes: 'Old notes',
        })
        const saved = { ...initial, pickupNotes: 'New notes' }

        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(saved)

        // Times left out of the input; only notes updated
        await service.update('del-168', partnerId, updateInput({ pickupNotes: 'New notes' }) as any)

        expect(mockDeliveryEventService.notifyJobEdited).toHaveBeenCalledTimes(1)
        expect(mockDeliveryEventService.notifyJobEdited).toHaveBeenCalledWith(initial, ['NOTES'])
        const [, changed] = mockDeliveryEventService.notifyJobEdited.mock.calls[0]
        expect(changed).not.toContain('TIMES')
      })

      it('reports no TIMES when all fields are unchanged and times are left out of input', async () => {
        const initial = row168Delivery()
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(initial)

        await service.update('del-168', partnerId, updateInput() as any)

        expect(mockDeliveryEventService.notifyJobEdited).toHaveBeenCalledTimes(1)
        expect(mockDeliveryEventService.notifyJobEdited).toHaveBeenCalledWith(initial, [])
      })

      it.each(TIME_FIELDS)('reports TIMES when null clears stored %s', async (field) => {
        const initial = row168Delivery({
          [field]: new Date('2026-11-25T12:00:00.000Z'),
        })
        const saved = { ...initial, [field]: null }

        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(saved)

        await service.update('del-168', partnerId, updateInput({ [field]: null }) as any)

        expect(mockDeliveryEventService.notifyJobEdited).toHaveBeenCalledTimes(1)
        expect(mockDeliveryEventService.notifyJobEdited).toHaveBeenCalledWith(initial, ['TIMES'])
      })

      it('reports TIMES only once when all four stored times are cleared with null', async () => {
        const initial = row168Delivery({
          pickupReadyAt: new Date('2026-11-25T12:00:00.000Z'),
          pickupDeadlineAt: new Date('2026-11-25T12:30:00.000Z'),
          dropoffReadyAt: new Date('2026-11-25T12:35:00.000Z'),
          dropoffDeadlineAt: new Date('2026-11-25T13:00:00.000Z'),
        })
        const saved = {
          ...initial,
          pickupReadyAt: null,
          pickupDeadlineAt: null,
          dropoffReadyAt: null,
          dropoffDeadlineAt: null,
        }

        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(saved)

        await service.update(
          'del-168',
          partnerId,
          updateInput({
            pickupReadyAt: null,
            pickupDeadlineAt: null,
            dropoffReadyAt: null,
            dropoffDeadlineAt: null,
          }) as any
        )

        expect(mockDeliveryEventService.notifyJobEdited).toHaveBeenCalledTimes(1)
        expect(mockDeliveryEventService.notifyJobEdited).toHaveBeenCalledWith(initial, ['TIMES'])
      })

      it('reports no TIMES when null time is sent for an order whose stored time is already null', async () => {
        const initial = row168Delivery({ pickupReadyAt: null })
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(initial)

        await service.update('del-168', partnerId, updateInput({ pickupReadyAt: null }) as any)

        expect(mockDeliveryEventService.notifyJobEdited).toHaveBeenCalledTimes(1)
        expect(mockDeliveryEventService.notifyJobEdited).toHaveBeenCalledWith(initial, [])
      })
    })
  })

  // Row 169: the portal's edit keeps the tip as it is
  describe("Row 169: the portal's edit keeps the tip as it is", () => {
    const sharedDropoffLocation = {
      id: 'loc-shared',
      latitude: 39.3621,
      longitude: 22.9425,
      addressLine1: 'Iasonos 45',
      addressLine2: null,
      city: 'Volos',
      state: 'Magnesia',
      street: 'Iasonos',
      zipCode: '38221',
      countryCode: 'GR',
      stateCode: 'THE',
      houseNumber: '45',
      formattedAddress: 'Iasonos 45, Volos 38221, Greece',
    }

    const row169Delivery = (opts?: { status?: EnumDeliveryStatus; tips?: number; courierId?: string | null }) => ({
      id: 'del-169',
      partnerId,
      status: opts?.status ?? EnumDeliveryStatus.CREATED,
      dropoffLocationId: 'loc-shared',
      dropoffLocation: { ...sharedDropoffLocation },
      pickupNotes: 'Old pickup notes',
      dropoffNotes: 'Old dropoff notes',
      pickupVerification: null,
      dropoffVerification: null,
      deliveryQuoteId: 'quote-1',
      tips: opts?.tips ?? 300,
      currencyCode: 'EUR',
      orderReference: 'ORD-169',
      matchedCourierId: null,
      courierId: opts?.courierId ?? null,
      boxSize: BoxSize.SMALL,
      boxUnits: 30,
      boxSizeAssumed: false,
    })

    // Input helper that does NOT set tipByCustomer by default (the key is completely omitted)
    const updateInputWithoutTip = (overrides: Record<string, unknown> = {}) =>
      ({
        dropoffLatitude: sharedDropoffLocation.latitude,
        dropoffLongitude: sharedDropoffLocation.longitude,
        pickupNotes: 'New pickup notes',
        dropoffNotes: 'New dropoff notes',
        orderReference: 'ORD-169',
        ...overrides,
      } as unknown as DeliveryUpdatePartnerInput)

    beforeEach(() => {
      mockDeliveryQuoteDomainService.getByIdOrThrow.mockResolvedValue({
        id: 'quote-1',
        pickupLocationId: 'loc-pickup',
        dropoffLocationId: 'loc-shared',
      })
      mockLocationDomainService.getById = jest.fn().mockResolvedValue(sharedDropoffLocation)
      mockDeliveryDomainService.updateIfMatches = jest.fn().mockResolvedValue(true)
      mockDeliveryEventService.recordTipChangedEvent = jest.fn().mockResolvedValue(undefined)
      mockDeliveryEventService.notifyJobEdited = jest.fn().mockResolvedValue(undefined)
    })

    describe('not held statuses (CREATED, ASSIGNING_COURIER) with no tip sent', () => {
      test.each([EnumDeliveryStatus.CREATED, EnumDeliveryStatus.ASSIGNING_COURIER])(
        'status %s with stored tip 300 and omitted tipByCustomer keeps stored tip and records no TIP_CHANGED event',
        async (status) => {
          const initial = row169Delivery({ status, tips: 300, courierId: null })
          mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(initial)

          const input = updateInputWithoutTip({ pickupNotes: 'Updated notes' })
          expect('tipByCustomer' in input).toBe(false)

          await service.update('del-169', partnerId, input)

          expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
          const [, where, data] = mockDeliveryDomainService.updateIfMatches.mock.calls[0]
          expect(where.tips).toBe(300)
          expect(data.tips).toBe(300)
          expect(mockDeliveryEventService.recordTipChangedEvent).not.toHaveBeenCalled()
        }
      )
    })

    describe('held statuses (DELIVERY_ONGOING_STATUSES) with no tip sent', () => {
      test.each(DELIVERY_ONGOING_STATUSES)(
        'held status %s with stored tip 300 and omitted tipByCustomer keeps stored tip and records no TIP_CHANGED event',
        async (status) => {
          const initial = row169Delivery({ status, tips: 300, courierId: 'courier-1' })
          mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(initial)

          const input = updateInputWithoutTip({ pickupNotes: 'Updated notes' })
          expect('tipByCustomer' in input).toBe(false)

          await service.update('del-169', partnerId, input)

          expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
          const [, where, data] = mockDeliveryDomainService.updateIfMatches.mock.calls[0]
          expect(where.tips).toBe(300)
          expect(data.tips).toBe(300)
          expect(mockDeliveryEventService.recordTipChangedEvent).not.toHaveBeenCalled()
        }
      )
    })

    describe("accept's claim window (ASSIGNING_COURIER with courierId set, decision 169.2)", () => {
      it('delivery read as ASSIGNING_COURIER with courierId set and differing tip sent: write keeps stored tip and records no TIP_CHANGED', async () => {
        const initial = row169Delivery({
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          tips: 300,
          courierId: 'courier-claim-1',
        })
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(initial)

        const input = updateInputWithoutTip({
          pickupNotes: 'Updated notes during claim',
          tipByCustomer: 500,
        })

        await service.update('del-169', partnerId, input)

        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
        const [, where, data] = mockDeliveryDomainService.updateIfMatches.mock.calls[0]
        expect(where.tips).toBe(300)
        expect(data.tips).toBe(300)
        expect(mockDeliveryEventService.recordTipChangedEvent).not.toHaveBeenCalled()
      })

      it('delivery read as ASSIGNING_COURIER with courierId set: dropoff point move is refused with 409 and nothing written', async () => {
        const initial = row169Delivery({
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          tips: 300,
          courierId: 'courier-claim-1',
        })
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue(initial)

        const input = updateInputWithoutTip({
          dropoffLatitude: 39.3625,
          dropoffLongitude: 22.943,
        })

        await expect(service.update('del-169', partnerId, input)).rejects.toThrow(
          new ConflictException(PARTNER_EDIT_SENTENCES.pointHeld)
        )

        expect(mockLocationDomainService.create).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.update).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.updateIfMatches).not.toHaveBeenCalled()
        expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).not.toHaveBeenCalled()
      })
    })
  })

  // Row 178: the portal's edit sends only what the restaurant changed (decisions 178.1 to 178.4 and 178.7)
  describe('Row 178: partner edit sends only what changed', () => {
    const row178Delivery = (overrides: Record<string, unknown> = {}) => ({
      id: 'del-178',
      partnerId,
      status: EnumDeliveryStatus.CREATED,
      deliveryQuoteId: 'quote-1',
      pickupLocationId: 'loc-pickup',
      dropoffLocationId: 'loc-dropoff',
      orderReference: 'ORD-STORED-178',
      pickupNotes: 'Stored pickup notes',
      dropoffNotes: 'Stored dropoff notes',
      pickupVerification: { signature: true } as any,
      dropoffVerification: { picture: true } as any,
      tips: 300,
      currencyCode: 'EUR',
      boxSize: BoxSize.SMALL,
      boxUnits: 30,
      boxSizeAssumed: false,
      legNumber: null,
      legCount: null,
      matchedCourierId: null,
      courierId: null,
      dropoffCorrectedLatitude: null,
      dropoffCorrectedLongitude: null,
      dropoffPointCorrectedAt: null,
      pickupReadyAt: new Date('2026-11-26T12:00:00Z'),
      pickupDeadlineAt: new Date('2026-11-26T12:30:00Z'),
      dropoffReadyAt: new Date('2026-11-26T12:35:00Z'),
      dropoffDeadlineAt: new Date('2026-11-26T13:00:00Z'),
      ...overrides,
    })

    const dropoffLocationRecord = {
      id: 'loc-dropoff',
      latitude: 39.3625,
      longitude: 22.943,
      addressLine1: 'Iasonos 12',
      addressLine2: '3rd floor',
      city: 'Volos',
      state: 'Magnesia',
      street: 'Iasonos',
      zipCode: '38221',
      countryCode: 'GR',
      stateCode: 'THE',
      houseNumber: '12',
      formattedAddress: 'Iasonos 12, Volos',
    }

    beforeEach(() => {
      mockLocationDomainService.getById.mockImplementation(async (id: string) => {
        if (id === 'loc-dropoff') return dropoffLocationRecord
        if (id === 'loc-shared') return dropoffLocationRecord
        return { id, latitude: 39.3625, longitude: 22.943 }
      })
    })

    describe('Clause 2: the point (dropoffLatitude, dropoffLongitude)', () => {
      it('an edit that leaves both coordinates out does NOT move the point on an unassigned order', async () => {
        const initial = row178Delivery()
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(initial)

        await service.update('del-178', partnerId, { pickupNotes: 'Updated pickup' } as any)

        expect(mockLocationDomainService.create).not.toHaveBeenCalled()
        expect(mockQuoteToDeliveryConversionService.isValidDeliveryLocationDrift).not.toHaveBeenCalled()
        expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
        const [, , data] = mockDeliveryDomainService.updateIfMatches.mock.calls[0]
        expect(data.dropoffLocationId).toBe('loc-dropoff')
        expect(data.dropoffCorrectedLatitude).toBeUndefined()
        expect(data.dropoffCorrectedLongitude).toBeUndefined()
      })

      it('an edit that leaves both coordinates out on a held order (status ACCEPTED, courierId set) is NOT refused with pointHeld 409', async () => {
        const initial = row178Delivery({
          status: EnumDeliveryStatus.ACCEPTED,
          courierId: 'courier-held-1',
        })
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(initial)

        await service.update('del-178', partnerId, { pickupNotes: 'Updated pickup notes while held' } as any)

        expect(mockLocationDomainService.create).not.toHaveBeenCalled()
        expect(mockQuoteToDeliveryConversionService.isValidDeliveryLocationDrift).not.toHaveBeenCalled()
        expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
        const [, , data] = mockDeliveryDomainService.updateIfMatches.mock.calls[0]
        expect(data.dropoffLocationId).toBe('loc-dropoff')
        expect(data.pickupNotes).toBe('Updated pickup notes while held')
      })

      it('an edit that leaves both coordinates out does not clear existing dropoffCorrectedLatitude / dropoffCorrectedLongitude', async () => {
        const initial = row178Delivery({
          dropoffCorrectedLatitude: 39.366,
          dropoffCorrectedLongitude: 22.945,
          dropoffPointCorrectedAt: new Date(),
        })
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(initial)

        await service.update('del-178', partnerId, { pickupNotes: 'Updated notes' } as any)

        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
        const [, , data] = mockDeliveryDomainService.updateIfMatches.mock.calls[0]
        expect(data.dropoffCorrectedLatitude).toBeUndefined()
        expect(data.dropoffCorrectedLongitude).toBeUndefined()
      })

      it('refuses an edit with dropoffLatitude alone with 400 BadRequestException and writes nothing', async () => {
        const initial = row178Delivery()
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue(initial)

        await expect(
          service.update('del-178', partnerId, { dropoffLatitude: 39.37 } as any)
        ).rejects.toThrow(new BadRequestException('Send dropoffLatitude and dropoffLongitude together, or leave both out.'))

        expect(mockLocationDomainService.create).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.updateIfMatches).not.toHaveBeenCalled()
      })

      it('refuses an edit with dropoffLongitude alone with 400 BadRequestException and writes nothing', async () => {
        const initial = row178Delivery()
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue(initial)

        await expect(
          service.update('del-178', partnerId, { dropoffLongitude: 22.95 } as any)
        ).rejects.toThrow(new BadRequestException('Send dropoffLatitude and dropoffLongitude together, or leave both out.'))

        expect(mockLocationDomainService.create).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.updateIfMatches).not.toHaveBeenCalled()
      })

      it('refuses an edit with dropoffLatitude: null and dropoffLongitude: 22.948 with 400 BadRequestException and writes nothing', async () => {
        const initial = row178Delivery()
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue(initial)

        await expect(
          service.update('del-178', partnerId, { dropoffLatitude: null, dropoffLongitude: 22.948 } as any)
        ).rejects.toThrow(new BadRequestException('Send dropoffLatitude and dropoffLongitude together, or leave both out.'))

        expect(mockLocationDomainService.create).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.updateIfMatches).not.toHaveBeenCalled()
        expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
      })

      it('refuses an edit with both dropoffLatitude: null and dropoffLongitude: null with 400 BadRequestException and writes nothing', async () => {
        const initial = row178Delivery()
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue(initial)

        await expect(
          service.update('del-178', partnerId, { dropoffLatitude: null, dropoffLongitude: null } as any)
        ).rejects.toThrow(new BadRequestException('Send dropoffLatitude and dropoffLongitude together, or leave both out.'))

        expect(mockLocationDomainService.create).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.updateIfMatches).not.toHaveBeenCalled()
        expect(mockDeliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
      })

      it('sending both coordinates behaves as usual: moved point creates Location, checks drift, emits event', async () => {
        const initial = row178Delivery()
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(initial)
        mockLocationDomainService.create.mockResolvedValueOnce({ id: 'loc-new-point' })

        await service.update('del-178', partnerId, {
          dropoffLatitude: 39.37,
          dropoffLongitude: 22.95,
        } as any)

        expect(mockLocationDomainService.create).toHaveBeenCalledTimes(1)
        expect(mockQuoteToDeliveryConversionService.isValidDeliveryLocationDrift).toHaveBeenCalledTimes(1)
        expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).toHaveBeenCalledTimes(1)
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
        const [, , data] = mockDeliveryDomainService.updateIfMatches.mock.calls[0]
        expect(data.dropoffLocationId).toBe('loc-new-point')
        expect(data.dropoffCorrectedLatitude).toBeNull()
        expect(data.dropoffCorrectedLongitude).toBeNull()
      })

      it('sending both coordinates with the same values as stored does NOT move point (no new Location, no event)', async () => {
        const initial = row178Delivery()
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(initial)

        await service.update('del-178', partnerId, {
          dropoffLatitude: dropoffLocationRecord.latitude,
          dropoffLongitude: dropoffLocationRecord.longitude,
          pickupNotes: 'Updated notes',
        } as any)

        expect(mockLocationDomainService.create).not.toHaveBeenCalled()
        expect(mockQuoteToDeliveryConversionService.isValidDeliveryLocationDrift).not.toHaveBeenCalled()
        expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
        const [, , data] = mockDeliveryDomainService.updateIfMatches.mock.calls[0]
        expect(data.dropoffLocationId).toBe('loc-dropoff')
      })
    })

    describe('Clause 3: the leg check (orderReference)', () => {
      it('on a leg (legCount set), an edit that leaves orderReference out is NOT refused and writes no orderReference', async () => {
        const initial = row178Delivery({
          legCount: 2,
          legNumber: 1,
          orderReference: 'LEG-REF-100',
        })
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(initial)

        await service.update('del-178', partnerId, { pickupNotes: 'Kitchen door' } as any)

        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
        const [, , data] = mockDeliveryDomainService.updateIfMatches.mock.calls[0]
        expect(data.orderReference).toBeUndefined()
        expect(data.pickupNotes).toBe('Kitchen door')
      })

      it('on a leg (legCount set), an edit that sends a differing orderReference is refused with 409 LEG_LABELS_LOCKED', async () => {
        const initial = row178Delivery({
          legCount: 2,
          legNumber: 1,
          orderReference: 'LEG-REF-100',
        })
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValue(initial)

        await expect(
          service.update('del-178', partnerId, { orderReference: 'LEG-REF-DIFF' } as any)
        ).rejects.toThrow(new ConflictException(LEG_LABELS_LOCKED_SENTENCE))

        expect(mockDeliveryDomainService.updateIfMatches).not.toHaveBeenCalled()
      })

      it('on a leg (legCount set), an edit that sends the same orderReference passes and writes it', async () => {
        const initial = row178Delivery({
          legCount: 2,
          legNumber: 1,
          orderReference: 'LEG-REF-100',
        })
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(initial)

        await service.update('del-178', partnerId, { orderReference: 'LEG-REF-100', pickupNotes: 'Updated' } as any)

        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
        const [, , data] = mockDeliveryDomainService.updateIfMatches.mock.calls[0]
        expect(data.orderReference).toBe('LEG-REF-100')
        expect(data.pickupNotes).toBe('Updated')
      })
    })

    describe('Clause 4: left out fields keep stored values', () => {
      it('data passed to updateIfMatches has undefined for left out fields among pickupNotes, dropoffNotes, orderReference, pickupVerification, dropoffVerification', async () => {
        const initial = row178Delivery()
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(initial)

        // Empty input: no fields sent
        await service.update('del-178', partnerId, {} as any)

        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
        const [, , data] = mockDeliveryDomainService.updateIfMatches.mock.calls[0]
        expect(data.pickupNotes).toBeUndefined()
        expect(data.dropoffNotes).toBeUndefined()
        expect(data.orderReference).toBeUndefined()
        expect(data.pickupVerification).toBeUndefined()
        expect(data.dropoffVerification).toBeUndefined()
      })

      it('sent fields are passed through to updateIfMatches data', async () => {
        const initial = row178Delivery()
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(initial)

        const sentVerification = { signature: true, barcodes: ['12345'] } as any
        await service.update('del-178', partnerId, {
          pickupNotes: 'New pickup note',
          dropoffNotes: 'New dropoff note',
          orderReference: 'NEW-REF-77',
          pickupVerification: sentVerification,
          dropoffVerification: sentVerification,
        } as any)

        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
        const [, , data] = mockDeliveryDomainService.updateIfMatches.mock.calls[0]
        expect(data.pickupNotes).toBe('New pickup note')
        expect(data.dropoffNotes).toBe('New dropoff note')
        expect(data.orderReference).toBe('NEW-REF-77')
        expect(data.pickupVerification).toEqual(sentVerification)
        expect(data.dropoffVerification).toEqual(sentVerification)
      })

      it('emits no TIP_CHANGED, no BOX_SIZE_CHANGED, and no DROPOFF_POINT_CORRECTED for fields not sent', async () => {
        const initial = row178Delivery()
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(initial)

        await service.update('del-178', partnerId, { pickupNotes: 'Only note edit' } as any)

        expect(mockDeliveryEventService.recordTipChangedEvent).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.recordBoxSizeChanged).not.toHaveBeenCalled()
        expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).not.toHaveBeenCalled()
      })

      it('notifyJobEdited gets an empty list [] for an edit that leaves notes and times out on a held order', async () => {
        const initial = row178Delivery({
          status: EnumDeliveryStatus.ACCEPTED,
          courierId: 'courier-1',
        })
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(initial)

        // Neither notes nor times sent
        await service.update('del-178', partnerId, { orderReference: 'ORD-SAME' } as any)

        expect(mockDeliveryEventService.notifyJobEdited).toHaveBeenCalledTimes(1)
        expect(mockDeliveryEventService.notifyJobEdited).toHaveBeenCalledWith(initial, [])
      })

      it('notifyJobEdited gets [NOTES] when a changed note is sent on a held order', async () => {
        const initial = row178Delivery({
          status: EnumDeliveryStatus.ACCEPTED,
          courierId: 'courier-1',
          pickupNotes: 'Initial pickup note',
        })
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(initial).mockResolvedValueOnce(initial)

        await service.update('del-178', partnerId, { pickupNotes: 'Changed pickup note' } as any)

        expect(mockDeliveryEventService.notifyJobEdited).toHaveBeenCalledTimes(1)
        expect(mockDeliveryEventService.notifyJobEdited).toHaveBeenCalledWith(initial, ['NOTES'])
      })
    })

    describe('Clause 5: End-to-end proof of Done when at service level', () => {
      it('stored delivery has values X (as if changed through API); an edit sending only pickupNotes leaves every other field out of the write', async () => {
        const storedX = row178Delivery({
          id: 'del-x',
          pickupNotes: 'API Pickup Notes X',
          dropoffNotes: 'API Dropoff Notes X',
          orderReference: 'API-REF-X',
          pickupVerification: { signature: true, minAge: 21 } as any,
          dropoffVerification: { picture: true } as any,
          dropoffLocationId: 'loc-dropoff',
          dropoffCorrectedLatitude: 39.368,
          dropoffCorrectedLongitude: 22.946,
          tips: 450,
          boxSize: BoxSize.MEDIUM,
          boxUnits: 50,
        })
        mockDeliveryDomainService.getByIdOrThrow.mockResolvedValueOnce(storedX).mockResolvedValueOnce(storedX)

        // Restaurant portal sends ONLY pickupNotes
        const portalEditInput = { pickupNotes: 'Portal edited pickup note' }

        await service.update('del-x', partnerId, portalEditInput as any)

        // Verify updateIfMatches call
        expect(mockDeliveryDomainService.updateIfMatches).toHaveBeenCalledTimes(1)
        const [targetId, where, data] = mockDeliveryDomainService.updateIfMatches.mock.calls[0]
        expect(targetId).toBe('del-x')
        expect(where.status).toBe(storedX.status)
        expect(where.tips).toBe(450)
        expect(where.dropoffLocationId).toBe('loc-dropoff')

        // Data written: pickupNotes updated, everything else left out (undefined) or kept as stored
        expect(data.pickupNotes).toBe('Portal edited pickup note')
        expect(data.dropoffNotes).toBeUndefined()
        expect(data.orderReference).toBeUndefined()
        expect(data.pickupVerification).toBeUndefined()
        expect(data.dropoffVerification).toBeUndefined()
        expect(data.dropoffLocationId).toBe('loc-dropoff')
        expect(data.dropoffCorrectedLatitude).toBeUndefined()
        expect(data.dropoffCorrectedLongitude).toBeUndefined()
        expect(data.tips).toBe(450)

        // No side effects triggered for untouched fields
        expect(mockLocationDomainService.create).not.toHaveBeenCalled()
        expect(mockQuoteToDeliveryConversionService.isValidDeliveryLocationDrift).not.toHaveBeenCalled()
        expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).not.toHaveBeenCalled()
        expect(mockDeliveryEventService.recordTipChangedEvent).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.recordBoxSizeChanged).not.toHaveBeenCalled()
      })
    })
  })
})
