import { ConflictException } from '@nestjs/common'
import { EnumDeliveryEventSource, EnumDeliveryEventType, EnumDeliveryStatus, EnumEventActor } from '@prisma/types'
import { DeliveryDomainService } from './delivery.domain.service'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { PartnerRepository } from 'src/persistence/repositories/partner.repository'
import { READY_ACTION_STATUSES } from './ready-signals'

// Spec 0023: the ready time at creation (AC-1), "+5 / +10 / +15 min" (AC-3, AC-5) and "Food ready"
// (AC-4), as DeliveryDomainService runs them. Nothing here may touch pay, the quote or pickupReadyAt
// (AC-10), and only the restaurant's two actions write readyAt and foodReadyAt (AC-11).
describe('DeliveryDomainService ready signals (spec 0023)', () => {
  const MINUTE = 60 * 1000
  // 12:00 UTC on 3 November is 14:00 in Athens (winter time, UTC+2).
  const NOW = new Date('2026-11-03T12:00:00.000Z')
  const at = (minutesFromNow: number) => new Date(NOW.getTime() + minutesFromNow * MINUTE)

  let service: DeliveryDomainService
  // `any` so the recorded calls can be read without a type cast at every line.
  let deliveryRepository: any
  let deliveryEventService: any
  let partnerRepository: any
  let courierRepository: any
  let courierCompensationRepository: any
  let configDomainService: any
  let eventEmitter: any
  let cacheService: any

  const baseDelivery = (overrides: Record<string, unknown> = {}): any => ({
    id: 'del-1',
    status: EnumDeliveryStatus.DISPATCHED,
    partnerId: 'partner-1',
    courierId: 'courier-1',
    pickupBusinessName: 'R73 Kitchen',
    readyAt: at(8),
    foodReadyAt: null,
    pickupReadyAt: at(-30),
    createdAt: at(-10),
    ...overrides,
  })

  beforeEach(() => {
    // Modern fake timers freeze `new Date()` at NOW; awaited promises still resolve normally.
    jest.useFakeTimers('modern')
    jest.setSystemTime(NOW)

    deliveryRepository = {
      findByIdOrThrow: jest.fn(),
      updateIfMatches: jest.fn().mockResolvedValue(true),
      update: jest.fn(),
      create: jest.fn(),
    }

    deliveryEventService = {
      processDeliveryEvent: jest.fn().mockResolvedValue(undefined),
      recordReadyEvent: jest.fn().mockResolvedValue(undefined),
      notifyReadyUpdated: jest.fn().mockResolvedValue(undefined),
    }

    partnerRepository = {
      findById: jest.fn().mockResolvedValue(null),
    }

    // Pay, rider and setting writers: none of them may be used by the ready actions (AC-10).
    courierRepository = { update: jest.fn(), findByIdOrThrow: jest.fn() }
    courierCompensationRepository = { create: jest.fn(), deleteById: jest.fn() }
    configDomainService = {}
    eventEmitter = { emit: jest.fn() }
    cacheService = { getOrDefault: jest.fn(), save: jest.fn() }

    service = new DeliveryDomainService(
      deliveryRepository as DeliveryRepository,
      eventEmitter,
      cacheService,
      deliveryEventService as DeliveryEventService,
      courierRepository,
      courierCompensationRepository,
      configDomainService,
      partnerRepository as PartnerRepository
    )
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  // Every write the ready actions make, so AC-10 can be checked against the whole list.
  const expectNoOtherWrites = () => {
    expect(deliveryRepository.update).not.toHaveBeenCalled()
    expect(deliveryRepository.create).not.toHaveBeenCalled()
    expect(deliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
    expect(courierRepository.update).not.toHaveBeenCalled()
    expect(courierCompensationRepository.create).not.toHaveBeenCalled()
    expect(eventEmitter.emit).not.toHaveBeenCalled()
  }

  describe('create (AC-1)', () => {
    const input = (overrides: Record<string, unknown> = {}): any => ({
      partnerId: 'partner-1',
      pickupName: 'R73',
      pickupLocationId: 'loc-1',
      dropoffLocationId: 'loc-2',
      ...overrides,
    })

    beforeEach(() => {
      deliveryRepository.create.mockImplementation(async (data: any) => ({ id: 'del-new', ...data }))
    })

    const createdMessage = () => (deliveryEventService.processDeliveryEvent.mock.calls[0][0] as any).message as string

    test('no pickupReadyAt: readyAt is now plus the restaurant usualPrepMinutes, and the CREATED message names it in Athens time', async () => {
      partnerRepository.findById.mockResolvedValue({ id: 'partner-1', usualPrepMinutes: 25 } as any)

      await service.create(input())

      expect(partnerRepository.findById).toHaveBeenCalledWith('partner-1')
      const data = deliveryRepository.create.mock.calls[0][0] as any
      expect(data.readyAt.getTime()).toBe(at(25).getTime())
      expect(data.pickupReadyAt).toBeUndefined()
      expect(createdMessage().endsWith('ready at 14:25')).toBe(true)
      expect(deliveryEventService.processDeliveryEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-new',
          type: EnumDeliveryEventType.CREATED,
          actor: EnumEventActor.PARTNER,
          source: EnumDeliveryEventSource.PARTNER_APP,
        })
      )
    })

    test('a usual prep time of 0 makes readyAt the moment of creation', async () => {
      partnerRepository.findById.mockResolvedValue({ id: 'partner-1', usualPrepMinutes: 0 } as any)

      await service.create(input())

      const data = deliveryRepository.create.mock.calls[0][0] as any
      expect(data.readyAt.getTime()).toBe(NOW.getTime())
      expect(createdMessage().endsWith('ready at 14:00')).toBe(true)
    })

    test('no partner row: the usual prep time is 15 minutes', async () => {
      partnerRepository.findById.mockResolvedValue(null)

      await service.create(input())

      const data = deliveryRepository.create.mock.calls[0][0] as any
      expect(data.readyAt.getTime()).toBe(at(15).getTime())
      expect(createdMessage().endsWith('ready at 14:15')).toBe(true)
    })

    test('no partnerId at all: no partner lookup, 15 minutes', async () => {
      await service.create(input({ partnerId: undefined }))

      expect(partnerRepository.findById).not.toHaveBeenCalled()
      const data = deliveryRepository.create.mock.calls[0][0] as any
      expect(data.readyAt.getTime()).toBe(at(15).getTime())
    })

    test('a future pickupReadyAt is the readyAt, and pickupReadyAt is passed through unchanged', async () => {
      partnerRepository.findById.mockResolvedValue({ id: 'partner-1', usualPrepMinutes: 60 } as any)
      const pickupReadyAt = at(20)

      await service.create(input({ pickupReadyAt }))

      const data = deliveryRepository.create.mock.calls[0][0] as any
      expect(data.readyAt.getTime()).toBe(at(20).getTime())
      expect(data.pickupReadyAt).toBe(pickupReadyAt)
      expect(createdMessage().endsWith('ready at 14:20')).toBe(true)
    })

    test('a pickupReadyAt sent as an ISO string is read as that time', async () => {
      const pickupReadyAt = at(12).toISOString()

      await service.create(input({ pickupReadyAt }))

      const data = deliveryRepository.create.mock.calls[0][0] as any
      expect(data.readyAt.getTime()).toBe(at(12).getTime())
      expect(data.pickupReadyAt).toBe(pickupReadyAt)
    })

    test('a past pickupReadyAt makes readyAt the moment of creation; pickupReadyAt keeps its value', async () => {
      const pickupReadyAt = at(-40)

      await service.create(input({ pickupReadyAt }))

      const data = deliveryRepository.create.mock.calls[0][0] as any
      expect(data.readyAt.getTime()).toBe(NOW.getTime())
      expect(data.pickupReadyAt).toBe(pickupReadyAt)
      expect(createdMessage().endsWith('ready at 14:00')).toBe(true)
    })

    test('the rest of the input reaches the repository untouched, and no foodReadyAt is set', async () => {
      await service.create(input({ orderReference: 'R-1' }))

      const data = deliveryRepository.create.mock.calls[0][0] as any
      expect(data).toEqual(expect.objectContaining({ partnerId: 'partner-1', pickupName: 'R73', orderReference: 'R-1' }))
      expect(data.foodReadyAt).toBeUndefined()
    })
  })

  describe('delayReady (AC-3, AC-5)', () => {
    test('moves readyAt from a future readyAt by the minutes, with one conditional write on what was read', async () => {
      const delivery = baseDelivery({ readyAt: at(8) })
      const updated = baseDelivery({ readyAt: at(18) })
      deliveryRepository.findByIdOrThrow.mockResolvedValueOnce(delivery).mockResolvedValueOnce(updated)

      const result = await service.delayReady('del-1', 10, new Date(at(8)))

      expect(result).toBe(updated)
      expect(deliveryRepository.updateIfMatches).toHaveBeenCalledTimes(1)
      expect(deliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        'del-1',
        { readyAt: delivery.readyAt, foodReadyAt: null, status: { in: READY_ACTION_STATUSES } },
        { readyAt: at(18) }
      )
    })

    test('a readyAt already passed moves from now, never from the past', async () => {
      const delivery = baseDelivery({ readyAt: at(-12) })
      deliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)

      await service.delayReady('del-1', 5, new Date(at(-12)))

      const data = deliveryRepository.updateIfMatches.mock.calls[0][2] as any
      expect(data).toEqual({ readyAt: at(5) })
    })

    test('an old order with no readyAt and expectedReadyAt null moves from now', async () => {
      const delivery = baseDelivery({ readyAt: null })
      deliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)

      await service.delayReady('del-1', 15, null)

      expect(deliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        'del-1',
        { readyAt: null, foodReadyAt: null, status: { in: READY_ACTION_STATUSES } },
        { readyAt: at(15) }
      )
    })

    test('records exactly one READY_DELAYED event: actor PARTNER, source PARTNER_APP, "+N min, ready at HH:MM", status unchanged, no courierId', async () => {
      const delivery = baseDelivery({ readyAt: at(8), status: EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION })
      deliveryRepository.findByIdOrThrow.mockResolvedValue(delivery)

      await service.delayReady('del-1', 10, new Date(at(8)))

      expect(deliveryEventService.recordReadyEvent).toHaveBeenCalledTimes(1)
      const [event, status] = deliveryEventService.recordReadyEvent.mock.calls[0]
      expect(event).toEqual({
        deliveryId: 'del-1',
        type: EnumDeliveryEventType.READY_DELAYED,
        actor: EnumEventActor.PARTNER,
        source: EnumDeliveryEventSource.PARTNER_APP,
        message: '+10 min, ready at 14:18',
      })
      expect(event).not.toHaveProperty('courierId')
      expect(status).toBe(EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION)
      expect(deliveryEventService.processDeliveryEvent).not.toHaveBeenCalled()
    })

    test('the event is recorded after the write succeeds, and the rider is told after it, with the minutes', async () => {
      const delivery = baseDelivery()
      const updated = baseDelivery({ readyAt: at(13) })
      deliveryRepository.findByIdOrThrow.mockResolvedValueOnce(delivery).mockResolvedValueOnce(updated)

      await service.delayReady('del-1', 5, new Date(at(8)))

      const writeOrder = deliveryRepository.updateIfMatches.mock.invocationCallOrder[0]
      const eventOrder = deliveryEventService.recordReadyEvent.mock.invocationCallOrder[0]
      const notifyOrder = deliveryEventService.notifyReadyUpdated.mock.invocationCallOrder[0]
      expect(writeOrder).toBeLessThan(eventOrder)
      expect(eventOrder).toBeLessThan(notifyOrder)
      // The rider hears the delivery as it is after the write.
      expect(deliveryEventService.notifyReadyUpdated).toHaveBeenCalledWith(updated, 5)
    })

    test('writes only readyAt: never pickupReadyAt, status, pay fields or the quote (AC-10, AC-11)', async () => {
      deliveryRepository.findByIdOrThrow.mockResolvedValue(baseDelivery())

      await service.delayReady('del-1', 10, new Date(at(8)))

      const data = deliveryRepository.updateIfMatches.mock.calls[0][2] as any
      expect(Object.keys(data)).toEqual(['readyAt'])
      expectNoOtherWrites()
    })

    test('an expectedReadyAt that differs from readyAt is refused with "Look again", nothing written or recorded', async () => {
      deliveryRepository.findByIdOrThrow.mockResolvedValue(baseDelivery({ readyAt: at(18) }))

      const attempt = service.delayReady('del-1', 10, new Date(at(8)))

      await expect(attempt).rejects.toThrow(ConflictException)
      await expect(service.delayReady('del-1', 10, new Date(at(8)))).rejects.toThrow(
        'The ready time just changed. Look again.'
      )
      expect(deliveryRepository.updateIfMatches).not.toHaveBeenCalled()
      expect(deliveryEventService.recordReadyEvent).not.toHaveBeenCalled()
      expect(deliveryEventService.notifyReadyUpdated).not.toHaveBeenCalled()
    })

    test('two taps on the same time add once: the second, sent with the old time, is refused (never +20)', async () => {
      const first = baseDelivery({ readyAt: at(8) })
      const afterFirst = baseDelivery({ readyAt: at(18) })
      deliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(first) // first tap reads
        .mockResolvedValueOnce(afterFirst) // first tap reads back after its write
        .mockResolvedValueOnce(afterFirst) // second tap reads

      await service.delayReady('del-1', 10, new Date(at(8)))
      await expect(service.delayReady('del-1', 10, new Date(at(8)))).rejects.toThrow(
        'The ready time just changed. Look again.'
      )

      expect(deliveryRepository.updateIfMatches).toHaveBeenCalledTimes(1)
      expect(deliveryEventService.recordReadyEvent).toHaveBeenCalledTimes(1)
    })

    test('expectedReadyAt null while the delivery has a readyAt is refused with "Look again"', async () => {
      deliveryRepository.findByIdOrThrow.mockResolvedValue(baseDelivery({ readyAt: at(8) }))

      await expect(service.delayReady('del-1', 10, null)).rejects.toThrow('The ready time just changed. Look again.')
      expect(deliveryRepository.updateIfMatches).not.toHaveBeenCalled()
    })

    test('a readyAt set while expectedReadyAt is a time is refused when the delivery has none', async () => {
      deliveryRepository.findByIdOrThrow.mockResolvedValue(baseDelivery({ readyAt: null }))

      await expect(service.delayReady('del-1', 10, new Date(at(8)))).rejects.toThrow(
        'The ready time just changed. Look again.'
      )
      expect(deliveryRepository.updateIfMatches).not.toHaveBeenCalled()
    })

    test('food already marked ready is refused with its sentence, nothing written', async () => {
      deliveryRepository.findByIdOrThrow.mockResolvedValue(baseDelivery({ foodReadyAt: at(-1) }))

      await expect(service.delayReady('del-1', 10, new Date(at(8)))).rejects.toThrow(
        new ConflictException('The food is already marked ready.')
      )
      expect(deliveryRepository.updateIfMatches).not.toHaveBeenCalled()
      expect(deliveryEventService.recordReadyEvent).not.toHaveBeenCalled()
    })

    test.each([
      EnumDeliveryStatus.PICKED_UP,
      EnumDeliveryStatus.ON_THE_WAY,
      EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
    ])('%s is refused with the picked up sentence, nothing written', async (status) => {
      deliveryRepository.findByIdOrThrow.mockResolvedValue(baseDelivery({ status }))

      await expect(service.delayReady('del-1', 10, new Date(at(8)))).rejects.toThrow(
        new ConflictException('The rider has already picked this order up.')
      )
      expect(deliveryRepository.updateIfMatches).not.toHaveBeenCalled()
      expect(deliveryEventService.recordReadyEvent).not.toHaveBeenCalled()
    })

    test.each([EnumDeliveryStatus.DROPPED_OFF, EnumDeliveryStatus.CANCELED, EnumDeliveryStatus.FAILED])(
      '%s is refused with the ended sentence, nothing written',
      async (status) => {
        deliveryRepository.findByIdOrThrow.mockResolvedValue(baseDelivery({ status }))

        await expect(service.delayReady('del-1', 10, new Date(at(8)))).rejects.toThrow(
          new ConflictException('This order has ended.')
        )
        expect(deliveryRepository.updateIfMatches).not.toHaveBeenCalled()
        expect(deliveryEventService.recordReadyEvent).not.toHaveBeenCalled()
      }
    )

    test('a new time past createdAt + 180 min is refused with the 3 hour sentence, nothing written', async () => {
      // Created 175 min ago, ready now: +10 lands at 185 min after creation.
      deliveryRepository.findByIdOrThrow.mockResolvedValue(baseDelivery({ createdAt: at(-175), readyAt: NOW }))

      await expect(service.delayReady('del-1', 10, new Date(NOW))).rejects.toThrow(
        new ConflictException('A ready time can be at most 3 hours after the order was placed.')
      )
      expect(deliveryRepository.updateIfMatches).not.toHaveBeenCalled()
      expect(deliveryEventService.recordReadyEvent).not.toHaveBeenCalled()
    })

    test('a new time exactly createdAt + 180 min is allowed', async () => {
      deliveryRepository.findByIdOrThrow.mockResolvedValue(baseDelivery({ createdAt: at(-170), readyAt: NOW }))

      await service.delayReady('del-1', 10, new Date(NOW))

      expect(deliveryRepository.updateIfMatches.mock.calls[0][2]).toEqual({ readyAt: at(10) })
      expect(deliveryEventService.recordReadyEvent).toHaveBeenCalledTimes(1)
    })

    describe('the conditional write misses (something changed between read and write)', () => {
      beforeEach(() => {
        deliveryRepository.updateIfMatches.mockResolvedValue(false)
      })

      const missThenReread = (reread: any) => {
        deliveryRepository.findByIdOrThrow.mockResolvedValueOnce(baseDelivery()).mockResolvedValueOnce(reread)
      }

      const expectNothingRecorded = () => {
        expect(deliveryEventService.recordReadyEvent).not.toHaveBeenCalled()
        expect(deliveryEventService.notifyReadyUpdated).not.toHaveBeenCalled()
      }

      test('food marked ready meanwhile: "already marked ready", no event', async () => {
        missThenReread(baseDelivery({ foodReadyAt: NOW }))

        await expect(service.delayReady('del-1', 10, new Date(at(8)))).rejects.toThrow(
          'The food is already marked ready.'
        )
        expect(deliveryRepository.findByIdOrThrow).toHaveBeenCalledTimes(2)
        expectNothingRecorded()
      })

      test('picked up meanwhile: the picked up sentence, no event', async () => {
        missThenReread(baseDelivery({ status: EnumDeliveryStatus.PICKED_UP }))

        await expect(service.delayReady('del-1', 10, new Date(at(8)))).rejects.toThrow(
          'The rider has already picked this order up.'
        )
        expectNothingRecorded()
      })

      test('cancelled meanwhile: the ended sentence, no event', async () => {
        missThenReread(baseDelivery({ status: EnumDeliveryStatus.CANCELED }))

        await expect(service.delayReady('del-1', 10, new Date(at(8)))).rejects.toThrow('This order has ended.')
        expectNothingRecorded()
      })

      test('another delay landed meanwhile: "Look again", no event, no retry', async () => {
        missThenReread(baseDelivery({ readyAt: at(13) }))

        await expect(service.delayReady('del-1', 10, new Date(at(8)))).rejects.toThrow(
          new ConflictException('The ready time just changed. Look again.')
        )
        expect(deliveryRepository.updateIfMatches).toHaveBeenCalledTimes(1)
        expectNothingRecorded()
      })
    })
  })

  describe('markFoodReady (AC-4, AC-5)', () => {
    test('sets foodReadyAt to now with one conditional write, records one FOOD_READY event, then tells the rider', async () => {
      const delivery = baseDelivery({ status: EnumDeliveryStatus.ACCEPTED })
      const updated = baseDelivery({ status: EnumDeliveryStatus.ACCEPTED, foodReadyAt: NOW })
      deliveryRepository.findByIdOrThrow.mockResolvedValueOnce(delivery).mockResolvedValueOnce(updated)

      const result = await service.markFoodReady('del-1')

      expect(result).toBe(updated)
      expect(deliveryRepository.updateIfMatches).toHaveBeenCalledTimes(1)
      expect(deliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        'del-1',
        { foodReadyAt: null, status: { in: READY_ACTION_STATUSES } },
        { foodReadyAt: NOW }
      )
      expect(deliveryEventService.recordReadyEvent).toHaveBeenCalledTimes(1)
      const [event, status] = deliveryEventService.recordReadyEvent.mock.calls[0]
      expect(event).toEqual({
        deliveryId: 'del-1',
        type: EnumDeliveryEventType.FOOD_READY,
        actor: EnumEventActor.PARTNER,
        source: EnumDeliveryEventSource.PARTNER_APP,
        message: 'Food ready at 14:00',
      })
      expect(event).not.toHaveProperty('courierId')
      expect(status).toBe(EnumDeliveryStatus.ACCEPTED)
      expect(deliveryEventService.notifyReadyUpdated).toHaveBeenCalledWith(updated, null)
      expect(deliveryRepository.updateIfMatches.mock.invocationCallOrder[0]).toBeLessThan(
        deliveryEventService.recordReadyEvent.mock.invocationCallOrder[0]
      )
    })

    test('writes only foodReadyAt: never readyAt, pickupReadyAt, status, pay fields or the quote (AC-10, AC-11)', async () => {
      deliveryRepository.findByIdOrThrow.mockResolvedValue(baseDelivery())

      await service.markFoodReady('del-1')

      expect(Object.keys(deliveryRepository.updateIfMatches.mock.calls[0][2] as any)).toEqual(['foodReadyAt'])
      expectNoOtherWrites()
    })

    test('a repeat answers the delivery as it is: no write, no second event, no rider notice', async () => {
      const already = baseDelivery({ foodReadyAt: at(-2) })
      deliveryRepository.findByIdOrThrow.mockResolvedValue(already)

      const result = await service.markFoodReady('del-1')

      expect(result).toBe(already)
      expect(deliveryRepository.updateIfMatches).not.toHaveBeenCalled()
      expect(deliveryEventService.recordReadyEvent).not.toHaveBeenCalled()
      expect(deliveryEventService.notifyReadyUpdated).not.toHaveBeenCalled()
    })

    test('a write that lost the race to another food ready answers the delivery read again, with no event', async () => {
      const reread = baseDelivery({ foodReadyAt: NOW })
      deliveryRepository.updateIfMatches.mockResolvedValue(false)
      deliveryRepository.findByIdOrThrow.mockResolvedValueOnce(baseDelivery()).mockResolvedValueOnce(reread)

      const result = await service.markFoodReady('del-1')

      expect(result).toBe(reread)
      expect(deliveryEventService.recordReadyEvent).not.toHaveBeenCalled()
      expect(deliveryEventService.notifyReadyUpdated).not.toHaveBeenCalled()
    })

    test('a write that missed because the rider picked up meanwhile is refused with the picked up sentence', async () => {
      deliveryRepository.updateIfMatches.mockResolvedValue(false)
      deliveryRepository.findByIdOrThrow
        .mockResolvedValueOnce(baseDelivery())
        .mockResolvedValueOnce(baseDelivery({ status: EnumDeliveryStatus.ON_THE_WAY }))

      await expect(service.markFoodReady('del-1')).rejects.toThrow(
        new ConflictException('The rider has already picked this order up.')
      )
      expect(deliveryEventService.recordReadyEvent).not.toHaveBeenCalled()
    })

    test.each([
      EnumDeliveryStatus.PICKED_UP,
      EnumDeliveryStatus.ON_THE_WAY,
      EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
    ])('%s is refused with the picked up sentence, nothing written', async (status) => {
      deliveryRepository.findByIdOrThrow.mockResolvedValue(baseDelivery({ status }))

      await expect(service.markFoodReady('del-1')).rejects.toThrow(
        new ConflictException('The rider has already picked this order up.')
      )
      expect(deliveryRepository.updateIfMatches).not.toHaveBeenCalled()
      expect(deliveryEventService.recordReadyEvent).not.toHaveBeenCalled()
    })

    test.each([EnumDeliveryStatus.DROPPED_OFF, EnumDeliveryStatus.CANCELED, EnumDeliveryStatus.FAILED])(
      '%s is refused with the ended sentence, nothing written',
      async (status) => {
        deliveryRepository.findByIdOrThrow.mockResolvedValue(baseDelivery({ status }))

        await expect(service.markFoodReady('del-1')).rejects.toThrow(new ConflictException('This order has ended.'))
        expect(deliveryRepository.updateIfMatches).not.toHaveBeenCalled()
        expect(deliveryEventService.recordReadyEvent).not.toHaveBeenCalled()
      }
    )
  })
})
