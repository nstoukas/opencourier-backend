import { Logger } from '@nestjs/common'
import { EnumDeliveryStatus, EnumDistanceUnit } from '@prisma/types'
import { OfferPushService, OFFER_PUSH_TRIP_BUDGET_MS } from './offer-push.service'
import { PushNotificationService, PushSendResult } from './pushNotification.service'
import { CourierDeviceRepository } from 'src/persistence/repositories/courier-device.repository'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { BullMQService } from 'src/integrations/bullMQ/bullMQ.service'
import { TaskBusService } from '../taskBus/taskBus.service'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import { OsrmRoutingService } from 'src/services/osrm/osrm-routing.service'
import { IOsrmRouteInput } from 'src/services/osrm/interfaces/IOsrmRouteInput'
import { NotificationEventType } from 'src/shared-types/notification'
import { OFFER_CARD_PAYLOAD_KEYS } from 'src/domains/delivery/offer-card-payload'
import { PUSH_DEFAULT_TTL_SECONDS, OFFER_INSIST_AFTER_SECONDS } from '../../constants'

describe('OfferPushService - Spec 0003 AC-2, AC-6, AC-7, AC-10 Push Offers & Insistent Re-send', () => {
  let service: OfferPushService
  let mockPushNotificationService: jest.Mocked<PushNotificationService>
  let mockCourierDeviceRepository: jest.Mocked<CourierDeviceRepository>
  let mockDeliveryRepository: jest.Mocked<DeliveryRepository>
  let mockBullMQService: jest.Mocked<BullMQService>
  let mockTaskBusService: jest.Mocked<TaskBusService>
  let mockCourierRepository: jest.Mocked<CourierRepository>
  let mockOsrmRoutingService: jest.Mocked<OsrmRoutingService>

  // Track the registered task handler for 'offer-insist'
  let registeredTaskHandler: (payload: any) => Promise<void>

  const sampleOfferedAt = new Date('2026-10-26T10:00:00.000Z')

  // Distinctive coordinates (row 100): none of their digits may show up in a log line or a push value.
  const RIDER = { latitude: 39.371111, longitude: 22.931111 }
  const PICKUP = { latitude: 39.362222, longitude: 22.942222 }
  const DROPOFF = { latitude: 39.353333, longitude: 22.953333 }
  const COORDINATE_FRAGMENTS = ['39.37', '39.36', '39.35', '22.93', '22.94', '22.95', '371111', '931111', '362222', '942222', '353333', '953333']

  const createSampleOfferCardSource = (overrides?: Partial<any>) => ({
    delivery: {
      id: 'del-push-1',
      offeredAt: sampleOfferedAt,
      offerExpiresAt: null,
      totalCompensation: 450,
      currencyCode: 'EUR',
      pickupBusinessName: 'Volos Tavern',
      ...overrides?.delivery,
    },
    // Row 100: the push routes from the pickup and drop off points, so the source carries both.
    pickupLocation: {
      latitude: PICKUP.latitude,
      longitude: PICKUP.longitude,
      ...overrides?.pickupLocation,
    },
    dropoffLocation: {
      street: 'Argonafton',
      houseNumber: '15',
      city: 'Volos',
      latitude: DROPOFF.latitude,
      longitude: DROPOFF.longitude,
      ...overrides?.dropoffLocation,
    },
    quote: {
      distance: 1.5,
      distanceUnit: EnumDistanceUnit.KILOMETERS,
      ...overrides?.quote,
    },
  })

  beforeEach(() => {
    mockPushNotificationService = {
      isEnabled: jest.fn().mockReturnValue(true),
      sendData: jest.fn().mockResolvedValue({ deadTokens: [], failureCodes: [] } as PushSendResult),
    } as unknown as jest.Mocked<PushNotificationService>

    mockCourierDeviceRepository = {
      findTokensForCourier: jest.fn().mockResolvedValue(['token-device-a', 'token-device-b']),
      deleteByTokens: jest.fn().mockResolvedValue(1),
    } as unknown as jest.Mocked<CourierDeviceRepository>

    mockDeliveryRepository = {
      findOfferCardSourceOrThrow: jest.fn().mockResolvedValue(createSampleOfferCardSource()),
      findById: jest.fn(),
    } as unknown as jest.Mocked<DeliveryRepository>

    mockBullMQService = {
      addJob: jest.fn().mockResolvedValue(undefined as any),
    } as unknown as jest.Mocked<BullMQService>

    mockTaskBusService = {
      registerTaskHandler: jest.fn().mockImplementation((name, handler) => {
        if (name === 'offer-insist') {
          registeredTaskHandler = handler
        }
      }),
    } as unknown as jest.Mocked<TaskBusService>

    // Row 100: the rider's stored location and the co-op's routing, both answering at once by default:
    // 873 m / 120 s to the restaurant, 1014 m / 150 s on to the customer.
    mockCourierRepository = {
      getCurrentLocation: jest.fn().mockResolvedValue(RIDER),
    } as unknown as jest.Mocked<CourierRepository>

    mockOsrmRoutingService = {
      getRoute: jest.fn().mockImplementation(async (input: IOsrmRouteInput) => {
        if (input.fromLocation.latitude === RIDER.latitude) {
          return { distanceMetres: 872.6, durationSeconds: 120, points: [] }
        }
        return { distanceMetres: 1014.2, durationSeconds: 150, points: [] }
      }),
    } as unknown as jest.Mocked<OsrmRoutingService>

    service = new OfferPushService(
      mockPushNotificationService,
      mockCourierDeviceRepository,
      mockDeliveryRepository,
      mockBullMQService,
      mockTaskBusService,
      mockCourierRepository,
      mockOsrmRoutingService
    )
  })

  test('registers "offer-insist" task handler in constructor', () => {
    expect(mockTaskBusService.registerTaskHandler).toHaveBeenCalledWith(
      'offer-insist',
      expect.any(Function)
    )
    expect(registeredTaskHandler).toBeDefined()
  })

  describe('Push off (AC-11)', () => {
    test('sendNewOffer returns immediately without querying database when push is disabled', async () => {
      mockPushNotificationService.isEnabled.mockReturnValue(false)

      await service.sendNewOffer('courier-1', 'del-1', false)

      expect(mockCourierDeviceRepository.findTokensForCourier).not.toHaveBeenCalled()
      expect(mockDeliveryRepository.findOfferCardSourceOrThrow).not.toHaveBeenCalled()
      expect(mockPushNotificationService.sendData).not.toHaveBeenCalled()
      expect(mockBullMQService.addJob).not.toHaveBeenCalled()
    })

    test('sendOfferEnded returns immediately without querying database when push is disabled', async () => {
      mockPushNotificationService.isEnabled.mockReturnValue(false)

      await service.sendOfferEnded('courier-1', { deliveryId: 'del-1', reason: 'EXPIRED' })

      expect(mockCourierDeviceRepository.findTokensForCourier).not.toHaveBeenCalled()
      expect(mockPushNotificationService.sendData).not.toHaveBeenCalled()
    })
  })

  describe('sendNewOffer (AC-2, AC-10 Allow List, Dead Token Deletion)', () => {
    test('returns immediately if rider has no registered device tokens', async () => {
      mockCourierDeviceRepository.findTokensForCourier.mockResolvedValue([])

      await service.sendNewOffer('courier-no-phone', 'del-push-1', false)

      expect(mockDeliveryRepository.findOfferCardSourceOrThrow).not.toHaveBeenCalled()
      expect(mockPushNotificationService.sendData).not.toHaveBeenCalled()
    })

    test('AC-10: payload contains type and exactly the allow listed OFFER_CARD_PAYLOAD_KEYS', async () => {
      await service.sendNewOffer('courier-1', 'del-push-1', false)

      expect(mockPushNotificationService.sendData).toHaveBeenCalledTimes(1)
      const [tokens, data, ttl] = mockPushNotificationService.sendData.mock.calls[0]!

      expect(tokens).toEqual(['token-device-a', 'token-device-b'])
      expect(ttl).toBe(PUSH_DEFAULT_TTL_SECONDS) // 300 s default with no deadline

      // Payload keys must equal 'type' plus OFFER_CARD_PAYLOAD_KEYS
      const dataKeys = Object.keys(data).sort()
      const expectedKeys = ['type', ...OFFER_CARD_PAYLOAD_KEYS].sort()
      expect(dataKeys).toEqual(expectedKeys)

      expect(data.type).toBe(NotificationEventType.NEW_DELIVERY_OFFER)
      expect(data.deliveryId).toBe('del-push-1')
      expect(data.insistent).toBe('')
    })

    test('calculates TTL from remaining seconds when offer has a deadline', async () => {
      const now = new Date()
      const futureDeadline = new Date(now.getTime() + 45 * 1000) // 45 seconds remaining
      mockDeliveryRepository.findOfferCardSourceOrThrow.mockResolvedValue(
        createSampleOfferCardSource({
          delivery: { offerExpiresAt: futureDeadline },
        })
      )

      await service.sendNewOffer('courier-1', 'del-push-1', false)

      const [, , ttl] = mockPushNotificationService.sendData.mock.calls[0]!
      expect(ttl).toBeGreaterThanOrEqual(44)
      expect(ttl).toBeLessThanOrEqual(45)
    })

    test('skips push when offer has already passed its deadline (TTL <= 0)', async () => {
      const pastDeadline = new Date(Date.now() - 5000)
      mockDeliveryRepository.findOfferCardSourceOrThrow.mockResolvedValue(
        createSampleOfferCardSource({
          delivery: { offerExpiresAt: pastDeadline },
        })
      )

      await service.sendNewOffer('courier-1', 'del-push-1', false)

      expect(mockPushNotificationService.sendData).not.toHaveBeenCalled()
      expect(mockBullMQService.addJob).not.toHaveBeenCalled()
    })

    test('AC-1: deletes dead tokens when reported by sendData', async () => {
      mockPushNotificationService.sendData.mockResolvedValue({
        deadTokens: ['token-device-a'],
        failureCodes: ['messaging/invalid-argument'],
      })

      await service.sendNewOffer('courier-1', 'del-push-1', false)

      expect(mockCourierDeviceRepository.deleteByTokens).toHaveBeenCalledWith(['token-device-a'])
    })
  })

  describe('AC-7: Insistent 2-minute re-send job scheduling and execution', () => {
    test('schedules offer-insist job after 120s when offer has no deadline', async () => {
      await service.sendNewOffer('courier-1', 'del-push-1', false)

      expect(mockBullMQService.addJob).toHaveBeenCalledWith(
        'offer-insist',
        {
          deliveryId: 'del-push-1',
          courierId: 'courier-1',
          offeredAt: sampleOfferedAt.toISOString(),
        },
        {
          delay: OFFER_INSIST_AFTER_SECONDS * 1000, // 120,000 ms
          jobId: `offer-insist-del-push-1-${sampleOfferedAt.getTime()}`,
          removeOnFail: true,
        }
      )
    })

    test('does NOT schedule offer-insist job when offer already has a deadline', async () => {
      const deadline = new Date(Date.now() + 60000)
      mockDeliveryRepository.findOfferCardSourceOrThrow.mockResolvedValue(
        createSampleOfferCardSource({
          delivery: { offerExpiresAt: deadline },
        })
      )

      await service.sendNewOffer('courier-1', 'del-push-1', false)

      expect(mockBullMQService.addJob).not.toHaveBeenCalled()
    })

    test('does NOT schedule offer-insist job when insistent is already true (re-send)', async () => {
      await service.sendNewOffer('courier-1', 'del-push-1', true)

      expect(mockBullMQService.addJob).not.toHaveBeenCalled()
    })

    describe('handleOfferInsistJob', () => {
      const validPayload = {
        deliveryId: 'del-push-1',
        courierId: 'courier-1',
        offeredAt: sampleOfferedAt.toISOString(),
      }

      test('re-sends offer with insistent: "1" when offer is still open with no deadline', async () => {
        // Delivery still ASSIGNING_COURIER, same courier, courierId null (unclaimed), same offeredAt, no deadline
        mockDeliveryRepository.findById.mockResolvedValue({
          id: 'del-push-1',
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: 'courier-1',
          courierId: null,
          offeredAt: sampleOfferedAt,
          offerExpiresAt: null,
        } as any)

        await registeredTaskHandler(validPayload)

        expect(mockPushNotificationService.sendData).toHaveBeenCalledTimes(1)
        const [, data] = mockPushNotificationService.sendData.mock.calls[0]!
        expect(data.insistent).toBe('1')
      })

      test('sends nothing if offer was answered (courierId set or status changed)', async () => {
        // Offer was accepted by the rider
        mockDeliveryRepository.findById.mockResolvedValue({
          id: 'del-push-1',
          status: EnumDeliveryStatus.ACCEPTED,
          matchedCourierId: 'courier-1',
          courierId: 'courier-1',
          offeredAt: sampleOfferedAt,
          offerExpiresAt: null,
        } as any)

        await registeredTaskHandler(validPayload)

        expect(mockPushNotificationService.sendData).not.toHaveBeenCalled()
      })

      test('sends nothing if offer was moved to another courier', async () => {
        mockDeliveryRepository.findById.mockResolvedValue({
          id: 'del-push-1',
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: 'courier-other-2',
          courierId: null,
          offeredAt: sampleOfferedAt,
          offerExpiresAt: null,
        } as any)

        await registeredTaskHandler(validPayload)

        expect(mockPushNotificationService.sendData).not.toHaveBeenCalled()
      })

      test('sends nothing if offer was given a deadline meanwhile', async () => {
        mockDeliveryRepository.findById.mockResolvedValue({
          id: 'del-push-1',
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: 'courier-1',
          courierId: null,
          offeredAt: sampleOfferedAt,
          offerExpiresAt: new Date(Date.now() + 30000),
        } as any)

        await registeredTaskHandler(validPayload)

        expect(mockPushNotificationService.sendData).not.toHaveBeenCalled()
      })

      test('sends nothing if offeredAt does not match (different offer cycle)', async () => {
        mockDeliveryRepository.findById.mockResolvedValue({
          id: 'del-push-1',
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: 'courier-1',
          courierId: null,
          offeredAt: new Date('2026-10-26T10:05:00.000Z'), // later re-offer
          offerExpiresAt: null,
        } as any)

        await registeredTaskHandler(validPayload)

        expect(mockPushNotificationService.sendData).not.toHaveBeenCalled()
      })

      test('ignores job with invalid offeredAt timestamp', async () => {
        await registeredTaskHandler({
          deliveryId: 'del-push-1',
          courierId: 'courier-1',
          offeredAt: 'not-a-valid-date',
        })

        expect(mockDeliveryRepository.findById).not.toHaveBeenCalled()
        expect(mockPushNotificationService.sendData).not.toHaveBeenCalled()
      })

      test('a failing lookup logs delivery id and error name without error message and sends nothing', async () => {
        const sensitiveError = new Error('FATAL: connection timeout on SELECT * FROM "Delivery"')
        sensitiveError.name = 'PrismaClientKnownRequestError'
        mockDeliveryRepository.findById.mockRejectedValue(sensitiveError)

        const loggerSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})

        await registeredTaskHandler(validPayload)

        // Error name is logged with delivery id, never query/details from error message
        expect(loggerSpy).toHaveBeenCalledWith(
          `offer-insist lookup failed for delivery ${validPayload.deliveryId}: PrismaClientKnownRequestError`
        )
        expect(loggerSpy.mock.calls[0]![0]).not.toContain('SELECT * FROM')
        // Does not throw and sends no push
        expect(mockPushNotificationService.sendData).not.toHaveBeenCalled()
      })

      test('a failing lookup with non-Error logs "unknown error" and sends nothing', async () => {
        mockDeliveryRepository.findById.mockRejectedValue('network timeout string')

        const loggerSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})

        await registeredTaskHandler(validPayload)

        expect(loggerSpy).toHaveBeenCalledWith(
          `offer-insist lookup failed for delivery ${validPayload.deliveryId}: unknown error`
        )
        expect(mockPushNotificationService.sendData).not.toHaveBeenCalled()
      })
    })
  })

  describe('sendOfferEnded (AC-6)', () => {
    test('sends OFFER_ENDED data message with deliveryId and reason to all devices with 300s TTL', async () => {
      await service.sendOfferEnded('courier-1', {
        deliveryId: 'del-push-1',
        reason: 'EXPIRED',
      })

      expect(mockPushNotificationService.sendData).toHaveBeenCalledWith(
        ['token-device-a', 'token-device-b'],
        {
          type: NotificationEventType.OFFER_ENDED,
          deliveryId: 'del-push-1',
          reason: 'EXPIRED',
        },
        PUSH_DEFAULT_TTL_SECONDS
      )
    })

    test('prunes dead tokens when reported by sendOfferEnded', async () => {
      mockPushNotificationService.sendData.mockResolvedValue({
        deadTokens: ['token-device-b'],
        failureCodes: [],
      })

      await service.sendOfferEnded('courier-1', {
        deliveryId: 'del-push-1',
        reason: 'OFFLINE',
      })

      expect(mockCourierDeviceRepository.deleteByTokens).toHaveBeenCalledWith(['token-device-b'])
    })
  })

  describe('Fire and forget methods (newOffer & offerEnded never throw)', () => {
    test('newOffer swallows rejections without crashing', async () => {
      mockDeliveryRepository.findOfferCardSourceOrThrow.mockRejectedValue(new Error('DB crashed'))

      expect(() => service.newOffer('courier-1', 'del-1')).not.toThrow()
    })

    test('offerEnded swallows rejections without crashing', async () => {
      mockCourierDeviceRepository.findTokensForCourier.mockRejectedValue(new Error('Redis crashed'))

      expect(() => service.offerEnded('courier-1', { deliveryId: 'del-1', reason: 'MOVED' })).not.toThrow()
    })

    test('jobCancelled swallows rejections without crashing', async () => {
      mockCourierDeviceRepository.findTokensForCourier.mockRejectedValue(new Error('Push crashed'))

      expect(() => service.jobCancelled('courier-1', 'del-1')).not.toThrow()
    })
  })

  describe('sendJobCancelled (Spec 0015 AC-7)', () => {
    test('sends JOB_CANCELLED data message with deliveryId to all devices with 300s TTL', async () => {
      await service.sendJobCancelled('courier-1', 'del-push-1')

      expect(mockPushNotificationService.sendData).toHaveBeenCalledWith(
        ['token-device-a', 'token-device-b'],
        {
          type: NotificationEventType.JOB_CANCELLED,
          deliveryId: 'del-push-1',
        },
        PUSH_DEFAULT_TTL_SECONDS
      )
    })

    test('returns immediately without sending when push is disabled', async () => {
      mockPushNotificationService.isEnabled.mockReturnValue(false)

      await service.sendJobCancelled('courier-1', 'del-push-1')

      expect(mockCourierDeviceRepository.findTokensForCourier).not.toHaveBeenCalled()
      expect(mockPushNotificationService.sendData).not.toHaveBeenCalled()
    })

    it('returns without sending when courier has no push tokens registered', async () => {
      mockCourierDeviceRepository.findTokensForCourier.mockResolvedValueOnce([])

      await service.sendJobCancelled('courier-1', 'del-push-1')

      expect(mockPushNotificationService.sendData).not.toHaveBeenCalled()
    })

    test('prunes dead tokens when reported by sendJobCancelled', async () => {
      mockPushNotificationService.sendData.mockResolvedValue({
        deadTokens: ['token-device-a'],
        failureCodes: [],
      })

      await service.sendJobCancelled('courier-1', 'del-push-1')

      expect(mockCourierDeviceRepository.deleteByTokens).toHaveBeenCalledWith(['token-device-a'])
    })
  })

  describe('Row 100: the offer push carries the card trip (spec 0019 AC-1, decisions 100.1, 100.2)', () => {
    // Every Nest logger call made while a test runs (the service's own and offerTripFor's), so value 5
    // can be checked: no log line may carry a coordinate.
    let loggedArgs: unknown[][]

    beforeEach(() => {
      loggedArgs = []
      for (const method of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
        jest.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => {
          loggedArgs.push(args)
        })
        jest.spyOn(Logger, method).mockImplementation((...args: unknown[]) => {
          loggedArgs.push(args)
        })
      }
    })

    afterEach(() => {
      jest.useRealTimers()
      jest.restoreAllMocks()
    })

    const sentData = (): Record<string, string> => {
      expect(mockPushNotificationService.sendData).toHaveBeenCalledTimes(1)
      return mockPushNotificationService.sendData.mock.calls[0]![1]
    }

    const expectNoCoordinateIn = (texts: string[]) => {
      for (const text of texts) {
        for (const fragment of COORDINATE_FRAGMENTS) {
          expect(text).not.toContain(fragment)
        }
      }
    }

    const expectNoCoordinateLogged = () => {
      const texts = loggedArgs.flat().map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg) ?? String(arg)))
      expectNoCoordinateIn(texts)
    }

    // A route mock that fails the named leg(s) with an error naming the coordinates, as a real OSRM
    // error carrying its request URL would.
    const failLegs = (legs: { riderLeg?: boolean; customerLeg?: boolean }) =>
      mockOsrmRoutingService.getRoute.mockImplementation(async (input: IOsrmRouteInput) => {
        const isRiderLeg = input.fromLocation.latitude === RIDER.latitude
        const where = `${input.fromLocation.longitude},${input.fromLocation.latitude};${input.toLocation.longitude},${input.toLocation.latitude}`
        if (isRiderLeg && legs.riderLeg) throw new Error(`OSRM failed for /route/v1/driving/${where}`)
        if (!isRiderLeg && legs.customerLeg) throw new Error(`OSRM failed for /route/v1/driving/${where}`)
        return isRiderLeg
          ? { distanceMetres: 872.6, durationSeconds: 120, points: [] }
          : { distanceMetres: 1014.2, durationSeconds: 150, points: [] }
      })

    test('the budget is 1500 ms (decision 100.1)', () => {
      expect(OFFER_PUSH_TRIP_BUDGET_MS).toBe(1500)
    })

    test('works the trip out from the rider stored location, the pickup and drop off, through OSRM', async () => {
      await service.sendNewOffer('courier-1', 'del-push-1', false)

      expect(mockCourierRepository.getCurrentLocation).toHaveBeenCalledWith('courier-1')
      expect(mockOsrmRoutingService.getRoute).toHaveBeenCalledTimes(2)
      expect(mockOsrmRoutingService.getRoute).toHaveBeenCalledWith({
        fromLocation: expect.objectContaining(RIDER),
        toLocation: expect.objectContaining(PICKUP),
      })
      expect(mockOsrmRoutingService.getRoute).toHaveBeenCalledWith({
        fromLocation: expect.objectContaining(PICKUP),
        toLocation: expect.objectContaining(DROPOFF),
      })
    })

    test('the FCM data carries the trip as whole-number text, with minutes for both legs, and the quote distanceKm', async () => {
      await service.sendNewOffer('courier-1', 'del-push-1', false)

      const data = sentData()
      expect(data.toPickupMetres).toBe('873')
      expect(data.toDropoffMetres).toBe('1014')
      // ceil((120 + 150) / 60) = 5
      expect(data.minutes).toBe('5')
      // The quote's figure stays for apps older than row 100.
      expect(data.distanceKm).toBe('1.5')
      expect(Object.keys(data).sort()).toEqual(['type', ...OFFER_CARD_PAYLOAD_KEYS].sort())
    })

    test('the insistent re-send carries the trip too', async () => {
      await service.sendNewOffer('courier-1', 'del-push-1', true)

      const data = sentData()
      expect(data.insistent).toBe('1')
      expect(data.toPickupMetres).toBe('873')
      expect(data.toDropoffMetres).toBe('1014')
      expect(data.minutes).toBe('5')
    })

    test('value 5: no push value holds a coordinate of the rider, the restaurant or the customer', async () => {
      await service.sendNewOffer('courier-1', 'del-push-1', false)

      expectNoCoordinateIn(Object.values(sentData()))
    })

    describe('the 1.5 s budget (fake timers)', () => {
      // The installed Jest (29) has advanceTimersByTimeAsync, which moves the fake clock and lets the
      // promises waiting on it run, but this repo's @types/jest (26) does not declare it, so it is
      // reached through a small typed view of the jest object.
      const advanceTimersByTimeAsync = (ms: number) =>
        (jest as unknown as { advanceTimersByTimeAsync(ms: number): Promise<void> }).advanceTimersByTimeAsync(ms)

      beforeEach(() => {
        jest.useFakeTimers()
      })

      test('routing hanging: the push goes at 1.5 s, not before, with all three figures empty', async () => {
        mockOsrmRoutingService.getRoute.mockImplementation(() => new Promise(() => {}))

        const done = service.sendNewOffer('courier-1', 'del-push-1', false)

        await advanceTimersByTimeAsync(OFFER_PUSH_TRIP_BUDGET_MS - 1)
        expect(mockPushNotificationService.sendData).not.toHaveBeenCalled()

        await advanceTimersByTimeAsync(1)
        const data = sentData()
        expect(data.toPickupMetres).toBe('')
        expect(data.toDropoffMetres).toBe('')
        expect(data.minutes).toBe('')
        // What the card shows without the trip still goes.
        expect(data.payTotal).toBe('450')
        expect(data.restaurantName).toBe('Volos Tavern')
        expect(data.dropoffArea).toBe('Argonafton')

        await expect(done).resolves.toBeUndefined()
      })

      test('the location lookup hanging: the push still goes at 1.5 s with the figures empty', async () => {
        mockCourierRepository.getCurrentLocation.mockImplementation(() => new Promise(() => {}))

        const done = service.sendNewOffer('courier-1', 'del-push-1', false)

        await advanceTimersByTimeAsync(OFFER_PUSH_TRIP_BUDGET_MS)
        const data = sentData()
        expect(data.toPickupMetres).toBe('')
        expect(data.toDropoffMetres).toBe('')
        expect(data.minutes).toBe('')
        await expect(done).resolves.toBeUndefined()
      })

      test('routing answering fast: the push goes without waiting and leaves no timer pending', async () => {
        await service.sendNewOffer('courier-1', 'del-push-1', false)

        const data = sentData()
        expect(data.toPickupMetres).toBe('873')
        expect(data.minutes).toBe('5')
        expect(jest.getTimerCount()).toBe(0)
      })
    })

    describe('routing or location failing: the push still goes with what is known', () => {
      test('the rider leg failing: to the restaurant empty, on to the customer shown, minutes empty', async () => {
        failLegs({ riderLeg: true })

        await expect(service.sendNewOffer('courier-1', 'del-push-1', false)).resolves.toBeUndefined()

        const data = sentData()
        expect(data.toPickupMetres).toBe('')
        expect(data.toDropoffMetres).toBe('1014')
        expect(data.minutes).toBe('')
        // The unknown leg is logged (by delivery id), so the check below looks at a real log line.
        expect(loggedArgs.length).toBeGreaterThan(0)
        expectNoCoordinateLogged()
      })

      test('the customer leg failing: to the restaurant shown, on to the customer empty, minutes empty', async () => {
        failLegs({ customerLeg: true })

        await expect(service.sendNewOffer('courier-1', 'del-push-1', false)).resolves.toBeUndefined()

        const data = sentData()
        expect(data.toPickupMetres).toBe('873')
        expect(data.toDropoffMetres).toBe('')
        expect(data.minutes).toBe('')
        // The unknown leg is logged (by delivery id), so the check below looks at a real log line.
        expect(loggedArgs.length).toBeGreaterThan(0)
        expectNoCoordinateLogged()
      })

      test('routing failing on both legs: all three figures empty, the push still goes', async () => {
        failLegs({ riderLeg: true, customerLeg: true })

        await expect(service.sendNewOffer('courier-1', 'del-push-1', false)).resolves.toBeUndefined()

        const data = sentData()
        expect(data.toPickupMetres).toBe('')
        expect(data.toDropoffMetres).toBe('')
        expect(data.minutes).toBe('')
        expect(data.distanceKm).toBe('1.5')
        expectNoCoordinateLogged()
      })

      test('the location lookup rejecting: the rider leg is unknown, the customer leg still shows, minutes empty', async () => {
        mockCourierRepository.getCurrentLocation.mockRejectedValue(
          new Error(`location read failed near ${RIDER.latitude},${RIDER.longitude}`)
        )

        await expect(service.sendNewOffer('courier-1', 'del-push-1', false)).resolves.toBeUndefined()

        const data = sentData()
        expect(data.toPickupMetres).toBe('')
        expect(data.toDropoffMetres).toBe('1014')
        expect(data.minutes).toBe('')
        expectNoCoordinateLogged()
      })

      test('the location lookup throwing outright (not a rejection): the push still goes, the rider leg unknown', async () => {
        mockCourierRepository.getCurrentLocation.mockImplementation(() => {
          throw new Error('pool exhausted')
        })

        await expect(service.sendNewOffer('courier-1', 'del-push-1', false)).resolves.toBeUndefined()

        const data = sentData()
        expect(data.toPickupMetres).toBe('')
        expect(data.minutes).toBe('')
        expect(data.payTotal).toBe('450')
      })

      test('the rider having no stored location: the rider leg is never asked for, the customer leg still shows', async () => {
        mockCourierRepository.getCurrentLocation.mockResolvedValue(null)

        await expect(service.sendNewOffer('courier-1', 'del-push-1', false)).resolves.toBeUndefined()

        expect(mockOsrmRoutingService.getRoute).toHaveBeenCalledTimes(1)
        expect(mockOsrmRoutingService.getRoute).toHaveBeenCalledWith({
          fromLocation: expect.objectContaining(PICKUP),
          toLocation: expect.objectContaining(DROPOFF),
        })
        const data = sentData()
        expect(data.toPickupMetres).toBe('')
        expect(data.toDropoffMetres).toBe('1014')
        expect(data.minutes).toBe('')
      })

      test('value 5: a failing send after the trip logs no coordinate either', async () => {
        mockPushNotificationService.sendData.mockRejectedValue(new Error('FCM unreachable'))

        await expect(service.sendNewOffer('courier-1', 'del-push-1', false)).resolves.toBeUndefined()

        expect(loggedArgs.length).toBeGreaterThan(0)
        expectNoCoordinateLogged()
      })
    })

    describe('push off or no phone: no location read, no routing call', () => {
      test('push off: sendNewOffer reads no location and asks no route', async () => {
        mockPushNotificationService.isEnabled.mockReturnValue(false)

        await service.sendNewOffer('courier-1', 'del-push-1', false)

        expect(mockCourierRepository.getCurrentLocation).not.toHaveBeenCalled()
        expect(mockOsrmRoutingService.getRoute).not.toHaveBeenCalled()
        expect(mockPushNotificationService.sendData).not.toHaveBeenCalled()
      })

      test('push off: newOffer reads no location and asks no route', async () => {
        mockPushNotificationService.isEnabled.mockReturnValue(false)

        service.newOffer('courier-1', 'del-push-1')
        await new Promise((resolve) => setImmediate(resolve))

        expect(mockCourierRepository.getCurrentLocation).not.toHaveBeenCalled()
        expect(mockOsrmRoutingService.getRoute).not.toHaveBeenCalled()
      })

      test('no registered phone: no location read, no routing call', async () => {
        mockCourierDeviceRepository.findTokensForCourier.mockResolvedValue([])

        await service.sendNewOffer('courier-1', 'del-push-1', false)

        expect(mockCourierRepository.getCurrentLocation).not.toHaveBeenCalled()
        expect(mockOsrmRoutingService.getRoute).not.toHaveBeenCalled()
        expect(mockPushNotificationService.sendData).not.toHaveBeenCalled()
      })
    })

    // Row 100 review fixes: an offer already past its deadline costs no routing wait, and the
    // message's clock (serverNow, TTL) is read after the wait, when the push really leaves.
    describe('review fixes: deadline before the wait, clock after it', () => {
      const advanceTimersByTimeAsync = (ms: number) =>
        (jest as unknown as { advanceTimersByTimeAsync(ms: number): Promise<void> }).advanceTimersByTimeAsync(ms)

      test('an offer already past its deadline: nothing sent, no location read, no route asked', async () => {
        mockDeliveryRepository.findOfferCardSourceOrThrow.mockResolvedValue(
          createSampleOfferCardSource({ delivery: { offerExpiresAt: new Date(Date.now() - 5000) } })
        )

        await service.sendNewOffer('courier-1', 'del-push-1', false)

        expect(mockPushNotificationService.sendData).not.toHaveBeenCalled()
        expect(mockCourierRepository.getCurrentLocation).not.toHaveBeenCalled()
        expect(mockOsrmRoutingService.getRoute).not.toHaveBeenCalled()
        expect(mockBullMQService.addJob).not.toHaveBeenCalled()
      })

      test('an offer with a future deadline still reads the location, asks the route and sends', async () => {
        mockDeliveryRepository.findOfferCardSourceOrThrow.mockResolvedValue(
          createSampleOfferCardSource({ delivery: { offerExpiresAt: new Date(Date.now() + 45 * 1000) } })
        )

        await service.sendNewOffer('courier-1', 'del-push-1', false)

        expect(mockCourierRepository.getCurrentLocation).toHaveBeenCalledWith('courier-1')
        expect(mockOsrmRoutingService.getRoute).toHaveBeenCalledTimes(2)
        expect(sentData().toPickupMetres).toBe('873')
      })

      test('an offer with no deadline still reads the location, asks the route and sends', async () => {
        await service.sendNewOffer('courier-1', 'del-push-1', false)

        expect(mockCourierRepository.getCurrentLocation).toHaveBeenCalledWith('courier-1')
        expect(mockOsrmRoutingService.getRoute).toHaveBeenCalledTimes(2)
        expect(sentData().toDropoffMetres).toBe('1014')
      })

      test('routing taking 1 s: serverNow and the TTL count from after the wait (fake timers)', async () => {
        jest.useFakeTimers()
        const start = new Date('2026-11-03T08:00:00.000Z')
        jest.setSystemTime(start)
        // 45.5 s to the deadline at the start: 45 s of TTL if the clock were read before the wait,
        // 44 s when it is read after the 1 s wait.
        mockDeliveryRepository.findOfferCardSourceOrThrow.mockResolvedValue(
          createSampleOfferCardSource({ delivery: { offerExpiresAt: new Date(start.getTime() + 45500) } })
        )
        const answerAfterOneSecond = (answer: { distanceMetres: number; durationSeconds: number; points: [] }) =>
          new Promise<typeof answer>((resolve) => setTimeout(() => resolve(answer), 1000))
        mockOsrmRoutingService.getRoute.mockImplementation((input: IOsrmRouteInput) =>
          input.fromLocation.latitude === RIDER.latitude
            ? answerAfterOneSecond({ distanceMetres: 872.6, durationSeconds: 120, points: [] })
            : answerAfterOneSecond({ distanceMetres: 1014.2, durationSeconds: 150, points: [] })
        )

        const done = service.sendNewOffer('courier-1', 'del-push-1', false)
        await advanceTimersByTimeAsync(999)
        expect(mockPushNotificationService.sendData).not.toHaveBeenCalled()
        await advanceTimersByTimeAsync(1)
        await done

        const data = sentData()
        // Routing answered inside the budget, so the figures are known (the wait was routing's, not the timeout's).
        expect(data.toPickupMetres).toBe('873')
        expect(data.serverNow).toBe(new Date(start.getTime() + 1000).toISOString())
        const [, , ttl] = mockPushNotificationService.sendData.mock.calls[0]!
        expect(ttl).toBe(44)
      })

      test('a deadline that passes during the routing wait: nothing is sent', async () => {
        jest.useFakeTimers()
        const start = new Date('2026-11-03T08:00:00.000Z')
        jest.setSystemTime(start)
        mockDeliveryRepository.findOfferCardSourceOrThrow.mockResolvedValue(
          createSampleOfferCardSource({ delivery: { offerExpiresAt: new Date(start.getTime() + 800) } })
        )
        mockOsrmRoutingService.getRoute.mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve({ distanceMetres: 500, durationSeconds: 60, points: [] }), 1000))
        )

        const done = service.sendNewOffer('courier-1', 'del-push-1', false)
        await advanceTimersByTimeAsync(1000)
        await done

        expect(mockOsrmRoutingService.getRoute).toHaveBeenCalled()
        expect(mockPushNotificationService.sendData).not.toHaveBeenCalled()
      })
    })
  })
})
