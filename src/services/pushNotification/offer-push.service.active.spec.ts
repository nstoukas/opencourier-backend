import { EnumDeliveryStatus, EnumDistanceUnit } from '@prisma/types'
import { OfferPushService } from './offer-push.service'
import { PushNotificationService, PushSendResult } from './pushNotification.service'
import { CourierDeviceRepository } from 'src/persistence/repositories/courier-device.repository'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { BullMQService } from 'src/integrations/bullMQ/bullMQ.service'
import { TaskBusService } from '../taskBus/taskBus.service'
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

  // Track the registered task handler for 'offer-insist'
  let registeredTaskHandler: (payload: any) => Promise<void>

  const sampleOfferedAt = new Date('2026-10-26T10:00:00.000Z')

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
    dropoffLocation: {
      street: 'Argonafton',
      houseNumber: '15',
      city: 'Volos',
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

    service = new OfferPushService(
      mockPushNotificationService,
      mockCourierDeviceRepository,
      mockDeliveryRepository,
      mockBullMQService,
      mockTaskBusService
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
  })
})
