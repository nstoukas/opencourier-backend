import { BadRequestException, ConflictException, ValidationPipe } from '@nestjs/common'
import {
  EnumCancelledBy,
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
  EnumFoodOutcome,
} from '@prisma/types'
import { CancelledJobsCourierService } from './cancelled-jobs.courier.service'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { DeliveryNotFoundException } from 'src/errors'
import { CancelledJobCourierDto } from './dtos/cancelled-job.courier.dto'
import { FoodOutcomeCourierInput } from './queries/food-outcome.courier.input'
import { DELIVERY_ONGOING_STATUSES } from 'src/shared-types'

describe('CancelledJobsCourierService (Spec 0015 AC-7, AC-8, AC-11, AC-12)', () => {
  let service: CancelledJobsCourierService
  let mockDeliveryRepository: jest.Mocked<DeliveryRepository>
  let mockDeliveryEventService: jest.Mocked<DeliveryEventService>

  const courierId = 'courier-test-1'
  const deliveryId = 'del-cancel-100'

  const sampleCancelledRow = {
    id: deliveryId,
    orderReference: 'REF-100',
    pickupName: 'Taverna Volos',
    pickupBusinessName: 'Taverna Volos SA',
    pickupPhoneNumber: '+302421011111',
    currencyCode: 'EUR',
    cancelledBy: EnumCancelledBy.RESTAURANT,
    cancelledAt: new Date('2026-11-01T10:00:00.000Z'),
    cancelledFromStatus: EnumDeliveryStatus.PICKED_UP,
    status: EnumDeliveryStatus.CANCELED,
    courierId,
    foodOutcome: null,
    pickupLocation: {
      formattedAddress: 'Argonafton 10, Volos',
      street: 'Argonafton 10',
      city: 'Volos',
      state: 'Thessaly',
    },
    courierCompensations: [{ amount: 450 }],
  }

  beforeEach(() => {
    mockDeliveryRepository = {
      findById: jest.fn(),
      findCancelledJobsForCourier: jest.fn(),
      updateIfMatches: jest.fn(),
    } as unknown as jest.Mocked<DeliveryRepository>

    mockDeliveryEventService = {
      recordCancellationEvent: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DeliveryEventService>

    service = new CancelledJobsCourierService(mockDeliveryRepository, mockDeliveryEventService)
  })

  describe('getMyCancelledJobs (AC-7, AC-11, AC-12)', () => {
    it('queries findCancelledJobsForCourier with courierId, 24-hour lookback and DELIVERY_ONGOING_STATUSES', async () => {
      const fixedNow = new Date('2026-11-01T12:00:00.000Z')
      const expectedSince = new Date(fixedNow.getTime() - 24 * 60 * 60 * 1000)

      mockDeliveryRepository.findCancelledJobsForCourier.mockResolvedValueOnce([sampleCancelledRow as any])

      const result = await service.getMyCancelledJobs(courierId, fixedNow)

      expect(mockDeliveryRepository.findCancelledJobsForCourier).toHaveBeenCalledWith(
        courierId,
        expectedSince,
        DELIVERY_ONGOING_STATUSES
      )
      expect(result).toHaveLength(1)
      const dto = result[0]!
      expect(dto).toBeInstanceOf(CancelledJobCourierDto)
      expect(dto.id).toBe(deliveryId)
      expect(dto.payAmount).toBe(450)
      expect(dto.pickedUp).toBe(true)
    })

    it('DTO contains EXACTLY its allow list keys and NEVER exposes customer data (AC-11)', async () => {
      // Create raw row with customer fields present on DB model
      const rowWithCustomerData = {
        ...sampleCancelledRow,
        dropoffName: 'Sensitive Customer Name',
        dropoffPhoneNumber: '+306999999999',
        dropoffAddress: 'Secret Home 12, Volos',
        customerNote: 'Door code 1234',
        dropoffLocation: { street: 'Secret Home 12', city: 'Volos' },
      }

      mockDeliveryRepository.findCancelledJobsForCourier.mockResolvedValueOnce([rowWithCustomerData as any])

      const result = await service.getMyCancelledJobs(courierId)
      const dto = result[0]!

      const expectedAllowListKeys = [
        'id',
        'orderReference',
        'pickupName',
        'pickupBusinessName',
        'pickupAddress',
        'pickupPhoneNumber',
        'cancelledBy',
        'cancelledAt',
        'pickedUp',
        'payAmount',
        'currencyCode',
        'foodOutcome',
      ].sort()

      expect(Object.keys(dto).sort()).toEqual(expectedAllowListKeys)

      // Explicitly guard against customer leaks
      const json = JSON.stringify(dto)
      expect(json).not.toContain('Sensitive Customer Name')
      expect(json).not.toContain('+306999999999')
      expect(json).not.toContain('Secret Home')
      expect(json).not.toContain('Door code')
    })

    describe('pickupAddress fallback (decision 32.15)', () => {
      it('uses location.formattedAddress when non-empty', async () => {
        mockDeliveryRepository.findCancelledJobsForCourier.mockResolvedValueOnce([
          {
            ...sampleCancelledRow,
            pickupLocation: {
              formattedAddress: 'Main St 1, Volos',
              street: 'Main St 1',
              city: 'Volos',
              state: 'Magnesia',
            },
          } as any,
        ])

        const jobs = await service.getMyCancelledJobs(courierId)
        expect(jobs[0]!.pickupAddress).toBe('Main St 1, Volos')
      })

      it('falls back to street, city, state when formattedAddress is empty string ""', async () => {
        mockDeliveryRepository.findCancelledJobsForCourier.mockResolvedValueOnce([
          {
            ...sampleCancelledRow,
            pickupLocation: {
              formattedAddress: '',
              street: 'Iasonos 45',
              city: 'Volos',
              state: 'Thessaly',
            },
          } as any,
        ])

        const jobs = await service.getMyCancelledJobs(courierId)
        expect(jobs[0]!.pickupAddress).toBe('Iasonos 45, Volos, Thessaly')
      })

      it('falls back to street, city, state when formattedAddress is null', async () => {
        mockDeliveryRepository.findCancelledJobsForCourier.mockResolvedValueOnce([
          {
            ...sampleCancelledRow,
            pickupLocation: {
              formattedAddress: null,
              street: 'Dimitriadis 12',
              city: 'Volos',
              state: null,
            },
          } as any,
        ])

        const jobs = await service.getMyCancelledJobs(courierId)
        expect(jobs[0]!.pickupAddress).toBe('Dimitriadis 12, Volos')
      })
    })

    describe('pickedUp and payAmount mapping', () => {
      it('sets pickedUp = true for PICKED_UP, ON_THE_WAY, and COURIER_ARRIVED_AT_DROPOFF_LOCATION', async () => {
        for (const status of [
          EnumDeliveryStatus.PICKED_UP,
          EnumDeliveryStatus.ON_THE_WAY,
          EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
        ]) {
          mockDeliveryRepository.findCancelledJobsForCourier.mockResolvedValueOnce([
            { ...sampleCancelledRow, cancelledFromStatus: status } as any,
          ])

          const jobs = await service.getMyCancelledJobs(courierId)
          expect(jobs[0]!.pickedUp).toBe(true)
        }
      })

      it('sets pickedUp = false for ACCEPTED, DISPATCHED, and COURIER_ARRIVED_AT_PICKUP_LOCATION', async () => {
        for (const status of [
          EnumDeliveryStatus.ACCEPTED,
          EnumDeliveryStatus.DISPATCHED,
          EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
        ]) {
          mockDeliveryRepository.findCancelledJobsForCourier.mockResolvedValueOnce([
            { ...sampleCancelledRow, cancelledFromStatus: status } as any,
          ])

          const jobs = await service.getMyCancelledJobs(courierId)
          expect(jobs[0]!.pickedUp).toBe(false)
        }
      })

      it('returns payAmount = null when courierCompensations is empty (pay is still being recorded)', async () => {
        mockDeliveryRepository.findCancelledJobsForCourier.mockResolvedValueOnce([
          { ...sampleCancelledRow, courierCompensations: [] } as any,
        ])

        const jobs = await service.getMyCancelledJobs(courierId)
        expect(jobs[0]!.payAmount).toBeNull()
      })
    })
  })

  describe('recordFoodOutcome (AC-8, AC-9, decision 32.7, 32.11)', () => {
    beforeEach(() => {
      mockDeliveryRepository.findById.mockResolvedValue({
        id: deliveryId,
        courierId,
        status: EnumDeliveryStatus.CANCELED,
        cancelledAt: new Date('2026-11-01T10:00:00Z'),
        cancelledFromStatus: EnumDeliveryStatus.PICKED_UP,
      } as any)
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(true)
      mockDeliveryRepository.findCancelledJobsForCourier.mockResolvedValue([
        {
          ...sampleCancelledRow,
          foodOutcome: EnumFoodOutcome.RETURNED,
        } as any,
      ])
    })

    it('records RETURNED food outcome and emits FOOD_RETURNED event with default message when no note provided', async () => {
      const result = await service.recordFoodOutcome(deliveryId, courierId, {
        outcome: EnumFoodOutcome.RETURNED,
      })

      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        deliveryId,
        { courierId, foodOutcome: null },
        { foodOutcome: EnumFoodOutcome.RETURNED, foodOutcomeAt: expect.any(Date) }
      )

      expect(mockDeliveryEventService.recordCancellationEvent).toHaveBeenCalledWith(
        {
          deliveryId,
          type: EnumDeliveryEventType.FOOD_RETURNED,
          actor: EnumEventActor.COURIER,
          source: EnumDeliveryEventSource.OPENCOURIER,
          courierId,
          message: 'Food returned to the restaurant',
        },
        EnumDeliveryStatus.CANCELED
      )

      expect(result.id).toBe(deliveryId)
      expect(result.foodOutcome).toBe(EnumFoodOutcome.RETURNED)
    })

    it('records RETURNED food outcome with custom note when provided', async () => {
      await service.recordFoodOutcome(deliveryId, courierId, {
        outcome: EnumFoodOutcome.RETURNED,
        note: 'Handed to chef at back door',
      })

      expect(mockDeliveryEventService.recordCancellationEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EnumDeliveryEventType.FOOD_RETURNED,
          message: 'Handed to chef at back door',
        }),
        EnumDeliveryStatus.CANCELED
      )
    })

    it('records NOT_RETURNED food outcome with required note and emits FOOD_NOT_RETURNED event', async () => {
      mockDeliveryRepository.findCancelledJobsForCourier.mockResolvedValue([
        {
          ...sampleCancelledRow,
          foodOutcome: EnumFoodOutcome.NOT_RETURNED,
        } as any,
      ])

      const result = await service.recordFoodOutcome(deliveryId, courierId, {
        outcome: EnumFoodOutcome.NOT_RETURNED,
        note: 'Restaurant closed and gate locked',
      })

      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        deliveryId,
        { courierId, foodOutcome: null },
        { foodOutcome: EnumFoodOutcome.NOT_RETURNED, foodOutcomeAt: expect.any(Date) }
      )

      expect(mockDeliveryEventService.recordCancellationEvent).toHaveBeenCalledWith(
        {
          deliveryId,
          type: EnumDeliveryEventType.FOOD_NOT_RETURNED,
          actor: EnumEventActor.COURIER,
          source: EnumDeliveryEventSource.OPENCOURIER,
          courierId,
          message: 'Restaurant closed and gate locked',
        },
        EnumDeliveryStatus.CANCELED
      )

      expect(result.foodOutcome).toBe(EnumFoodOutcome.NOT_RETURNED)
    })

    it('refuses NOT_RETURNED without note (or whitespace only note) with BadRequestException (400)', async () => {
      await expect(
        service.recordFoodOutcome(deliveryId, courierId, {
          outcome: EnumFoodOutcome.NOT_RETURNED,
        })
      ).rejects.toThrow(new BadRequestException('Say what happened to the food when it was not returned.'))

      await expect(
        service.recordFoodOutcome(deliveryId, courierId, {
          outcome: EnumFoodOutcome.NOT_RETURNED,
          note: '    ',
        })
      ).rejects.toThrow(new BadRequestException('Say what happened to the food when it was not returned.'))

      expect(mockDeliveryRepository.updateIfMatches).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.recordCancellationEvent).not.toHaveBeenCalled()
    })

    it('refuses with 409 ConflictException when outcome is already recorded (conditional write returns false)', async () => {
      mockDeliveryRepository.updateIfMatches.mockResolvedValueOnce(false)

      await expect(
        service.recordFoodOutcome(deliveryId, courierId, {
          outcome: EnumFoodOutcome.RETURNED,
        })
      ).rejects.toThrow(new ConflictException('The food outcome is already recorded.'))

      expect(mockDeliveryEventService.recordCancellationEvent).not.toHaveBeenCalled()
    })

    it('refuses with 404 DeliveryNotFoundException when delivery does not exist or belongs to another rider', async () => {
      mockDeliveryRepository.findById.mockResolvedValueOnce(null)
      await expect(
        service.recordFoodOutcome('del-nonexistent', courierId, { outcome: EnumFoodOutcome.RETURNED })
      ).rejects.toThrow(DeliveryNotFoundException)

      mockDeliveryRepository.findById.mockResolvedValueOnce({
        id: deliveryId,
        courierId: 'other-rider',
      } as any)
      await expect(
        service.recordFoodOutcome(deliveryId, courierId, { outcome: EnumFoodOutcome.RETURNED })
      ).rejects.toThrow(DeliveryNotFoundException)
    })

    it('refuses with 409 ConflictException when delivery is not cancelled', async () => {
      mockDeliveryRepository.findById.mockResolvedValueOnce({
        id: deliveryId,
        courierId,
        cancelledAt: null,
      } as any)

      await expect(
        service.recordFoodOutcome(deliveryId, courierId, { outcome: EnumFoodOutcome.RETURNED })
      ).rejects.toThrow(new ConflictException('This job is not cancelled.'))
    })

    it('refuses with 409 ConflictException when delivery was cancelled before pickup', async () => {
      mockDeliveryRepository.findById.mockResolvedValueOnce({
        id: deliveryId,
        courierId,
        cancelledAt: new Date(),
        cancelledFromStatus: EnumDeliveryStatus.ACCEPTED,
      } as any)

      await expect(
        service.recordFoodOutcome(deliveryId, courierId, { outcome: EnumFoodOutcome.RETURNED })
      ).rejects.toThrow(new ConflictException('Nothing to return: this job was cancelled before pickup.'))
    })

    it('still returns updated DTO even if recordCancellationEvent throws (event write failure is logged, not rethrown)', async () => {
      mockDeliveryEventService.recordCancellationEvent.mockRejectedValueOnce(new Error('Event write failed'))

      const result = await service.recordFoodOutcome(deliveryId, courierId, {
        outcome: EnumFoodOutcome.RETURNED,
      })

      expect(result.id).toBe(deliveryId)
      expect(result.foodOutcome).toBe(EnumFoodOutcome.RETURNED)
    })

    it('answers the job row (built with toDto) rather than 404 for a job cancelled more than 24 h ago (row 32 review)', async () => {
      const cancelled30HoursAgo = new Date(Date.now() - 30 * 3600 * 1000)
      const oldDelivery = {
        id: 'del-old-cancelled',
        courierId,
        status: EnumDeliveryStatus.CANCELED,
        cancelledAt: cancelled30HoursAgo,
        cancelledFromStatus: EnumDeliveryStatus.PICKED_UP,
        cancelledBy: EnumCancelledBy.CUSTOMER,
        foodOutcome: null,
      }
      mockDeliveryRepository.findById.mockResolvedValueOnce(oldDelivery as any)
      mockDeliveryRepository.updateIfMatches.mockResolvedValueOnce(true)

      const oldCancelledRow = {
        ...sampleCancelledRow,
        id: 'del-old-cancelled',
        cancelledAt: cancelled30HoursAgo,
        foodOutcome: EnumFoodOutcome.RETURNED,
      }
      mockDeliveryRepository.findCancelledJobsForCourier.mockResolvedValueOnce([oldCancelledRow as any])

      const result = await service.recordFoodOutcome('del-old-cancelled', courierId, {
        outcome: EnumFoodOutcome.RETURNED,
      })

      // Verified findCancelledJobsForCourier was queried with new Date(0) (not 24h window) and deliveryId (spec 0015, agy review)
      expect(mockDeliveryRepository.findCancelledJobsForCourier).toHaveBeenCalledWith(
        courierId,
        new Date(0),
        DELIVERY_ONGOING_STATUSES,
        'del-old-cancelled'
      )
      expect(result.id).toBe('del-old-cancelled')
      expect(result.foodOutcome).toBe(EnumFoodOutcome.RETURNED)
    })

    it("still answers 404 DeliveryNotFoundException when delivery row is not this rider's in findCancelledJobsForCourier", async () => {
      mockDeliveryRepository.findById.mockResolvedValueOnce({
        id: deliveryId,
        courierId,
        cancelledAt: new Date(Date.now() - 30 * 3600 * 1000),
        cancelledFromStatus: EnumDeliveryStatus.PICKED_UP,
      } as any)
      mockDeliveryRepository.updateIfMatches.mockResolvedValueOnce(true)
      mockDeliveryRepository.findCancelledJobsForCourier.mockResolvedValueOnce([]) // not found for this courier

      await expect(
        service.recordFoodOutcome(deliveryId, courierId, { outcome: EnumFoodOutcome.RETURNED })
      ).rejects.toThrow(DeliveryNotFoundException)

      expect(mockDeliveryRepository.findCancelledJobsForCourier).toHaveBeenCalledWith(
        courierId,
        new Date(0),
        DELIVERY_ONGOING_STATUSES,
        deliveryId
      )
    })
  })

  describe('FoodOutcomeCourierInput ValidationPipe checks', () => {
    const pipe = new ValidationPipe({
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    })

    it('validates valid RETURNED without note', async () => {
      const result = (await pipe.transform(
        { outcome: 'RETURNED' },
        { type: 'body', metatype: FoodOutcomeCourierInput }
      )) as FoodOutcomeCourierInput

      expect(result.outcome).toBe(EnumFoodOutcome.RETURNED)
      expect(result.note).toBeUndefined()
    })

    it('validates valid NOT_RETURNED with string note up to 500 characters', async () => {
      const validNote = 'A'.repeat(500)
      const result = (await pipe.transform(
        { outcome: 'NOT_RETURNED', note: validNote },
        { type: 'body', metatype: FoodOutcomeCourierInput }
      )) as FoodOutcomeCourierInput

      expect(result.outcome).toBe(EnumFoodOutcome.NOT_RETURNED)
      expect(result.note).toBe(validNote)
    })

    it('refuses note exceeding 500 characters with 400 BadRequestException', async () => {
      const tooLongNote = 'A'.repeat(501)
      await expect(
        pipe.transform(
          { outcome: 'NOT_RETURNED', note: tooLongNote },
          { type: 'body', metatype: FoodOutcomeCourierInput }
        )
      ).rejects.toThrow(BadRequestException)
    })

    it('refuses non-string note (@RefuseIfNotSentAsString) with 400 BadRequestException', async () => {
      for (const nonString of [123, true, [], {}]) {
        await expect(
          pipe.transform(
            { outcome: 'NOT_RETURNED', note: nonString },
            { type: 'body', metatype: FoodOutcomeCourierInput }
          )
        ).rejects.toThrow(BadRequestException)
      }
    })

    it('refuses invalid outcome with 400 BadRequestException', async () => {
      await expect(
        pipe.transform(
          { outcome: 'INVALID_OUTCOME' },
          { type: 'body', metatype: FoodOutcomeCourierInput }
        )
      ).rejects.toThrow(BadRequestException)
    })
  })
})
