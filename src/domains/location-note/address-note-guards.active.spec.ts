import { AddressNoteCourierDto } from 'src/rest-api/location-note/courier/dtos/address-note.courier.dto'
import { AddressNoteAdminDto } from 'src/rest-api/address-note/admin/dtos/address-note.admin.dto'
import { InProgressDeliveryCourierDto } from 'src/rest-api/delivery/courier/dtos/in-progress-delivery.courier.dto'
import { LocationNoteDomainService } from './location-note.domain.service'
import { PersonalDataWarningException } from 'src/errors'
import { EnumLocationNoteActor } from '@prisma/types'

describe('Address note security and value 5 guards (Spec 0053 AC-9, cross check 12)', () => {
  describe('Guard 1: Drop off / job card DTO carries NO author (AC-9, AC-3, cross check 5)', () => {
    it('AddressNoteCourierDto contains no authorCourierId, courierId, authorName, or actor', () => {
      const dto = new AddressNoteCourierDto({
        id: 'note-1',
        note: 'Ring bell 2B',
        upvotes: 3,
        upvotedByMe: true,
        flaggedByMe: false,
        mine: false,
      })

      // Keys check
      const keys = Object.keys(dto)
      expect(keys).toContain('id')
      expect(keys).toContain('note')
      expect(keys).toContain('upvotes')
      expect(keys).toContain('upvotedByMe')
      expect(keys).toContain('flaggedByMe')
      expect(keys).toContain('mine')

      // Forbidden author fields must not exist
      expect((dto as any).courierId).toBeUndefined()
      expect((dto as any).authorCourierId).toBeUndefined()
      expect((dto as any).authorName).toBeUndefined()
      expect((dto as any).author).toBeUndefined()
      expect((dto as any).actor).toBeUndefined()

      const serialized = JSON.stringify(dto)
      expect(serialized).not.toMatch(/courierId|author|actor/i)
    })
  })

  describe('Guard 2: Nightly job deletes expired notes based on retention setting (AC-9, AC-6)', () => {
    it('deleteExpired computes cutoff strictly from retentionDays and deletes confirmed before cutoff', async () => {
      const mockRepo: any = {
        deleteConfirmedBefore: jest.fn().mockResolvedValue(3),
      }
      const service = new LocationNoteDomainService(mockRepo, {} as any)

      const fixedNow = new Date('2026-11-20T03:30:00Z')
      const retentionDays = 182 // ~6 months

      const count = await service.deleteExpired(retentionDays, fixedNow)

      expect(count).toBe(3)
      expect(mockRepo.deleteConfirmedBefore).toHaveBeenCalledTimes(1)

      const cutoff = mockRepo.deleteConfirmedBefore.mock.calls[0][0] as Date
      const expectedCutoff = new Date(fixedNow.getTime() - 182 * 24 * 60 * 60 * 1000)
      expect(cutoff.getTime()).toBe(expectedCutoff.getTime())

      // A note confirmed 183 days ago is older than cutoff (deleted);
      // a note confirmed 181 days ago is newer than cutoff (kept).
      const note183DaysOld = new Date(fixedNow.getTime() - 183 * 24 * 60 * 60 * 1000)
      const note181DaysOld = new Date(fixedNow.getTime() - 181 * 24 * 60 * 60 * 1000)

      expect(note183DaysOld.getTime()).toBeLessThan(cutoff.getTime()) // Expired -> deleted
      expect(note181DaysOld.getTime()).toBeGreaterThan(cutoff.getTime()) // Fresh -> kept
    })
  })

  describe('Guard 3: Note with a phone number refuses to save without confirmed: true (AC-9, AC-4)', () => {
    let service: LocationNoteDomainService

    beforeEach(() => {
      service = new LocationNoteDomainService({} as any, {} as any)
    })

    it('refuses note containing phone number when confirmed is undefined', () => {
      expect(() => {
        service.refuseIfPersonalData('Call 6941234567 at door', undefined)
      }).toThrow(PersonalDataWarningException)
    })

    it('refuses note containing phone number when confirmed is false', () => {
      expect(() => {
        service.refuseIfPersonalData('+30 694 123 4567', false)
      }).toThrow(PersonalDataWarningException)
    })

    it('allows note containing phone number when confirmed is explicitly true', () => {
      expect(() => {
        service.refuseIfPersonalData('Call 6941234567 at door', true)
      }).not.toThrow()
    })

    it('refusal error status is 422 and message is the fixed sentence with no phone text', () => {
      try {
        service.refuseIfPersonalData('Call 6941234567 at door', undefined)
        fail('Should have thrown')
      } catch (err: any) {
        expect(err).toBeInstanceOf(PersonalDataWarningException)
        expect(err.getStatus()).toBe(422)
        expect(err.message).toBe(
          'Notes describe the place, never the person. This looks like it holds a name, phone or email.'
        )
        // Message must NOT leak what the user typed
        expect(err.message).not.toContain('6941234567')
      }
    })
  })

  describe('Guard 4: No DTO carries a per-author upvote total or ranking (AC-5, AC-9, cross check 12, value 5)', () => {
    it('AddressNoteCourierDto and AddressNoteAdminDto do not expose authorTotalUpvotes or authorRank', () => {
      const courierDto = new AddressNoteCourierDto({
        id: 'note-1',
        note: 'Rear entrance',
        upvotes: 4,
        upvotedByMe: false,
        flaggedByMe: false,
        mine: true,
      })

      expect((courierDto as any).authorTotalUpvotes).toBeUndefined()
      expect((courierDto as any).totalAuthorUpvotes).toBeUndefined()
      expect((courierDto as any).authorUpvoteCount).toBeUndefined()
      expect((courierDto as any).authorRank).toBeUndefined()

      const adminDto = new AddressNoteAdminDto({
        id: 'note-1',
        note: 'Rear entrance',
        latitude: 39.364,
        longitude: 22.948,
        address: 'Iasonos 10, Volos',
        actor: EnumLocationNoteActor.COURIER,
        courierId: 'courier-1',
        deliveryId: 'del-1',
        locationId: 'loc-1',
        couriers: { id: 'courier-1', firstName: 'Nikos', lastName: 'Pap' },
        upvotes: 4,
        flags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        lastConfirmedAt: new Date(),
        locations: null,
      })

      // Admin DTO has the author for abuse investigation, but NEVER a running score or total upvotes of author
      expect((adminDto as any).authorTotalUpvotes).toBeUndefined()
      expect((adminDto as any).authorRank).toBeUndefined()
      expect((adminDto as any).authorUpvotesTotal).toBeUndefined()
    })
  })
})
