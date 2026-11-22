import { LocationNoteDomainService, DeliveryForNotes } from './location-note.domain.service'
import { LocationNoteRepository } from 'src/persistence/repositories/location-note.repository'
import { LocationNoteReactionRepository } from 'src/persistence/repositories/location-note-reaction.repository'
import { EnumLocationNoteActor, EnumLocationNoteReactionType } from '@prisma/types'
import { PersonalDataWarningException, NotFoundException } from 'src/errors'

describe('LocationNoteDomainService (Spec 0053 AC-2, AC-3, AC-4, AC-5, AC-6, AC-7)', () => {
  let service: LocationNoteDomainService
  let mockLocationNoteRepo: jest.Mocked<LocationNoteRepository>
  let mockReactionRepo: jest.Mocked<LocationNoteReactionRepository>

  const courierA = 'courier-alice'
  const courierB = 'courier-bob'

  const mockDelivery: DeliveryForNotes = {
    id: 'del-101',
    pickupLocationId: 'loc-restaurant-1',
    dropoffLocationId: 'loc-customer-1',
    pickupLocation: { latitude: 39.36, longitude: 22.94 },
    dropoffLocation: { latitude: 39.364, longitude: 22.948 },
    dropoffCorrectedLatitude: null,
    dropoffCorrectedLongitude: null,
  }

  beforeEach(() => {
    mockLocationNoteRepo = {
      create: jest.fn().mockImplementation((data) => Promise.resolve({ id: 'note-1', ...data })),
      update: jest.fn().mockImplementation((id, note) => Promise.resolve({ id, note } as any)),
      findByIdOrThrow: jest.fn(),
      delete: jest.fn(),
      findInsideBoxes: jest.fn().mockResolvedValue([]),
      findCorrectedPointsForDropoffLocations: jest.fn().mockResolvedValue([]),
      findCourierFacingCounts: jest.fn().mockResolvedValue({
        upvotes: new Map(),
        upvotedByMe: new Set(),
        flaggedByMe: new Set(),
      }),
      markConfirmed: jest.fn().mockResolvedValue(undefined),
      deleteConfirmedBefore: jest.fn().mockResolvedValue(0),
      flagOnce: jest.fn().mockResolvedValue(undefined),
      findFlaggedForAdmin: jest.fn().mockResolvedValue([]),
      findAllForAdmin: jest.fn().mockResolvedValue([]),
      findUpvoteCountsForAdmin: jest.fn().mockResolvedValue(new Map()),
      deleteByAdmin: jest.fn().mockResolvedValue(true),
      dismissFlags: jest.fn().mockResolvedValue(1),
      exists: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<LocationNoteRepository>

    mockReactionRepo = {
      getNoteFromCourier: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<LocationNoteReactionRepository>

    service = new LocationNoteDomainService(mockLocationNoteRepo, mockReactionRepo)
  })

  describe('createForStop (AC-2, AC-4, cross check 3)', () => {
    it('creates a note for PICKUP stop on the restaurant Location coordinates', async () => {
      const result = await service.createForStop({
        delivery: mockDelivery,
        stop: 'PICKUP',
        note: 'Pick up at rear kitchen entrance',
        courierId: courierA,
        actor: EnumLocationNoteActor.COURIER,
      })

      expect(mockLocationNoteRepo.create).toHaveBeenCalledWith({
        note: 'Pick up at rear kitchen entrance',
        actor: EnumLocationNoteActor.COURIER,
        courierId: courierA,
        deliveryId: 'del-101',
        locationId: 'loc-restaurant-1',
        latitude: 39.36,
        longitude: 22.94,
      })
      expect(result.id).toBe('note-1')
    })

    it('creates a note for DROPOFF stop using currentDropoffPoint (corrected point when set)', async () => {
      const deliveryWithCorrection: DeliveryForNotes = {
        ...mockDelivery,
        dropoffCorrectedLatitude: 39.3655,
        dropoffCorrectedLongitude: 22.9495,
      }

      await service.createForStop({
        delivery: deliveryWithCorrection,
        stop: 'DROPOFF',
        note: 'Doorbell 3B broken, knock twice',
        courierId: courierA,
        actor: EnumLocationNoteActor.COURIER,
      })

      expect(mockLocationNoteRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          locationId: 'loc-customer-1',
          latitude: 39.3655,
          longitude: 22.9495,
        })
      )
    })

    it('refuses note text containing personal data when confirmed is not true', async () => {
      await expect(
        service.createForStop({
          delivery: mockDelivery,
          stop: 'DROPOFF',
          note: 'Call 6941234567 at gate',
          courierId: courierA,
          actor: EnumLocationNoteActor.COURIER,
        })
      ).rejects.toBeInstanceOf(PersonalDataWarningException)

      expect(mockLocationNoteRepo.create).not.toHaveBeenCalled()
    })

    it('saves note containing personal data when confirmed: true (Save anyway)', async () => {
      await service.createForStop({
        delivery: mockDelivery,
        stop: 'DROPOFF',
        note: 'Code 12345678 on keypad',
        courierId: courierA,
        actor: EnumLocationNoteActor.COURIER,
        confirmed: true,
      })

      expect(mockLocationNoteRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ note: 'Code 12345678 on keypad' })
      )
    })
  })

  describe('update (AC-4, cross check 7)', () => {
    it('refuses personal data unless confirmed: true', async () => {
      await expect(service.update('note-1', 'Call Giannis at 6941234567')).rejects.toBeInstanceOf(
        PersonalDataWarningException
      )
      expect(mockLocationNoteRepo.update).not.toHaveBeenCalled()
    })

    it('updates text and does NOT reset the retention clock', async () => {
      await service.update('note-1', 'Updated: gate is now fixed', false)

      expect(mockLocationNoteRepo.update).toHaveBeenCalledWith('note-1', 'Updated: gate is now fixed')
      expect(mockLocationNoteRepo.markConfirmed).not.toHaveBeenCalled()
    })
  })

  describe('addOrRemoveReaction & upvote clock (AC-5, cross check 7)', () => {
    const existingNote = {
      id: 'note-1',
      courierId: courierA, // courierA is author
      latitude: 39.364,
      longitude: 22.948,
    } as any

    beforeEach(() => {
      mockLocationNoteRepo.findByIdOrThrow.mockResolvedValue(existingNote)
    })

    it('upvote by someone other than author creates reaction and restarts retention clock (markConfirmed)', async () => {
      mockReactionRepo.getNoteFromCourier.mockResolvedValue(null) // no existing reaction
      mockReactionRepo.create.mockResolvedValue({ id: 'react-1' } as any)

      await service.addOrRemoveReaction('note-1', courierB, EnumLocationNoteReactionType.UPVOTE)

      expect(mockReactionRepo.create).toHaveBeenCalledWith({
        locationNoteId: 'note-1',
        courierId: courierB,
        reaction: EnumLocationNoteReactionType.UPVOTE,
      })
      // Retention clock restarts on upvote by someone else
      expect(mockLocationNoteRepo.markConfirmed).toHaveBeenCalledWith('note-1', expect.any(Date))
    })

    it('upvote by the AUTHOR creates reaction but does NOT restart the retention clock', async () => {
      mockReactionRepo.getNoteFromCourier.mockResolvedValue(null)
      mockReactionRepo.create.mockResolvedValue({ id: 'react-author' } as any)

      await service.addOrRemoveReaction('note-1', courierA, EnumLocationNoteReactionType.UPVOTE)

      expect(mockReactionRepo.create).toHaveBeenCalled()
      // Author upvote does NOT restart clock
      expect(mockLocationNoteRepo.markConfirmed).not.toHaveBeenCalled()
    })

    it('repeating the same upvote toggles (deletes reaction) and does NOT roll back clock', async () => {
      mockReactionRepo.getNoteFromCourier.mockResolvedValue({
        id: 'react-existing',
        reaction: EnumLocationNoteReactionType.UPVOTE,
      } as any)
      mockReactionRepo.delete.mockResolvedValue({ id: 'react-existing' } as any)

      await service.addOrRemoveReaction('note-1', courierB, EnumLocationNoteReactionType.UPVOTE)

      expect(mockReactionRepo.delete).toHaveBeenCalledWith('react-existing')
      expect(mockLocationNoteRepo.markConfirmed).not.toHaveBeenCalled()
    })
  })

  describe('flag (AC-7, cross check 8)', () => {
    it('flags note once with optional reason when note exists', async () => {
      mockLocationNoteRepo.exists.mockResolvedValue(true)

      await service.flag('note-1', courierA, 'Inappropriate language')

      expect(mockLocationNoteRepo.flagOnce).toHaveBeenCalledWith('note-1', courierA, 'Inappropriate language')
    })

    it('throws NotFoundException when note does not exist', async () => {
      mockLocationNoteRepo.exists.mockResolvedValue(false)

      await expect(service.flag('note-missing', courierA, null)).rejects.toThrow(NotFoundException)
      expect(mockLocationNoteRepo.flagOnce).not.toHaveBeenCalled()
    })
  })

  describe('notesForJobs (AC-3, cross check 2, 5)', () => {
    it('fetches nearby notes for all stops, sorts them, and maps to author-free AddressNoteForCourier', async () => {
      const candidateNote = {
        id: 'note-nearby',
        note: 'Back gate code 1234',
        courierId: courierB,
        latitude: 39.364,
        longitude: 22.948,
        lastConfirmedAt: new Date(),
      } as any

      mockLocationNoteRepo.findInsideBoxes.mockResolvedValue([candidateNote])
      mockLocationNoteRepo.findCourierFacingCounts.mockResolvedValue({
        upvotes: new Map([['note-nearby', 2]]),
        upvotedByMe: new Set(['note-nearby']),
        flaggedByMe: new Set(),
      })

      const map = await service.notesForJobs([mockDelivery], courierA)

      expect(map.has('del-101')).toBe(true)
      const stopNotes = map.get('del-101')!

      expect(stopNotes.dropoff).toHaveLength(1)
      const noteDto = stopNotes.dropoff[0]!
      expect(noteDto.id).toBe('note-nearby')
      expect(noteDto.note).toBe('Back gate code 1234')
      expect(noteDto.upvotes).toBe(2)
      expect(noteDto.upvotedByMe).toBe(true)
      expect(noteDto.flaggedByMe).toBe(false)
      expect(noteDto.mine).toBe(false) // courierB != courierA

      // Critical: no author info
      expect((noteDto as any).courierId).toBeUndefined()
    })

    it('marks mine: true when note courierId equals the calling courier', async () => {
      const ownNote = {
        id: 'note-own',
        note: 'My note on this door',
        courierId: courierA,
        latitude: 39.364,
        longitude: 22.948,
        lastConfirmedAt: new Date(),
      } as any

      mockLocationNoteRepo.findInsideBoxes.mockResolvedValue([ownNote])
      mockLocationNoteRepo.findCourierFacingCounts.mockResolvedValue({
        upvotes: new Map(),
        upvotedByMe: new Set(),
        flaggedByMe: new Set(),
      })

      const map = await service.notesForJobs([mockDelivery], courierA)
      const noteDto = map.get('del-101')!.dropoff[0]!
      expect(noteDto.mine).toBe(true)
    })
  })

  describe('deleteExpired (AC-6)', () => {
    it('deletes notes last confirmed before the retention cutoff', async () => {
      mockLocationNoteRepo.deleteConfirmedBefore.mockResolvedValue(4)
      const fixedNow = new Date('2026-11-20T03:30:00Z')

      const deleted = await service.deleteExpired(182, fixedNow)

      expect(deleted).toBe(4)
      const expectedCutoff = new Date(fixedNow.getTime() - 182 * 24 * 60 * 60 * 1000)
      expect(mockLocationNoteRepo.deleteConfirmedBefore).toHaveBeenCalledWith(expectedCutoff)
    })
  })

  describe('adminFlagged & adminSearch & adminDelete & adminDismissFlags (AC-7)', () => {
    it('adminFlagged returns flagged notes with their flags and author included', async () => {
      mockLocationNoteRepo.findFlaggedForAdmin.mockResolvedValue([
        {
          id: 'note-flagged-1',
          note: 'Spam note',
          latitude: 39.364,
          longitude: 22.948,
          actor: EnumLocationNoteActor.COURIER,
          couriers: { id: 'c-1', firstName: 'John', lastName: 'Doe' },
          locations: { formattedAddress: 'Ermou 15, Volos', addressLine1: null, street: 'Ermou', houseNumber: '15', city: 'Volos' },
          flags: [{ id: 'flag-1', reason: 'Spam', createdAt: new Date() }],
        } as any,
      ])
      mockLocationNoteRepo.findUpvoteCountsForAdmin.mockResolvedValue(new Map([['note-flagged-1', 1]]))

      const flagged = await service.adminFlagged()
      expect(flagged).toHaveLength(1)
      expect((flagged[0] as any).authorCourierId).toBeUndefined() // on entity, author is on couriers object
      expect(flagged[0]?.couriers?.firstName).toBe('John')
      expect(flagged[0]?.address).toBe('Ermou 15, Volos')
      expect(flagged[0]?.upvotes).toBe(1)
    })

    it('adminSearch matches keywords in address text ignoring case and accents', async () => {
      mockLocationNoteRepo.findAllForAdmin.mockResolvedValue([
        {
          id: 'note-s1',
          latitude: 39.364,
          longitude: 22.948,
          locations: { street: 'Ιάσωνος', houseNumber: '10', city: 'Βόλος', formattedAddress: 'Ιάσωνος 10, Βόλος', addressLine1: null },
          couriers: null,
          flags: [],
        } as any,
        {
          id: 'note-s2',
          latitude: 39.368,
          longitude: 22.952,
          locations: { street: 'Δημητριάδος', houseNumber: '25', city: 'Βόλος', formattedAddress: 'Δημητριάδος 25, Βόλος', addressLine1: null },
          couriers: null,
          flags: [],
        } as any,
      ])

      // Search with unaccented latin or greek
      const result = await service.adminSearch('ιασωνοσ', 1, 10)
      expect(result.total).toBe(1)
      expect(result.data[0]?.id).toBe('note-s1')
    })

    it('adminDelete deletes note, creates AddressNoteDeletion, and logs admin action', async () => {
      const logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => {})
      mockLocationNoteRepo.deleteByAdmin.mockResolvedValue(true)

      await service.adminDelete('note-1', 'admin-user-1')

      expect(mockLocationNoteRepo.deleteByAdmin).toHaveBeenCalledWith('note-1', 'admin-user-1')
      expect(logSpy).toHaveBeenCalledWith(
        'ADDRESS_NOTE_DELETED_BY_ADMIN note note-1 by admin admin-user-1'
      )
      logSpy.mockRestore()
    })

    it('adminDelete throws NotFoundException when note does not exist', async () => {
      mockLocationNoteRepo.deleteByAdmin.mockResolvedValue(false)

      await expect(service.adminDelete('note-missing', 'admin-1')).rejects.toThrow(NotFoundException)
    })

    it('adminDismissFlags dismisses flags when note exists', async () => {
      mockLocationNoteRepo.exists.mockResolvedValue(true)

      await service.adminDismissFlags('note-1')

      expect(mockLocationNoteRepo.dismissFlags).toHaveBeenCalledWith('note-1')
    })

    it('adminDismissFlags throws NotFoundException when note does not exist', async () => {
      mockLocationNoteRepo.exists.mockResolvedValue(false)

      await expect(service.adminDismissFlags('note-missing')).rejects.toThrow(NotFoundException)
    })
  })
})
