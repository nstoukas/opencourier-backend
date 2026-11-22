import { LocationNoteRestApiCourierService } from './location-note.courier.rest-api.service'
import { LocationNoteDomainService } from 'src/domains/location-note/location-note.domain.service'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { DeliveryNotFoundException, NotFoundException, PersonalDataWarningException } from 'src/errors'
import { EnumLocationNoteActor, EnumLocationNoteReactionType } from '@prisma/types'
import { Prisma } from '@prisma/types'

describe('LocationNoteRestApiCourierService (Spec 0053 AC-2, AC-3, AC-4, AC-5, AC-7)', () => {
  let service: LocationNoteRestApiCourierService
  let mockLocationNoteDomainService: jest.Mocked<LocationNoteDomainService>
  let mockDeliveryRepository: jest.Mocked<DeliveryRepository>

  const courierId = 'courier-r1'
  const otherCourierId = 'courier-other'
  const deliveryId = 'del-held-1'

  const mockDeliveryWithLocations = {
    id: deliveryId,
    courierId,
    pickupLocationId: 'loc-pick-1',
    dropoffLocationId: 'loc-drop-1',
    pickupLocation: { latitude: 39.36, longitude: 22.94 },
    dropoffLocation: { latitude: 39.365, longitude: 22.949 },
    dropoffCorrectedLatitude: null,
    dropoffCorrectedLongitude: null,
  } as any

  beforeEach(() => {
    mockLocationNoteDomainService = {
      createForStop: jest.fn().mockResolvedValue({ id: 'note-1', note: 'Side gate open' } as any),
      update: jest.fn().mockResolvedValue({ id: 'note-1', note: 'Updated text' } as any),
      findByIdOrThrow: jest.fn(),
      getById: jest.fn(),
      addOrRemoveReaction: jest.fn().mockResolvedValue({ id: 'react-1' } as any),
      flag: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<LocationNoteDomainService>

    mockDeliveryRepository = {
      findByIdOrThrowWithLocations: jest.fn().mockResolvedValue(mockDeliveryWithLocations),
    } as unknown as jest.Mocked<DeliveryRepository>

    service = new LocationNoteRestApiCourierService(
      mockLocationNoteDomainService,
      mockDeliveryRepository
    )
  })

  describe('create (AC-2: note added on a job the rider holds)', () => {
    it('creates note when courier holds the delivery in an ongoing status', async () => {
      const result = await service.create(
        { deliveryId, stop: 'DROPOFF', note: 'Side gate open' },
        courierId
      )

      expect(mockDeliveryRepository.findByIdOrThrowWithLocations).toHaveBeenCalledWith(
        deliveryId,
        expect.objectContaining({ courierId })
      )
      expect(mockLocationNoteDomainService.createForStop).toHaveBeenCalledWith(
        expect.objectContaining({
          stop: 'DROPOFF',
          note: 'Side gate open',
          courierId,
          actor: EnumLocationNoteActor.COURIER,
        })
      )
      expect(result.id).toBe('note-1')
    })

    it('throws 404 DeliveryNotFoundException when delivery is not held by courier or does not exist', async () => {
      const notFoundError = new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: '5.3.1',
      })
      mockDeliveryRepository.findByIdOrThrowWithLocations.mockRejectedValue(notFoundError)

      await expect(
        service.create(
          { deliveryId: 'del-not-mine', stop: 'DROPOFF', note: 'Side gate' },
          courierId
        )
      ).rejects.toThrow(DeliveryNotFoundException)

      expect(mockLocationNoteDomainService.createForStop).not.toHaveBeenCalled()
    })

    it('propagates 422 PersonalDataWarningException from domain service when text has personal data', async () => {
      mockLocationNoteDomainService.createForStop.mockRejectedValue(
        new PersonalDataWarningException('Notes describe the place, never the person.')
      )

      await expect(
        service.create(
          { deliveryId, stop: 'DROPOFF', note: 'Call 6941234567' },
          courierId
        )
      ).rejects.toThrow(PersonalDataWarningException)
    })
  })

  describe('update (AC-4, cross check 7)', () => {
    it('allows author to update their own note and passes confirmed flag', async () => {
      mockLocationNoteDomainService.findByIdOrThrow.mockResolvedValue({
        id: 'note-1',
        courierId, // same courier
        note: 'Old text',
      } as any)

      const result = await service.update('note-1', 'Updated note text', courierId, true)

      expect(mockLocationNoteDomainService.update).toHaveBeenCalledWith('note-1', 'Updated note text', true)
      expect(result.note).toBe('Updated text')
    })

    it('throws 404 NotFoundException when a rider tries to edit another rider note', async () => {
      mockLocationNoteDomainService.findByIdOrThrow.mockResolvedValue({
        id: 'note-1',
        courierId: otherCourierId, // different courier
        note: 'Other rider note',
      } as any)

      await expect(
        service.update('note-1', 'Malicious edit', courierId, false)
      ).rejects.toThrow(NotFoundException)

      expect(mockLocationNoteDomainService.update).not.toHaveBeenCalled()
    })
  })

  describe('addOrRemoveReaction (AC-5)', () => {
    it('delegates upvote reaction to domain service', async () => {
      await service.addOrRemoveReaction('note-1', courierId, EnumLocationNoteReactionType.UPVOTE)

      expect(mockLocationNoteDomainService.addOrRemoveReaction).toHaveBeenCalledWith(
        'note-1',
        courierId,
        EnumLocationNoteReactionType.UPVOTE
      )
    })
  })

  describe('flag (AC-7)', () => {
    it('delegates flagging note to domain service', async () => {
      await service.flag('note-1', courierId, 'Wrong address note')

      expect(mockLocationNoteDomainService.flag).toHaveBeenCalledWith(
        'note-1',
        courierId,
        'Wrong address note'
      )
    })
  })

  describe('getById (AC-3: returns only the rider own note)', () => {
    it('returns note when courier is the author', async () => {
      mockLocationNoteDomainService.getById.mockResolvedValue({
        id: 'note-1',
        courierId,
        note: 'My note',
      } as any)

      const result = await service.getById('note-1', courierId)
      expect(result.id).toBe('note-1')
    })

    it('throws 404 NotFoundException when note belongs to another courier (cannot browse other notes by id)', async () => {
      mockLocationNoteDomainService.getById.mockResolvedValue({
        id: 'note-1',
        courierId: otherCourierId,
        note: 'Someone else note',
      } as any)

      await expect(service.getById('note-1', courierId)).rejects.toThrow(NotFoundException)
    })
  })
})
