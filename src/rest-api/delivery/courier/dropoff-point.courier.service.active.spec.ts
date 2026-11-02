import { BadRequestException, ConflictException, Logger } from '@nestjs/common'
import {
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
} from '@prisma/types'
import {
  ALREADY_MOVED_MESSAGE,
  ALREADY_THERE_MESSAGE,
  DROPOFF_POINT_CORRECTABLE_STATUSES,
  DropoffPointCourierService,
  WRONG_STATUS_MESSAGE,
} from './dropoff-point.courier.service'
import { DeliveryNotFoundException } from 'src/errors'
import { OUTSIDE_SERVICE_AREA_MESSAGE } from 'src/domains/saved-customer/saved-customer.domain.service'

describe('DropoffPointCourierService (Spec 0016 AC-9, AC-10, AC-12)', () => {
  let service: DropoffPointCourierService

  let mockDeliveryRepository: any
  let mockLocationRepository: any
  let mockSavedCustomerRepository: any
  let mockConfigDomainService: any
  let mockDeliveryEventService: any

  const deliveryId = 'del-100'
  const courierId = 'courier-r31'
  const partnerId = 'partner-nosh'
  const customerPhone = '+306912345678'
  const customerId = 'cust-saved-1'

  // Volos square region (lat 39.35..39.40, lng 22.90..23.00)
  const volosRegion = {
    type: 'Polygon',
    coordinates: [
      [
        [22.90, 39.35],
        [23.00, 39.35],
        [23.00, 39.40],
        [22.90, 39.40],
        [22.90, 39.35],
      ],
    ],
  }

  // Delivery drop off location in Volos
  const oldLocation = {
    id: 'loc-dropoff-old',
    latitude: 39.364,
    longitude: 22.948,
  }

  // ~141 m away in Volos
  const validNewPointInput = {
    latitude: 39.365,
    longitude: 22.949,
  }

  const baseDelivery: any = {
    id: deliveryId,
    courierId,
    matchedCourierId: courierId,
    partnerId,
    dropoffLocationId: oldLocation.id,
    dropoffPhoneNumber: customerPhone,
    status: EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
    dropoffPointCorrectedAt: null,
  }

  const baseSavedCustomer: any = {
    id: customerId,
    partnerId,
    phone: customerPhone,
    latitude: 39.364,
    longitude: 22.948,
    floor: '2nd',
    doorbell: 'Dimas',
    lastUsedAt: new Date('2026-11-01T10:00:00Z'),
  }

  beforeEach(() => {
    mockDeliveryRepository = {
      findById: jest.fn().mockResolvedValue({ ...baseDelivery }),
      updateIfMatches: jest.fn().mockResolvedValue(true),
    }

    mockLocationRepository = {
      findById: jest.fn().mockResolvedValue({ ...oldLocation }),
      update: jest.fn(),
    }

    mockSavedCustomerRepository = {
      findByPhone: jest.fn().mockResolvedValue({ ...baseSavedCustomer }),
      movePointIfUnchanged: jest.fn().mockResolvedValue(true),
    }

    mockConfigDomainService = {
      instanceConfig: {
        getDetails: jest.fn().mockResolvedValue({ region: volosRegion }),
      },
    }

    mockDeliveryEventService = {
      recordDropoffPointCorrectedEvent: jest.fn().mockResolvedValue(undefined),
    }

    service = new DropoffPointCourierService(
      mockDeliveryRepository,
      mockLocationRepository,
      mockSavedCustomerRepository,
      mockConfigDomainService,
      mockDeliveryEventService
    )
  })

  describe('AC-9: Access control and delivery validation', () => {
    it('throws 404 DeliveryNotFoundException when delivery does not exist', async () => {
      mockDeliveryRepository.findById.mockResolvedValue(null)

      await expect(service.correct(deliveryId, courierId, validNewPointInput)).rejects.toThrow(
        DeliveryNotFoundException
      )
    })

    it('throws 404 DeliveryNotFoundException when courierId does not match (another courier)', async () => {
      mockDeliveryRepository.findById.mockResolvedValue({
        ...baseDelivery,
        courierId: 'other-courier-999',
      })

      await expect(service.correct(deliveryId, courierId, validNewPointInput)).rejects.toThrow(
        DeliveryNotFoundException
      )
    })

    it('throws 404 DeliveryNotFoundException when matchedCourierId matches but courierId is null (unaccepted offer)', async () => {
      mockDeliveryRepository.findById.mockResolvedValue({
        ...baseDelivery,
        courierId: null,
        matchedCourierId: courierId,
      })

      await expect(service.correct(deliveryId, courierId, validNewPointInput)).rejects.toThrow(
        DeliveryNotFoundException
      )
    })

    it('throws 409 ConflictException when delivery dropoffPointCorrectedAt is already set', async () => {
      mockDeliveryRepository.findById.mockResolvedValue({
        ...baseDelivery,
        dropoffPointCorrectedAt: new Date('2026-11-02T01:00:00Z'),
      })

      await expect(service.correct(deliveryId, courierId, validNewPointInput)).rejects.toThrow(
        new ConflictException(ALREADY_MOVED_MESSAGE)
      )
    })

    it('throws 409 ConflictException when delivery status is outside correctable statuses', async () => {
      const nonCorrectableStatuses = [
        EnumDeliveryStatus.CREATED,
        EnumDeliveryStatus.ASSIGNING_COURIER,
        EnumDeliveryStatus.ACCEPTED,
        EnumDeliveryStatus.DISPATCHED,
        EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
        EnumDeliveryStatus.DROPPED_OFF,
        EnumDeliveryStatus.CANCELED,
        EnumDeliveryStatus.FAILED,
      ]

      for (const status of nonCorrectableStatuses) {
        mockDeliveryRepository.findById.mockResolvedValue({
          ...baseDelivery,
          status,
        })

        await expect(service.correct(deliveryId, courierId, validNewPointInput)).rejects.toThrow(
          new ConflictException(WRONG_STATUS_MESSAGE)
        )
      }
    })

    it('accepts pin correction in each of PICKED_UP, ON_THE_WAY, and COURIER_ARRIVED_AT_DROPOFF_LOCATION', async () => {
      const correctableStatuses = [
        EnumDeliveryStatus.PICKED_UP,
        EnumDeliveryStatus.ON_THE_WAY,
        EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
      ]

      for (const status of correctableStatuses) {
        mockDeliveryRepository.findById.mockResolvedValue({
          ...baseDelivery,
          status,
        })

        const result = await service.correct(deliveryId, courierId, validNewPointInput)
        expect(result.savedCustomerUpdated).toBe(true)
        expect(result.distanceMetres).toBe(141)
      }
    })

    it('throws 404 DeliveryNotFoundException when dropoff Location record is missing', async () => {
      mockLocationRepository.findById.mockResolvedValue(null)

      await expect(service.correct(deliveryId, courierId, validNewPointInput)).rejects.toThrow(
        DeliveryNotFoundException
      )
    })
  })

  describe('AC-9: Service area and minimum distance checks', () => {
    it('throws 400 BadRequestException when point is outside the instance service area', async () => {
      const outsidePoint = { latitude: 40.500, longitude: 22.000 } // outside Volos

      await expect(service.correct(deliveryId, courierId, outsidePoint)).rejects.toThrow(
        new BadRequestException(OUTSIDE_SERVICE_AREA_MESSAGE)
      )
    })

    it('accepts point when no region is configured in instance config', async () => {
      mockConfigDomainService.instanceConfig.getDetails.mockResolvedValue({ region: null })

      const result = await service.correct(deliveryId, courierId, validNewPointInput)
      expect(result.savedCustomerUpdated).toBe(true)
      expect(result.distanceMetres).toBe(141)
    })

    it('throws 409 ConflictException ALREADY_THERE_MESSAGE when move distance is under 10 metres', async () => {
      // 39.36400 to 39.36405 at same longitude is approx 5.5 m (< 10 m)
      const under10mPoint = { latitude: 39.36405, longitude: 22.948 }

      await expect(service.correct(deliveryId, courierId, under10mPoint)).rejects.toThrow(
        new ConflictException(ALREADY_THERE_MESSAGE)
      )
    })

    it('accepts move of just over 10 metres (e.g. 11 metres)', async () => {
      // 39.36400 to 39.36410 at same longitude is approx 11.1 m (> 10 m)
      const over10mPoint = { latitude: 39.36410, longitude: 22.948 }

      const result = await service.correct(deliveryId, courierId, over10mPoint)
      expect(result.distanceMetres).toBe(11)
      expect(result.savedCustomerUpdated).toBe(true)
    })
  })

  describe('AC-9: Claim conditional write and rollback', () => {
    it('claims move with conditional updateIfMatches matching { courierId, dropoffPointCorrectedAt: null, status: { in: DROPOFF_POINT_CORRECTABLE_STATUSES } }', async () => {
      await service.correct(deliveryId, courierId, validNewPointInput)

      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        deliveryId,
        {
          courierId,
          dropoffPointCorrectedAt: null,
          status: { in: DROPOFF_POINT_CORRECTABLE_STATUSES },
        },
        { dropoffPointCorrectedAt: expect.any(Date) }
      )
    })

    it('throws 409 ConflictException ALREADY_MOVED_MESSAGE when lost claim re-read shows dropoffPointCorrectedAt is set', async () => {
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(false)
      // Initial read at start of correct has dropoffPointCorrectedAt: null;
      // second read after lost claim shows another move set dropoffPointCorrectedAt
      mockDeliveryRepository.findById
        .mockResolvedValueOnce({ ...baseDelivery, dropoffPointCorrectedAt: null })
        .mockResolvedValueOnce({
          ...baseDelivery,
          dropoffPointCorrectedAt: new Date('2026-11-02T01:05:00Z'),
        })

      await expect(service.correct(deliveryId, courierId, validNewPointInput)).rejects.toThrow(
        new ConflictException(ALREADY_MOVED_MESSAGE)
      )

      expect(mockDeliveryRepository.findById).toHaveBeenCalledTimes(2)
      expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).not.toHaveBeenCalled()
    })

    it('throws 409 ConflictException WRONG_STATUS_MESSAGE when lost claim re-read shows dropoffPointCorrectedAt is null (status moved on)', async () => {
      mockDeliveryRepository.updateIfMatches.mockResolvedValue(false)
      // Initial read at start of correct is a valid correctable status;
      // second read after lost claim shows status moved on (e.g. DROPPED_OFF) and dropoffPointCorrectedAt is still null
      mockDeliveryRepository.findById
        .mockResolvedValueOnce({ ...baseDelivery, dropoffPointCorrectedAt: null })
        .mockResolvedValueOnce({
          ...baseDelivery,
          dropoffPointCorrectedAt: null,
          status: EnumDeliveryStatus.DROPPED_OFF,
        })

      await expect(service.correct(deliveryId, courierId, validNewPointInput)).rejects.toThrow(
        new ConflictException(WRONG_STATUS_MESSAGE)
      )

      expect(mockDeliveryRepository.findById).toHaveBeenCalledTimes(2)
      expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).not.toHaveBeenCalled()
    })

    it('releases the claim (resets dropoffPointCorrectedAt to null) when event recording throws, and propagates error', async () => {
      const dbError = new Error('Database connection failed')
      mockDeliveryEventService.recordDropoffPointCorrectedEvent.mockRejectedValue(dbError)

      await expect(service.correct(deliveryId, courierId, validNewPointInput)).rejects.toThrow(dbError)

      // Verify release of claim
      expect(mockDeliveryRepository.updateIfMatches).toHaveBeenCalledWith(
        deliveryId,
        { courierId },
        { dropoffPointCorrectedAt: null }
      )
    })

    it('throws the original event recording error and logs the release error when both throw', async () => {
      const eventError = new Error('Database event insert failed')
      const releaseError = new Error('Database claim release failed')

      mockDeliveryEventService.recordDropoffPointCorrectedEvent.mockRejectedValue(eventError)
      // 1st updateIfMatches is the claim (succeeds), 2nd is the release (fails)
      mockDeliveryRepository.updateIfMatches
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(releaseError)

      const errorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})

      await expect(service.correct(deliveryId, courierId, validNewPointInput)).rejects.toThrow(eventError)

      // The release failure must be logged with the release error
      expect(errorSpy).toHaveBeenCalledWith(
        `DROPOFF_POINT_CLAIM_RELEASE_FAILED delivery ${deliveryId}: ${releaseError}`
      )
      // The correction failure is also logged with the original event error
      expect(errorSpy).toHaveBeenCalledWith(
        `DROPOFF_POINT_CORRECTION_FAILED delivery ${deliveryId}: ${eventError}`,
        eventError.stack
      )

      errorSpy.mockRestore()
    })

    it('never modifies the delivery Location row', async () => {
      await service.correct(deliveryId, courierId, validNewPointInput)

      expect(mockLocationRepository.update).not.toHaveBeenCalled()
    })
  })

  describe('AC-9 & AC-10: Event recording and saved customer outcomes', () => {
    it('Outcome 1: saved customer updated when within 5 m and movePointIfUnchanged returns true', async () => {
      const result = await service.correct(deliveryId, courierId, validNewPointInput)

      expect(mockSavedCustomerRepository.findByPhone).toHaveBeenCalledWith(partnerId, customerPhone)
      expect(mockSavedCustomerRepository.movePointIfUnchanged).toHaveBeenCalledWith(
        partnerId,
        customerId,
        { latitude: baseSavedCustomer.latitude, longitude: baseSavedCustomer.longitude },
        { latitude: validNewPointInput.latitude, longitude: validNewPointInput.longitude }
      )

      expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).toHaveBeenCalledWith(
        {
          deliveryId,
          type: EnumDeliveryEventType.DROPOFF_POINT_CORRECTED,
          actor: EnumEventActor.COURIER,
          source: EnumDeliveryEventSource.OPENCOURIER,
          courierId,
          message:
            'Drop off pin moved 141 m by the rider, from 39.36400, 22.94800 to 39.36500, 22.94900; saved customer updated',
        },
        EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION
      )

      expect(result).toEqual({
        savedCustomerUpdated: true,
        distanceMetres: 141,
      })
    })

    it('Outcome 1: passes customer exact coordinates as from to movePointIfUnchanged when customer is 3 m away from delivery point', async () => {
      // Customer at 39.364027 is ~3.0 m from delivery drop off (39.364, 22.948), within 5 m limit
      const customerPoint3mAway = { latitude: 39.364027, longitude: 22.948 }
      mockSavedCustomerRepository.findByPhone.mockResolvedValue({
        ...baseSavedCustomer,
        latitude: customerPoint3mAway.latitude,
        longitude: customerPoint3mAway.longitude,
      })

      const result = await service.correct(deliveryId, courierId, validNewPointInput)

      expect(mockSavedCustomerRepository.movePointIfUnchanged).toHaveBeenCalledWith(
        partnerId,
        customerId,
        { latitude: customerPoint3mAway.latitude, longitude: customerPoint3mAway.longitude },
        { latitude: validNewPointInput.latitude, longitude: validNewPointInput.longitude }
      )
      expect(result.savedCustomerUpdated).toBe(true)
    })

    it('Outcome 1 (retry): customer already within 5 m of new point counts as updated and movePointIfUnchanged is not called', async () => {
      // Customer is ~2.2 m from validNewPointInput (39.365, 22.949), but ~142 m from oldLocation (39.364, 22.948)
      mockSavedCustomerRepository.findByPhone.mockResolvedValue({
        ...baseSavedCustomer,
        latitude: 39.36502,
        longitude: 22.949,
      })

      const result = await service.correct(deliveryId, courierId, validNewPointInput)

      expect(mockSavedCustomerRepository.movePointIfUnchanged).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            'Drop off pin moved 141 m by the rider, from 39.36400, 22.94800 to 39.36500, 22.94900; saved customer updated',
        }),
        expect.any(String)
      )
      expect(result).toEqual({
        savedCustomerUpdated: true,
        distanceMetres: 141,
      })
    })

    it('Outcome 2: no saved customer when partnerId is null', async () => {
      mockDeliveryRepository.findById.mockResolvedValue({
        ...baseDelivery,
        partnerId: null,
      })

      const result = await service.correct(deliveryId, courierId, validNewPointInput)

      expect(mockSavedCustomerRepository.findByPhone).not.toHaveBeenCalled()
      expect(mockSavedCustomerRepository.movePointIfUnchanged).not.toHaveBeenCalled()

      expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            'Drop off pin moved 141 m by the rider, from 39.36400, 22.94800 to 39.36500, 22.94900; no saved customer',
        }),
        expect.any(String)
      )
      expect(result).toEqual({
        savedCustomerUpdated: false,
        distanceMetres: 141,
      })
    })

    it('Outcome 2: no saved customer when phone does not normalise', async () => {
      mockDeliveryRepository.findById.mockResolvedValue({
        ...baseDelivery,
        dropoffPhoneNumber: 'invalid-phone-string',
      })

      const result = await service.correct(deliveryId, courierId, validNewPointInput)

      expect(mockSavedCustomerRepository.findByPhone).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('no saved customer'),
        }),
        expect.any(String)
      )
      expect(result.savedCustomerUpdated).toBe(false)
    })

    it('Outcome 2: no saved customer when findByPhone returns null', async () => {
      mockSavedCustomerRepository.findByPhone.mockResolvedValue(null)

      const result = await service.correct(deliveryId, courierId, validNewPointInput)

      expect(mockSavedCustomerRepository.movePointIfUnchanged).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('no saved customer'),
        }),
        expect.any(String)
      )
      expect(result.savedCustomerUpdated).toBe(false)
    })

    it('Outcome 3: saved customer not changed when customer stored point is > 5 m from delivery dropoff point', async () => {
      // Customer at 39.36410 is ~11 m away from delivery's oldLocation at 39.36400 (> 5 m)
      mockSavedCustomerRepository.findByPhone.mockResolvedValue({
        ...baseSavedCustomer,
        latitude: 39.36410,
        longitude: 22.948,
      })

      const result = await service.correct(deliveryId, courierId, validNewPointInput)

      expect(mockSavedCustomerRepository.movePointIfUnchanged).not.toHaveBeenCalled()
      expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            'Drop off pin moved 141 m by the rider, from 39.36400, 22.94800 to 39.36500, 22.94900; saved customer not changed: the restaurant moved its pin since the order',
        }),
        expect.any(String)
      )
      expect(result.savedCustomerUpdated).toBe(false)
    })

    it('Outcome 3: saved customer not changed when movePointIfUnchanged returns false (race with edit)', async () => {
      mockSavedCustomerRepository.movePointIfUnchanged.mockResolvedValue(false)

      const result = await service.correct(deliveryId, courierId, validNewPointInput)

      expect(mockDeliveryEventService.recordDropoffPointCorrectedEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            'Drop off pin moved 141 m by the rider, from 39.36400, 22.94800 to 39.36500, 22.94900; saved customer not changed: the restaurant moved its pin since the order',
        }),
        expect.any(String)
      )
      expect(result.savedCustomerUpdated).toBe(false)
    })
  })

  describe('AC-12: Privacy - No personal data in logs or event messages', () => {
    it('ensures no log line or event message contains customer phone, name or doorbell', async () => {
      const logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => {})
      const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {})
      const errorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})

      // 1. Successful move
      await service.correct(deliveryId, courierId, validNewPointInput)

      // 2. Failed recording (error log)
      mockDeliveryEventService.recordDropoffPointCorrectedEvent.mockRejectedValueOnce(
        new Error('Failed recording')
      )
      try {
        await service.correct(deliveryId, courierId, validNewPointInput)
      } catch {}

      const allLogged = [
        ...logSpy.mock.calls.map((c) => String(c[0])),
        ...warnSpy.mock.calls.map((c) => String(c[0])),
        ...errorSpy.mock.calls.map((c) => String(c[0])),
      ].join(' ')

      expect(allLogged).not.toContain(customerPhone)
      expect(allLogged).not.toContain('Dimas')
      expect(allLogged).not.toContain('Nikos')

      const eventMessage =
        mockDeliveryEventService.recordDropoffPointCorrectedEvent.mock.calls[0][0].message
      expect(eventMessage).not.toContain(customerPhone)
      expect(eventMessage).not.toContain('Dimas')
      expect(eventMessage).not.toContain('Nikos')

      logSpy.mockRestore()
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    })
  })
})
