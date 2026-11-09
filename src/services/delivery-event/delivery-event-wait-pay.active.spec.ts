import { ConfigService } from '@nestjs/config'
import {
  EnumCancelledBy,
  EnumCourierCompensationReason,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
  EnumDeliveryEventSource,
  EnumPartnerChargeReason,
} from '@prisma/types'
import { DeliveryEventService } from './delivery-event.service'
import { WebsocketDispatcher } from '../websocket/models/WebsocketDispatcher'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { DeliveryEventRepository } from 'src/persistence/repositories/delivery-event.repository'
import { TaskBusScheduler } from '../taskBus/models/TaskBusScheduler'
import { TaskBusService } from '../taskBus/taskBus.service'
import { PartnerWebhookService } from '../partner-webhooks/partner-webhooks.service'
import { DeliveryMatchingService } from '../delivery-matching/delivery-matching.service'
import { DeliveryCalculationService } from '../delivery-calculation/delivery-calculation.service'
import { BullMQService } from 'src/integrations/bullMQ/bullMQ.service'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { CacheService } from '../cache/cache.service'
import { OfferPushService } from '../pushNotification/offer-push.service'
import { DispatchStopRepository } from 'src/persistence/repositories/dispatch-stop.repository'
import { CourierCompensationRepository } from 'src/persistence/repositories/courier-compensation.repository'
import { PartnerChargeRepository } from 'src/persistence/repositories/partner-charge.repository'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { waitOfKey } from 'src/domains/delivery/wait-pay'

describe('DeliveryEventService - Wait Pay and Leaving (Spec 0033 AC-1 to AC-8)', () => {
  let service: DeliveryEventService
  let mockConfigService: jest.Mocked<ConfigService>
  let mockWebsocketDispatcher: jest.Mocked<WebsocketDispatcher>
  let mockCourierRepository: jest.Mocked<CourierRepository>
  let mockDeliveryRepository: jest.Mocked<DeliveryRepository>
  let mockDeliveryEventRepository: jest.Mocked<DeliveryEventRepository>
  let mockTaskScheduler: jest.Mocked<TaskBusScheduler>
  let mockTaskBusService: jest.Mocked<TaskBusService>
  let mockPartnerWebhookService: jest.Mocked<PartnerWebhookService>
  let mockDeliveryMatchingService: jest.Mocked<DeliveryMatchingService>
  let mockDeliveryCalculationService: jest.Mocked<DeliveryCalculationService>
  let mockBullMQService: jest.Mocked<BullMQService>
  let mockConfigDomainService: any
  let mockCacheService: jest.Mocked<CacheService>
  let mockOfferPushService: jest.Mocked<OfferPushService>
  let mockDispatchStopRepository: jest.Mocked<DispatchStopRepository>
  let mockCourierCompensationRepository: jest.Mocked<CourierCompensationRepository>
  let mockPartnerChargeRepository: jest.Mocked<PartnerChargeRepository>

  const DELIVERY_ID = 'del-wait-spec-1'
  const COURIER_ID = 'courier-rider-1'
  const PARTNER_ID = 'partner-restaurant-1'

  const NOW = new Date('2026-11-09T10:15:00.000Z')
  const PROMISED_READY_AT = new Date('2026-11-09T10:00:00.000Z')
  const ARRIVED_AT = new Date('2026-11-09T09:58:00.000Z')
  const PICKED_UP_AT = new Date('2026-11-09T10:15:00.000Z')

  const callOrder: string[] = []

  const baseDelivery: DeliveryEntity = {
    id: DELIVERY_ID,
    status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
    courierId: COURIER_ID,
    partnerId: PARTNER_ID,
    currencyCode: 'EUR',
    promisedReadyAt: PROMISED_READY_AT,
    readyAt: PROMISED_READY_AT,
    foodReadyAt: null,
    arrivedAtPickupAt: ARRIVED_AT,
    undispatchedAt: null,
    waitPayOwedAt: new Date('2026-11-09T10:15:00.000Z'),
    matchedCourierId: null,
    offeredAt: null,
    offerExpiresAt: null,
    acceptedAt: new Date('2026-11-09T09:50:00.000Z'),
    handBackUntil: null,
    pickupLocation: { latitude: 39.36, longitude: 22.94 },
    dropoffLocation: { latitude: 39.37, longitude: 22.95 },
  } as unknown as DeliveryEntity

  const courierEntity: CourierEntity = {
    id: COURIER_ID,
    userId: 'user-courier-1',
    firstName: 'Nikos',
    lastName: 'Courier',
    status: 'ONLINE',
  } as unknown as CourierEntity

  beforeEach(() => {
    callOrder.length = 0

    mockConfigService = { get: jest.fn() } as unknown as jest.Mocked<ConfigService>
    mockWebsocketDispatcher = {
      dispatchDeliveryStatusUpdated: jest.fn().mockImplementation(async () => {
        callOrder.push('websocket.dispatchDeliveryStatusUpdated')
      }),
      sendOfferToCourier: jest.fn(),
      sendOfferEnded: jest.fn(),
    } as unknown as jest.Mocked<WebsocketDispatcher>

    mockCourierRepository = {
      findById: jest.fn().mockResolvedValue(courierEntity),
      findByIdOrThrow: jest.fn().mockResolvedValue(courierEntity),
      hasActiveSos: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<CourierRepository>

    mockDeliveryRepository = {
      findById: jest.fn().mockResolvedValue({ ...baseDelivery }),
      findByIdOrThrow: jest.fn().mockResolvedValue({ ...baseDelivery }),
      update: jest.fn().mockResolvedValue({ ...baseDelivery }),
      updateIfMatches: jest.fn().mockImplementation(async () => {
        callOrder.push('deliveryRepository.updateIfMatches')
        return true
      }),
      findOpenOffersForCourier: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<DeliveryRepository>

    mockDeliveryEventRepository = {
      create: jest.fn().mockImplementation(async (data) => {
        callOrder.push(`deliveryEventRepository.create:${data.type}`)
        return { id: `evt-${data.type}`, ...data }
      }),
      findWaitEvents: jest.fn().mockResolvedValue([
        {
          id: 'evt-arr-1',
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          occurredAt: ARRIVED_AT,
          courierId: COURIER_ID,
        },
        {
          id: 'evt-pickup-1',
          type: EnumDeliveryEventType.PICKED_UP,
          occurredAt: PICKED_UP_AT,
          courierId: COURIER_ID,
        },
      ]),
      findWaitPaidMessages: jest.fn().mockResolvedValue([]),
      findLatestJobStepOccurredAt: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<DeliveryEventRepository>

    mockTaskScheduler = { scheduleTask: jest.fn() } as unknown as jest.Mocked<TaskBusScheduler>
    mockTaskBusService = {
      registerTaskHandler: jest.fn(),
      scheduleTask: jest.fn(),
    } as unknown as jest.Mocked<TaskBusService>

    mockPartnerWebhookService = {
      sendDeliveryUpdatePartnerWebhook: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<PartnerWebhookService>

    mockDeliveryMatchingService = {
      findCourierForDelivery: jest.fn().mockResolvedValue({
        courier: courierEntity,
        delivery: { readyAt: null, foodReadyAt: null, undispatchedAt: null },
        pickupLocation: { latitude: 39.36, longitude: 22.94 },
      }),
    } as unknown as jest.Mocked<DeliveryMatchingService>

    mockDeliveryCalculationService = {
      calculateDeliveryAmountsForMatchedCourier: jest.fn().mockResolvedValue({
        totalCost: 1000,
        totalCompensation: 800,
        fee: 200,
        feePercentage: 20,
      }),
    } as unknown as jest.Mocked<DeliveryCalculationService>

    mockBullMQService = {
      addJob: jest.fn().mockResolvedValue(undefined),
      addRepeatableJob: jest.fn(),
      removeDelayedJobsWithIdPrefix: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<BullMQService>

    mockConfigDomainService = {
      instanceConfig: {
        getWaitPayEnabled: jest.fn().mockResolvedValue(true),
        getWaitPayFreeMinutes: jest.fn().mockResolvedValue(5),
        getWaitPayCentsPerMinute: jest.fn().mockResolvedValue(10),
        getWaitLimitMinutes: jest.fn().mockResolvedValue(10),
        getOfferTimingEnabled: jest.fn().mockResolvedValue(false),
        getOfferLeadMinutes: jest.fn().mockResolvedValue(3),
        getOfferExpiryEnabled: jest.fn().mockResolvedValue(false),
        getOfferExpirySeconds: jest.fn().mockResolvedValue(60),
        getNoCourierRetrySeconds: jest.fn().mockResolvedValue(30),
        getHandBackSeconds: jest.fn().mockResolvedValue(60),
        getCancellationPayoutPolicy: jest.fn().mockResolvedValue('FULL_COMPENSATION'),
      },
    }

    mockCacheService = {
      getOrDefault: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockImplementation(async () => {
        callOrder.push('cacheService.save')
      }),
    } as unknown as jest.Mocked<CacheService>

    mockOfferPushService = {
      newOffer: jest.fn().mockResolvedValue(undefined),
      offerEnded: jest.fn().mockResolvedValue(undefined),
      jobCancelled: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<OfferPushService>

    mockDispatchStopRepository = {
      findOn: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<DispatchStopRepository>

    mockCourierCompensationRepository = {
      findWaitAwards: jest.fn().mockResolvedValue([]),
      createWaitPayOnce: jest.fn().mockImplementation(async (data) => {
        callOrder.push('courierCompensationRepository.createWaitPayOnce')
        return { id: 'comp-wait-1', ...data }
      }),
    } as unknown as jest.Mocked<CourierCompensationRepository>

    mockPartnerChargeRepository = {
      createWaitChargeOnce: jest.fn().mockImplementation(async (data) => {
        callOrder.push('partnerChargeRepository.createWaitChargeOnce')
        return { id: 'charge-wait-1', ...data }
      }),
    } as unknown as jest.Mocked<PartnerChargeRepository>

    service = new DeliveryEventService(
      mockConfigService,
      mockWebsocketDispatcher,
      mockCourierRepository,
      mockDeliveryRepository,
      mockDeliveryEventRepository,
      mockTaskScheduler,
      mockTaskBusService,
      mockPartnerWebhookService,
      mockDeliveryMatchingService,
      mockDeliveryCalculationService,
      mockBullMQService,
      mockConfigDomainService,
      mockCacheService,
      mockOfferPushService,
      mockDispatchStopRepository,
      { getRoute: jest.fn() } as any,
      mockCourierCompensationRepository,
      mockPartnerChargeRepository
    )
  })

  describe('settleWaitPay & finishWaitPayment (AC-3, AC-4, AC-8)', () => {
    it('creates compensation row, COURIER_PAID_FOR_WAIT event, and partner charge agreeing on amount, and clears waitPayOwedAt', async () => {
      // 10 minutes wait at 10 cents/min = 100 cents
      await service.settleWaitPay(DELIVERY_ID)

      const expectedWaitOf = waitOfKey(DELIVERY_ID, 'evt-pickup-1')

      // 1. CourierCompensation row
      expect(mockCourierCompensationRepository.createWaitPayOnce).toHaveBeenCalledWith({
        amount: 100,
        currencyCode: 'EUR',
        reason: EnumCourierCompensationReason.WAITING,
        policy: 'WAIT_PAY',
        message: 'Waited 10 min at 10 cents a minute',
        courierId: COURIER_ID,
        deliveryId: DELIVERY_ID,
        waitOf: expectedWaitOf,
      })

      // 2. COURIER_PAID_FOR_WAIT delivery event
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.COURIER_PAID_FOR_WAIT,
          courierId: COURIER_ID,
          actor: EnumEventActor.SYSTEM,
          eventSource: EnumDeliveryEventSource.OPENCOURIER,
          message: expect.stringContaining(`Courier ${COURIER_ID} paid 100 EUR (cents)`),
        })
      )
      // Must include waitOf in the event message
      const eventCall = mockDeliveryEventRepository.create.mock.calls.find(
        (c) => c[0].type === EnumDeliveryEventType.COURIER_PAID_FOR_WAIT
      )
      expect(eventCall?.[0].message).toContain(`wait ${expectedWaitOf}`)

      // 3. PartnerCharge row
      expect(mockPartnerChargeRepository.createWaitChargeOnce).toHaveBeenCalledWith({
        partnerId: PARTNER_ID,
        deliveryId: DELIVERY_ID,
        amount: 100,
        currencyCode: 'EUR',
        reason: EnumPartnerChargeReason.WAITING,
        waitOf: expectedWaitOf,
      })

      // 4. waitPayOwedAt cleared via conditional write matching the read timestamp
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        DELIVERY_ID,
        { waitPayOwedAt: baseDelivery.waitPayOwedAt },
        { waitPayOwedAt: null }
      )
    })

    it('is idempotent: each piece is written once when settleWaitPay runs twice', async () => {
      // First run: writes compensation, event, charge
      const expectedWaitOf = waitOfKey(DELIVERY_ID, 'evt-pickup-1')
      const existingAward = {
        id: 'comp-wait-1',
        amount: 100,
        currencyCode: 'EUR',
        reason: EnumCourierCompensationReason.WAITING,
        policy: 'WAIT_PAY',
        message: 'Waited 10 min at 10 cents a minute',
        courierId: COURIER_ID,
        deliveryId: DELIVERY_ID,
        waitOf: expectedWaitOf,
      } as any

      await service.settleWaitPay(DELIVERY_ID)

      expect(mockCourierCompensationRepository.createWaitPayOnce).toHaveBeenCalledTimes(1)
      expect(mockPartnerChargeRepository.createWaitChargeOnce).toHaveBeenCalledTimes(1)

      // Simulate second run: award already exists in repository, paid message exists
      mockCourierCompensationRepository.findWaitAwards.mockResolvedValueOnce([existingAward])
      mockDeliveryEventRepository.findWaitPaidMessages.mockResolvedValueOnce([
        `Courier ${COURIER_ID} paid 100 EUR (cents); wait ${expectedWaitOf}`,
      ])

      // Clear call counts
      mockCourierCompensationRepository.createWaitPayOnce.mockClear()
      mockPartnerChargeRepository.createWaitChargeOnce.mockClear()
      mockDeliveryEventRepository.create.mockClear()

      await service.settleWaitPay(DELIVERY_ID)

      // Second run must NOT create duplicate compensation, event, or partner charge
      expect(mockCourierCompensationRepository.createWaitPayOnce).not.toHaveBeenCalled()
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalled()
      // PartnerChargeRepository.createWaitChargeOnce uses unique constraint on waitOf
      expect(mockPartnerChargeRepository.createWaitChargeOnce).toHaveBeenCalledTimes(1)
    })

    it('a half-written payment (compensation written, event and charge missing) is completed', async () => {
      const expectedWaitOf = waitOfKey(DELIVERY_ID, 'evt-pickup-1')
      const existingAward = {
        id: 'comp-wait-1',
        amount: 100,
        currencyCode: 'EUR',
        reason: EnumCourierCompensationReason.WAITING,
        policy: 'WAIT_PAY',
        message: 'Waited 10 min at 10 cents a minute',
        courierId: COURIER_ID,
        deliveryId: DELIVERY_ID,
        waitOf: expectedWaitOf,
      } as any

      // Award exists, but event and partner charge were not written yet
      mockCourierCompensationRepository.findWaitAwards.mockResolvedValueOnce([existingAward])
      mockDeliveryEventRepository.findWaitPaidMessages.mockResolvedValueOnce([])

      await service.settleWaitPay(DELIVERY_ID)

      // Did not create compensation again
      expect(mockCourierCompensationRepository.createWaitPayOnce).not.toHaveBeenCalled()
      // Wrote the missing event and partner charge
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.COURIER_PAID_FOR_WAIT })
      )
      expect(mockPartnerChargeRepository.createWaitChargeOnce).toHaveBeenCalledWith(
        expect.objectContaining({ waitOf: expectedWaitOf, amount: 100 })
      )
    })

    it('a rate of 0 at settle writes no award, event or charge and does clear the stamp (decision 23.10)', async () => {
      mockConfigDomainService.instanceConfig.getWaitPayCentsPerMinute.mockResolvedValue(0)

      // waitPayOwedAt was set when the wait ended, but at settle time rate is 0
      mockDeliveryRepository.findById.mockResolvedValue({
        ...baseDelivery,
        waitPayOwedAt: baseDelivery.waitPayOwedAt,
      })

      await service.settleWaitPay(DELIVERY_ID)

      // Writes no award, no COURIER_PAID_FOR_WAIT event, and no partner charge
      expect(mockCourierCompensationRepository.createWaitPayOnce).not.toHaveBeenCalled()
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalled()
      expect(mockPartnerChargeRepository.createWaitChargeOnce).not.toHaveBeenCalled()

      // But clears the waitPayOwedAt stamp so it does not loop forever
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        DELIVERY_ID,
        { waitPayOwedAt: baseDelivery.waitPayOwedAt },
        { waitPayOwedAt: null }
      )
    })

    it('switch off at settle but stamp set (pay earned while on): still pays', async () => {
      // Delay pay was switched off after the wait earned pay (waitPayOwedAt already set)
      mockConfigDomainService.instanceConfig.getWaitPayEnabled.mockResolvedValue(false)
      mockDeliveryRepository.findById.mockResolvedValue({
        ...baseDelivery,
        waitPayOwedAt: baseDelivery.waitPayOwedAt,
      })

      await service.settleWaitPay(DELIVERY_ID)

      const expectedWaitOf = waitOfKey(DELIVERY_ID, 'evt-pickup-1')

      // Still pays the earned compensation
      expect(mockCourierCompensationRepository.createWaitPayOnce).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 100,
          courierId: COURIER_ID,
          waitOf: expectedWaitOf,
        })
      )
      // Emits the paid event
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.COURIER_PAID_FOR_WAIT,
          courierId: COURIER_ID,
        })
      )
      // Writes the partner charge
      expect(mockPartnerChargeRepository.createWaitChargeOnce).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 100,
          waitOf: expectedWaitOf,
        })
      )
      // Clears the stamp
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        DELIVERY_ID,
        { waitPayOwedAt: baseDelivery.waitPayOwedAt },
        { waitPayOwedAt: null }
      )
    })

    it('settleWaitPay with waitPayOwedAt set and no end event on the trail: no award, no charge, no clearing write, an error is logged, it resolves', async () => {
      const loggerErrorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation()

      // Trail has only ARRIVED event; PICKED_UP or WAIT_UNDISPATCHED is missing from trail
      mockDeliveryEventRepository.findWaitEvents.mockResolvedValue([
        {
          id: 'evt-arr-1',
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          occurredAt: ARRIVED_AT,
          courierId: COURIER_ID,
        },
      ] as any)

      await expect(service.settleWaitPay(DELIVERY_ID)).resolves.toBeUndefined()

      // No award, no charge, no event
      expect(mockCourierCompensationRepository.createWaitPayOnce).not.toHaveBeenCalled()
      expect(mockPartnerChargeRepository.createWaitChargeOnce).not.toHaveBeenCalled()
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalled()

      // No clearing write: waitPayOwedAt stamp stays set
      expect(mockDeliveryRepository.updateIfMatches).not.toHaveBeenCalledWith(
        DELIVERY_ID,
        expect.anything(),
        { waitPayOwedAt: null }
      )

      // Logs error for audit visibility and sweep retry
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('WAIT_PAY_NOT_ON_TRAIL')
      )
    })

    it('with an earlier unpaid wait on the trail and the newest end event missing: that earlier wait is not newly paid and the stamp stays', async () => {
      const loggerErrorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation()

      // Trail: Rider 1 arrived and left (earlier wait, 10 min, unpaid).
      // Rider 2 arrived, but newest end event has no arrival / earned no minutes so it cannot be completed.
      const atTime = (h: number, m: number) => new Date(Date.UTC(2026, 10, 9, h, m))
      const events = [
        {
          id: 'evt-arr-1',
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          occurredAt: atTime(9, 58),
          courierId: 'courier-1',
        },
        {
          id: 'evt-leave-1',
          type: EnumDeliveryEventType.WAIT_UNDISPATCHED,
          occurredAt: atTime(10, 15),
          courierId: 'courier-1',
        },
        // Rider 2 newest end event: picked up without arrival (so completed wait for newest end is missing)
        {
          id: 'evt-pickup-2',
          type: EnumDeliveryEventType.PICKED_UP,
          occurredAt: atTime(10, 35),
          courierId: 'courier-2',
        },
      ]
      mockDeliveryEventRepository.findWaitEvents.mockResolvedValue(events as any)
      // Earlier wait was unpaid (no existing awards in repository)
      mockCourierCompensationRepository.findWaitAwards.mockResolvedValue([])

      await service.settleWaitPay(DELIVERY_ID)

      // That earlier wait is not newly paid!
      expect(mockCourierCompensationRepository.createWaitPayOnce).not.toHaveBeenCalled()
      expect(mockPartnerChargeRepository.createWaitChargeOnce).not.toHaveBeenCalled()

      // And the stamp stays (clearing write is NOT called)
      expect(mockDeliveryRepository.updateIfMatches).not.toHaveBeenCalledWith(
        DELIVERY_ID,
        expect.anything(),
        { waitPayOwedAt: null }
      )
      expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining('WAIT_PAY_NOT_ON_TRAIL'))
    })

    it('with an earlier paid wait on the trail and the newest end event missing: that earlier wait is not newly paid and the stamp stays', async () => {
      const loggerErrorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation()

      const atTime = (h: number, m: number) => new Date(Date.UTC(2026, 10, 9, h, m))
      const events = [
        {
          id: 'evt-arr-1',
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          occurredAt: atTime(9, 58),
          courierId: 'courier-1',
        },
        {
          id: 'evt-leave-1',
          type: EnumDeliveryEventType.WAIT_UNDISPATCHED,
          occurredAt: atTime(10, 15),
          courierId: 'courier-1',
        },
        {
          id: 'evt-pickup-2',
          type: EnumDeliveryEventType.PICKED_UP,
          occurredAt: atTime(10, 35),
          courierId: 'courier-2',
        },
      ]
      mockDeliveryEventRepository.findWaitEvents.mockResolvedValue(events as any)
      // Earlier wait was already paid
      mockCourierCompensationRepository.findWaitAwards.mockResolvedValue([
        {
          id: 'comp-wait-1',
          amount: 100,
          currencyCode: 'EUR',
          reason: EnumCourierCompensationReason.WAITING,
          policy: 'WAIT_PAY',
          courierId: 'courier-1',
          deliveryId: DELIVERY_ID,
          waitOf: waitOfKey(DELIVERY_ID, 'evt-leave-1'),
        } as any,
      ])

      await service.settleWaitPay(DELIVERY_ID)

      // Earlier wait is not newly paid
      expect(mockCourierCompensationRepository.createWaitPayOnce).not.toHaveBeenCalled()

      // And the stamp stays (clearing write is NOT called)
      expect(mockDeliveryRepository.updateIfMatches).not.toHaveBeenCalledWith(
        DELIVERY_ID,
        expect.anything(),
        { waitPayOwedAt: null }
      )
      expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining('WAIT_PAY_NOT_ON_TRAIL'))
    })

    it('waitPayOwedAt is not cleared if delivery does not have waitPayOwedAt set', async () => {
      mockDeliveryRepository.findById.mockResolvedValue({
        ...baseDelivery,
        waitPayOwedAt: null,
      })

      await service.settleWaitPay(DELIVERY_ID)

      expect(mockDeliveryRepository.updateIfMatches).not.toHaveBeenCalled()
    })

    it('settleWaitPay never throws: repository failure resolves cleanly, leaves waitPayOwedAt set without clearing write, and logs error (AC-8)', async () => {
      const loggerErrorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation()
      mockCourierCompensationRepository.createWaitPayOnce.mockRejectedValue(new Error('DB failure'))

      await expect(service.settleWaitPay(DELIVERY_ID)).resolves.toBeUndefined()

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('WAIT_PAY_SETTLE_FAILED'),
        expect.anything()
      )
      // Clearing write (updateIfMatches setting waitPayOwedAt to null) was NOT called
      expect(mockDeliveryRepository.updateIfMatches).not.toHaveBeenCalledWith(
        DELIVERY_ID,
        { waitPayOwedAt: expect.anything() },
        { waitPayOwedAt: null }
      )
    })

    it('a wait that ended while pay was off is not paid when a later wait settles (decision 23.9)', async () => {
      // First wait ended at 10:15 (e.g. while pay was off, so not paid).
      // Second wait ended at 10:30 (when pay is on).
      // Only the newest wait (at 10:30) can start a payment!
      const waitEvents = [
        // Wait 1: rider 1 arrived 09:58, left 10:15 (10 min)
        {
          id: 'evt-arr-1',
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          occurredAt: at(9, 58),
          courierId: 'courier-1',
        },
        {
          id: 'evt-leave-1',
          type: EnumDeliveryEventType.WAIT_UNDISPATCHED,
          occurredAt: at(10, 15),
          courierId: 'courier-1',
        },
        // Wait 2: rider 2 arrived 10:20, picked up 10:30 (10 min)
        {
          id: 'evt-arr-2',
          type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
          occurredAt: at(10, 20),
          courierId: 'courier-2',
        },
        {
          id: 'evt-pickup-2',
          type: EnumDeliveryEventType.PICKED_UP,
          occurredAt: at(10, 30),
          courierId: 'courier-2',
        },
      ]
      mockDeliveryEventRepository.findWaitEvents.mockResolvedValue(waitEvents as any)

      await service.settleWaitPay(DELIVERY_ID)

      // Only newest wait ('evt-pickup-2') is paid, NOT 'evt-leave-1'
      expect(mockCourierCompensationRepository.createWaitPayOnce).toHaveBeenCalledTimes(1)
      expect(mockCourierCompensationRepository.createWaitPayOnce).toHaveBeenCalledWith(
        expect.objectContaining({
          waitOf: waitOfKey(DELIVERY_ID, 'evt-pickup-2'),
          courierId: 'courier-2',
        })
      )
    })

    it('a +10 delay (READY_DELAYED) does not reduce the wait pay because promisedReadyAt does not move (decision 23.6)', async () => {
      // Even if readyAt was delayed by +10 min (readyAt becomes 10:10),
      // promisedReadyAt remains 10:00.
      // Arrival: 09:58, pickup: 10:15.
      // Wait is calculated against promisedReadyAt (10:00 + 5 min = 10:05), so paid minutes = 10 (not 0!).
      mockDeliveryRepository.findById.mockResolvedValue({
        ...baseDelivery,
        promisedReadyAt: PROMISED_READY_AT, // 10:00
        readyAt: new Date('2026-11-09T10:10:00.000Z'), // delayed +10 min
      })

      await service.settleWaitPay(DELIVERY_ID)

      expect(mockCourierCompensationRepository.createWaitPayOnce).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 100, // 10 min * 10 cents = 100 cents
          message: 'Waited 10 min at 10 cents a minute',
        })
      )
    })

    it('a cancellation after a paid wait does not take the pay back (AC-8)', async () => {
      // Settle cancellation should not delete or touch WAITING compensation rows
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        ...baseDelivery,
        status: EnumDeliveryStatus.CANCELED,
        cancelledAt: new Date(),
        cancelledBy: EnumCancelledBy.RESTAURANT,
        cancelledFromStatus: EnumDeliveryStatus.PICKED_UP,
      })

      await service.settleCancellation(DELIVERY_ID)

      // Payout util computes cancellation award (which is distinct with reason CANCELLATION)
      // WAITING compensation is NOT touched or deleted
      expect(mockCourierCompensationRepository.createWaitPayOnce).not.toHaveBeenCalled()
    })
  })

  describe('leaveWait (AC-6)', () => {
    const OCCURRED_AT = new Date('2026-11-09T10:15:00.000Z')

    it('happy path: skip list first, conditional write, WAIT_UNDISPATCHED event with courierId, notifies partner and courier, calls offerOrWait, returns true', async () => {
      const delivery = { ...baseDelivery }
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(true)
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        ...delivery,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId: null,
        undispatchedAt: OCCURRED_AT,
      })
      const offerOrWaitSpy = jest.spyOn(service as any, 'offerOrWait').mockResolvedValue(undefined)

      const result = await service.leaveWait(delivery, COURIER_ID, OCCURRED_AT)

      expect(result).toBe(true)

      // 1. Skip list first
      expect(callOrder[0]).toBe('cacheService.save')

      // 2. ONE updateIfMatches with ASSIGNING_COURIER, clearing courierId, arrivedAtPickupAt, etc.
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        DELIVERY_ID,
        {
          status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
          courierId: COURIER_ID,
        },
        {
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          courierId: null,
          matchedCourierId: null,
          offeredAt: null,
          offerExpiresAt: null,
          acceptedAt: null,
          handBackUntil: null,
          arrivedAtPickupAt: null,
          undispatchedAt: OCCURRED_AT,
          waitPayOwedAt: expect.any(Date),
        }
      )

      // 3. WAIT_UNDISPATCHED event saved with transitionSuccessful: true, naming courierId
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: DELIVERY_ID,
          type: EnumDeliveryEventType.WAIT_UNDISPATCHED,
          courierId: COURIER_ID,
          actor: EnumEventActor.COURIER,
          eventSource: EnumDeliveryEventSource.OPENCOURIER,
          occurredAt: OCCURRED_AT,
        })
      )

      // 4. Partner and courier notified
      expect(mockPartnerWebhookService.sendDeliveryUpdatePartnerWebhook).toHaveBeenCalled()
      expect(mockWebsocketDispatcher.dispatchDeliveryStatusUpdated).toHaveBeenCalledWith(
        courierEntity.userId,
        EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
        EnumDeliveryStatus.ASSIGNING_COURIER,
        expect.anything()
      )

      // 5. settleWaitPay called
      expect(mockCourierCompensationRepository.createWaitPayOnce).toHaveBeenCalled()

      // 6. offerOrWait must run after a successful leave (AC-6, AC-7)
      expect(offerOrWaitSpy).toHaveBeenCalledWith(DELIVERY_ID)
    })

    it('after leaving, offerOrWait failure is logged and does not change the result true (AC-6, AC-7)', async () => {
      const delivery = { ...baseDelivery }
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(true)
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        ...delivery,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId: null,
        undispatchedAt: OCCURRED_AT,
      })
      const loggerErrorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation()
      const offerOrWaitSpy = jest.spyOn(service as any, 'offerOrWait').mockRejectedValue(new Error('offerOrWait error'))

      const result = await service.leaveWait(delivery, COURIER_ID, OCCURRED_AT)

      expect(result).toBe(true)
      expect(offerOrWaitSpy).toHaveBeenCalledWith(DELIVERY_ID)
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Could not start matching after the rider left delivery ${DELIVERY_ID}`)
      )
    })

    it('with delay pay off (AC-1), leaveWait past free minutes does not stamp waitPayOwedAt and writes no pay row, event, or charge', async () => {
      mockConfigDomainService.instanceConfig.getWaitPayEnabled.mockResolvedValue(false)
      const delivery = { ...baseDelivery }
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(true)
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        ...delivery,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId: null,
        undispatchedAt: OCCURRED_AT,
      })

      const result = await service.leaveWait(delivery, COURIER_ID, OCCURRED_AT)

      expect(result).toBe(true)
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        DELIVERY_ID,
        {
          status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
          courierId: COURIER_ID,
        },
        expect.not.objectContaining({
          waitPayOwedAt: expect.anything(),
        })
      )
      expect(mockCourierCompensationRepository.createWaitPayOnce).not.toHaveBeenCalled()
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.COURIER_PAID_FOR_WAIT })
      )
      expect(mockPartnerChargeRepository.createWaitChargeOnce).not.toHaveBeenCalled()
    })

    it('with wait pay rate of 0 (decision 23.10), leaveWait past free minutes does not stamp waitPayOwedAt and writes nothing', async () => {
      mockConfigDomainService.instanceConfig.getWaitPayCentsPerMinute.mockResolvedValue(0)
      const delivery = { ...baseDelivery }
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(true)
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        ...delivery,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        courierId: null,
        undispatchedAt: OCCURRED_AT,
      })

      const result = await service.leaveWait(delivery, COURIER_ID, OCCURRED_AT)

      expect(result).toBe(true)
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        DELIVERY_ID,
        {
          status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
          courierId: COURIER_ID,
        },
        expect.not.objectContaining({
          waitPayOwedAt: expect.anything(),
        })
      )
      expect(mockCourierCompensationRepository.createWaitPayOnce).not.toHaveBeenCalled()
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.COURIER_PAID_FOR_WAIT })
      )
      expect(mockPartnerChargeRepository.createWaitChargeOnce).not.toHaveBeenCalled()
    })

    it('lost race: removes rider from skip list, saves failed WAIT_UNDISPATCHED event, notifies nobody, offerOrWait does not run, returns false', async () => {
      const delivery = { ...baseDelivery }
      // Conditional write returns false because status changed
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(false)

      const result = await service.leaveWait(delivery, COURIER_ID, OCCURRED_AT)

      expect(result).toBe(false)

      // Removed from skip list
      expect(mockCacheService.save).toHaveBeenCalledTimes(2)

      // Failed event saved with transitionSuccessful: false
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.WAIT_UNDISPATCHED,
          courierId: COURIER_ID,
          message: 'Leaving refused: the order changed first',
        })
      )

      // Nobody notified
      expect(mockPartnerWebhookService.sendDeliveryUpdatePartnerWebhook).not.toHaveBeenCalled()
      expect(mockWebsocketDispatcher.dispatchDeliveryStatusUpdated).not.toHaveBeenCalled()
    })
  })

  describe('processDeliveryEvent refuses WAIT_UNDISPATCHED (AC-6)', () => {
    it('throws CantUpdateDeliveryStatusError and records a failed transition without changing status', async () => {
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        ...baseDelivery,
        status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
      })

      await service.processDeliveryEvent({
        deliveryId: DELIVERY_ID,
        type: EnumDeliveryEventType.WAIT_UNDISPATCHED,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
        courierId: COURIER_ID,
      })

      // Must record a failed transition row
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: DELIVERY_ID,
          type: EnumDeliveryEventType.WAIT_UNDISPATCHED,
          message: 'WAIT_UNDISPATCHED is recorded by a rider leaving only',
        })
      )

      // Status was NOT updated
      expect(mockDeliveryRepository.updateIfMatches).not.toHaveBeenCalled()
    })
  })

  describe('Hold after rider left (AC-7 & decision 23.12, 23.13)', () => {
    it('order left by rider (undispatchedAt set) is held with Timed offers off until readyAt less offerLeadMinutes', async () => {
      // Timed offers OFF
      mockConfigDomainService.instanceConfig.getOfferTimingEnabled.mockResolvedValue(false)
      mockConfigDomainService.instanceConfig.getOfferLeadMinutes.mockResolvedValue(3)
      mockConfigDomainService.instanceConfig.getNoCourierRetrySeconds.mockResolvedValue(300)

      const now = new Date('2026-11-09T10:00:00.000Z').getTime()
      jest.useFakeTimers().setSystemTime(now)

      // readyAt 5 min in future (10:05), lead 3 min -> dueInMs = (5 - 3) * 60_000 = 120_000 ms
      const futureReadyAt = new Date(now + 5 * 60_000)

      const match = {
        courier: courierEntity,
        delivery: {
          readyAt: futureReadyAt,
          foodReadyAt: null,
          undispatchedAt: new Date(now - 60_000), // Rider left 1 min ago
        },
        pickupLocation: { latitude: 39.36, longitude: 22.94 },
      }

      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValue(match as any)
      mockDeliveryRepository.findById.mockResolvedValue({
        ...baseDelivery,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: null,
        courierId: null,
      })

      // offerToNextCourier should hold the delivery
      const outcome = await (service as any).offerToNextCourier(DELIVERY_ID)

      expect(outcome).toBe('NOT_DUE')
      // Scheduled a retry with delay pinned to dueInMs = 120_000 ms (AC-7)
      expect(mockBullMQService.addJob).toHaveBeenCalledWith(
        'no-courier-retry',
        expect.objectContaining({ deliveryId: DELIVERY_ID }),
        expect.objectContaining({
          delay: 120_000,
          jobId: expect.stringContaining(`no-courier-retry-${DELIVERY_ID}`),
        })
      )

      jest.useRealTimers()
    })

    it('held versus offered either side of readyAt less offerLeadMinutes (AC-7)', async () => {
      mockConfigDomainService.instanceConfig.getOfferTimingEnabled.mockResolvedValue(false)
      mockConfigDomainService.instanceConfig.getOfferLeadMinutes.mockResolvedValue(3)
      mockConfigDomainService.instanceConfig.getNoCourierRetrySeconds.mockResolvedValue(300)

      const now = new Date('2026-11-09T10:00:00.000Z').getTime()
      jest.useFakeTimers().setSystemTime(now)

      mockDeliveryRepository.findById.mockResolvedValue({
        ...baseDelivery,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: null,
        courierId: null,
      })
      mockDeliveryRepository.findByIdOrThrow.mockResolvedValue({
        ...baseDelivery,
        status: EnumDeliveryStatus.ASSIGNING_COURIER,
        matchedCourierId: null,
        courierId: null,
      })

      // Case 1: 4 minutes before readyAt (1 minute before lead threshold: 4 - 3 = 1 min > 0) -> HELD ('NOT_DUE')
      const heldMatch = {
        courier: courierEntity,
        delivery: {
          readyAt: new Date(now + 4 * 60_000),
          foodReadyAt: null,
          undispatchedAt: new Date(now - 60_000),
        },
        pickupLocation: { latitude: 39.36, longitude: 22.94 },
      }
      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValue(heldMatch as any)

      const heldOutcome = await (service as any).offerToNextCourier(DELIVERY_ID)
      expect(heldOutcome).toBe('NOT_DUE')
      expect(mockBullMQService.addJob).toHaveBeenCalledWith(
        'no-courier-retry',
        expect.objectContaining({ deliveryId: DELIVERY_ID }),
        expect.objectContaining({ delay: 60_000 })
      )

      // Case 2: 2 minutes before readyAt (1 minute past lead threshold: 2 - 3 = -1 min <= 0) -> OFFERED ('OFFERED')
      const offeredMatch = {
        courier: courierEntity,
        delivery: {
          readyAt: new Date(now + 2 * 60_000),
          foodReadyAt: null,
          undispatchedAt: new Date(now - 60_000),
        },
        pickupLocation: { latitude: 39.36, longitude: 22.94 },
      }
      mockDeliveryMatchingService.findCourierForDelivery.mockResolvedValue(offeredMatch as any)

      const offeredOutcome = await (service as any).offerToNextCourier(DELIVERY_ID)
      expect(offeredOutcome).toBe('OFFERED')

      jest.useRealTimers()
    })

    it('offerTimingOf pins dueInMs to readyAt less offerLeadMinutes when undispatchedAt is set (AC-7)', async () => {
      mockConfigDomainService.instanceConfig.getOfferTimingEnabled.mockResolvedValue(false)
      mockConfigDomainService.instanceConfig.getOfferLeadMinutes.mockResolvedValue(3)

      const now = new Date('2026-11-09T10:00:00.000Z').getTime()
      jest.useFakeTimers().setSystemTime(now)

      const match = {
        courier: courierEntity,
        delivery: {
          readyAt: new Date(now + 10 * 60_000),
          foodReadyAt: null,
          undispatchedAt: new Date(now - 60_000),
        },
        pickupLocation: { latitude: 39.36, longitude: 22.94 },
      }

      const timing = await (service as any).offerTimingOf(match)
      // 10 min readyAt - 3 min lead = 7 min = 420_000 ms
      expect(timing.dueInMs).toBe(7 * 60_000)

      jest.useRealTimers()
    })

    it('a left order with Timed offers ON uses road time and lead (no double hold)', async () => {
      mockConfigDomainService.instanceConfig.getOfferTimingEnabled.mockResolvedValue(true)
      mockConfigDomainService.instanceConfig.getOfferLeadMinutes.mockResolvedValue(3)

      const now = new Date('2026-11-09T10:00:00.000Z').getTime()
      jest.useFakeTimers().setSystemTime(now)

      const match = {
        courier: courierEntity,
        delivery: {
          readyAt: new Date(now + 20 * 60_000), // ready in 20 min
          foodReadyAt: null,
          undispatchedAt: new Date(now - 60_000), // rider left earlier
        },
        pickupLocation: { latitude: 39.36, longitude: 22.94 },
        travelSeconds: 300, // 5 min road travel time from matcher
      }

      const timing = await (service as any).offerTimingOf(match)
      // 20 min readyAt - 5 min travel - 3 min lead = 12 min due = 720_000 ms (no double hold)
      expect(timing.dueInMs).toBe(12 * 60_000)
      expect(timing.note).toContain('travel ~5 min')
      expect(timing.note).toContain('lead 3 min')

      jest.useRealTimers()
    })

    it('order left by rider with foodReadyAt set goes out immediately (dueInMs = 0)', async () => {
      mockConfigDomainService.instanceConfig.getOfferTimingEnabled.mockResolvedValue(false)

      const match = {
        courier: courierEntity,
        delivery: {
          readyAt: new Date(Date.now() + 10 * 60_000),
          foodReadyAt: new Date(), // Food ready marked!
          undispatchedAt: new Date(Date.now() - 60_000),
        },
        pickupLocation: { latitude: 39.36, longitude: 22.94 },
      }

      const timing = await (service as any).offerTimingOf(match)
      expect(timing.dueInMs).toBe(0)
    })

    it('order left by rider with no readyAt at all goes out immediately (dueInMs = 0, decision 23.12)', async () => {
      mockConfigDomainService.instanceConfig.getOfferTimingEnabled.mockResolvedValue(false)

      const match = {
        courier: courierEntity,
        delivery: {
          readyAt: null, // No ready time
          foodReadyAt: null,
          undispatchedAt: new Date(Date.now() - 60_000),
        },
        pickupLocation: { latitude: 39.36, longitude: 22.94 },
      }

      const timing = await (service as any).offerTimingOf(match)
      expect(timing.dueInMs).toBe(0)
    })

    it('undispatchedAt is cleared on ACCEPTED', async () => {
      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce({
          ...baseDelivery,
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: COURIER_ID,
          courierId: null,
          undispatchedAt: new Date(),
        })
        .mockResolvedValueOnce({
          ...baseDelivery,
          status: EnumDeliveryStatus.ACCEPTED,
          courierId: COURIER_ID,
          undispatchedAt: null,
        })

      await service.processDeliveryEvent({
        deliveryId: DELIVERY_ID,
        type: EnumDeliveryEventType.ACCEPTED,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
        courierId: COURIER_ID,
      })

      // updateIfMatches clears undispatchedAt to null
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        DELIVERY_ID,
        { status: EnumDeliveryStatus.ASSIGNING_COURIER },
        expect.objectContaining({
          status: EnumDeliveryStatus.ACCEPTED,
          courierId: COURIER_ID,
          undispatchedAt: null,
        })
      )
    })
  })

  describe('Audit Event Courier ID Storage & Status Step Fields', () => {
    it('PICKED_UP event stores the rider in courierId column and stamps waitPayOwedAt if wait pay owed', async () => {
      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce({
          ...baseDelivery,
          status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
          courierId: COURIER_ID,
          arrivedAtPickupAt: ARRIVED_AT,
          promisedReadyAt: PROMISED_READY_AT,
        })
        .mockResolvedValueOnce({
          ...baseDelivery,
          status: EnumDeliveryStatus.PICKED_UP,
          courierId: COURIER_ID,
        })

      await service.processDeliveryEvent({
        deliveryId: DELIVERY_ID,
        type: EnumDeliveryEventType.PICKED_UP,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
        occurredAt: PICKED_UP_AT,
      })

      // updateDeliveryAndSendNotifications writes pickupReadyAt and waitPayOwedAt
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        DELIVERY_ID,
        { status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION },
        expect.objectContaining({
          status: EnumDeliveryStatus.PICKED_UP,
          pickupReadyAt: PICKED_UP_AT,
          waitPayOwedAt: expect.any(Date),
        })
      )

      // saveDeliveryEvent stored courierId for PICKED_UP
      expect(mockDeliveryEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.PICKED_UP,
          courierId: COURIER_ID,
        })
      )

      // settleWaitPay was called
      expect(mockCourierCompensationRepository.createWaitPayOnce).toHaveBeenCalled()
    })

    it('with delay pay off (AC-1), PICKED_UP past free minutes does not stamp waitPayOwedAt and writes no pay row, event, or charge', async () => {
      mockConfigDomainService.instanceConfig.getWaitPayEnabled.mockResolvedValue(false)
      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce({
          ...baseDelivery,
          status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
          courierId: COURIER_ID,
          arrivedAtPickupAt: ARRIVED_AT,
          promisedReadyAt: PROMISED_READY_AT,
        })
        .mockResolvedValueOnce({
          ...baseDelivery,
          status: EnumDeliveryStatus.PICKED_UP,
          courierId: COURIER_ID,
        })

      await service.processDeliveryEvent({
        deliveryId: DELIVERY_ID,
        type: EnumDeliveryEventType.PICKED_UP,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
        occurredAt: PICKED_UP_AT,
      })

      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        DELIVERY_ID,
        { status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION },
        expect.not.objectContaining({
          waitPayOwedAt: expect.anything(),
        })
      )
      expect(mockCourierCompensationRepository.createWaitPayOnce).not.toHaveBeenCalled()
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.COURIER_PAID_FOR_WAIT })
      )
      expect(mockPartnerChargeRepository.createWaitChargeOnce).not.toHaveBeenCalled()
    })

    it('with wait pay rate of 0 (decision 23.10), PICKED_UP past free minutes does not stamp waitPayOwedAt and writes nothing', async () => {
      mockConfigDomainService.instanceConfig.getWaitPayCentsPerMinute.mockResolvedValue(0)
      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce({
          ...baseDelivery,
          status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
          courierId: COURIER_ID,
          arrivedAtPickupAt: ARRIVED_AT,
          promisedReadyAt: PROMISED_READY_AT,
        })
        .mockResolvedValueOnce({
          ...baseDelivery,
          status: EnumDeliveryStatus.PICKED_UP,
          courierId: COURIER_ID,
        })

      await service.processDeliveryEvent({
        deliveryId: DELIVERY_ID,
        type: EnumDeliveryEventType.PICKED_UP,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
        occurredAt: PICKED_UP_AT,
      })

      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        DELIVERY_ID,
        { status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION },
        expect.not.objectContaining({
          waitPayOwedAt: expect.anything(),
        })
      )
      expect(mockCourierCompensationRepository.createWaitPayOnce).not.toHaveBeenCalled()
      expect(mockDeliveryEventRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: EnumDeliveryEventType.COURIER_PAID_FOR_WAIT })
      )
      expect(mockPartnerChargeRepository.createWaitChargeOnce).not.toHaveBeenCalled()
    })

    it('ARRIVED_AT_PICKUP_LOCATION sets arrivedAtPickupAt to occurredAt', async () => {
      mockDeliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce({
          ...baseDelivery,
          status: EnumDeliveryStatus.DISPATCHED,
          courierId: COURIER_ID,
        })
        .mockResolvedValueOnce({
          ...baseDelivery,
          status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
          courierId: COURIER_ID,
          arrivedAtPickupAt: ARRIVED_AT,
        })

      await service.processDeliveryEvent({
        deliveryId: DELIVERY_ID,
        type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION,
        actor: EnumEventActor.COURIER,
        source: EnumDeliveryEventSource.OPENCOURIER,
        courierId: COURIER_ID,
        occurredAt: ARRIVED_AT,
      })

      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        DELIVERY_ID,
        { status: EnumDeliveryStatus.DISPATCHED },
        expect.objectContaining({
          status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
          arrivedAtPickupAt: ARRIVED_AT,
        })
      )
    })
  })

  function at(hours: number, minutes: number): Date {
    return new Date(Date.UTC(2026, 10, 9, hours, minutes))
  }
})
