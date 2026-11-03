import { DeliveryNotFoundException } from 'src/errors'
import { EnumCancelledBy, EnumDeliveryStatus } from '@prisma/types'
import { DeliveryPartnerRestApiService } from './delivery.partner.rest-api.service'
import { partnerHistoryCutoff } from './partner-history'
import { DeliveryUpdatePartnerInput } from './queries/delivery-update.partner.input'

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
      status: EnumDeliveryStatus.ACCEPTED,
      createdAt: new Date(),
      dropoffLocationId: 'loc-shared',
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
      mockDeliveryDomainService.update.mockImplementation((id: string, data: Record<string, unknown>) =>
        Promise.resolve({ id, ...data })
      )
      mockLocationDomainService.getById = jest.fn().mockResolvedValue({ ...sharedLocation })
      mockLocationDomainService.create = jest.fn().mockResolvedValue({ id: 'loc-new' })
      mockLocationDomainService.update = jest.fn()
      mockQuoteToDeliveryConversionService.isValidDeliveryLocationDrift = jest.fn().mockResolvedValue(true)
    })

    describe('a moved point', () => {
      const moved = () => inputAt(39.3625, 22.943)

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

        expect(mockDeliveryDomainService.update).toHaveBeenCalledTimes(1)
        expect(mockDeliveryDomainService.update).toHaveBeenCalledWith('del-own', {
          dropoffLocationId: 'loc-new',
          ...otherUpdateFields,
        })
        expect(result).toEqual({ id: 'del-own', dropoffLocationId: 'loc-new', ...otherUpdateFields })
      })

      it('counts only the latitude moving as moved', async () => {
        await service.update('del-own', partnerId, inputAt(39.3625, sharedLocation.longitude))

        expect(mockLocationDomainService.update).not.toHaveBeenCalled()
        expect(mockLocationDomainService.create).toHaveBeenCalledTimes(1)
        expect(mockLocationDomainService.create).toHaveBeenCalledWith(
          expect.objectContaining({ latitude: 39.3625, longitude: sharedLocation.longitude })
        )
        expect(mockDeliveryDomainService.update).toHaveBeenCalledWith(
          'del-own',
          expect.objectContaining({ dropoffLocationId: 'loc-new' })
        )
      })

      it('counts only the longitude moving as moved', async () => {
        await service.update('del-own', partnerId, inputAt(sharedLocation.latitude, 22.943))

        expect(mockLocationDomainService.update).not.toHaveBeenCalled()
        expect(mockLocationDomainService.create).toHaveBeenCalledTimes(1)
        expect(mockLocationDomainService.create).toHaveBeenCalledWith(
          expect.objectContaining({ latitude: sharedLocation.latitude, longitude: 22.943 })
        )
        expect(mockDeliveryDomainService.update).toHaveBeenCalledWith(
          'del-own',
          expect.objectContaining({ dropoffLocationId: 'loc-new' })
        )
      })
    })

    describe('an unmoved point', () => {
      it('creates nothing, updates no Location and keeps the old id', async () => {
        await service.update('del-own', partnerId, inputAt(sharedLocation.latitude, sharedLocation.longitude))

        expect(mockLocationDomainService.create).not.toHaveBeenCalled()
        expect(mockLocationDomainService.update).not.toHaveBeenCalled()
        expect(mockDeliveryDomainService.update).toHaveBeenCalledTimes(1)
        expect(mockDeliveryDomainService.update).toHaveBeenCalledWith('del-own', {
          dropoffLocationId: 'loc-shared',
          ...otherUpdateFields,
        })
      })
    })

    describe('checks that still come first', () => {
      it('refuses a point too far from the old one before writing anything', async () => {
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
        mockDeliveryDomainService.getByIdOrThrow.mockImplementation((id: string) =>
          Promise.resolve({ ...rowOrThrow(deliveries, id) })
        )
        mockDeliveryDomainService.update.mockImplementation((id: string, data: Partial<FakeDelivery>) => {
          const updated = { ...rowOrThrow(deliveries, id), ...data }
          deliveries.set(id, updated)
          return Promise.resolve(updated)
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
})
