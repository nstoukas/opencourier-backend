import {
  EnumComplaintAbout,
  EnumComplaintCategory,
  EnumComplaintFiledBy,
  EnumComplaintStatus,
  EnumDeliveryStatus,
} from '@prisma/types'
import {
  ComplaintAdminDto,
  ComplaintCourierDto,
  ComplaintCourierRole,
  ComplaintPartnerDto,
  ComplaintPartnerStatus,
} from './complaint.dto'
import { ComplaintRecord } from 'src/persistence/repositories/complaint.repository'

describe('Complaint DTOs (Spec 0052, AC-4, AC-6, AC-7, cross check 7)', () => {
  const sampleDelivery = {
    id: 'del-1',
    pickupBusinessName: 'Souvlaki Bar',
    createdAt: new Date('2026-11-20T12:00:00Z'),
    status: EnumDeliveryStatus.DROPPED_OFF,
  }

  const baseRecord: ComplaintRecord = {
    id: 'comp-100',
    filedBy: EnumComplaintFiledBy.RESTAURANT,
    about: EnumComplaintAbout.RIDER,
    category: EnumComplaintCategory.LATE,
    text: 'Rider took 50 minutes to deliver.',
    status: EnumComplaintStatus.AWAITING_REPLY,
    createdAt: new Date('2026-11-20T13:00:00Z'),
    openFor: 'RESTAURANT:partner-1:del-1:RIDER',
    photoKey: null,
    deliveryId: 'del-1',
    filerCourierId: null,
    filerPartnerId: 'partner-1',
    filerAdminId: null,
    aboutCourierId: 'courier-1',
    riderReply: null,
    repliedAt: null,
    replyEnteredByUserId: null,
    replyEnteredForRider: false,
    outcome: null,
    decidedAt: null,
    decidedByUserId: null,
    withdrawnReason: null,
    withdrawnAt: null,
    withdrawnByUserId: null,
    delivery: sampleDelivery,
    filerCourier: null,
    filerPartner: { id: 'partner-1', name: 'Souvlaki Bar' },
    filerAdmin: null,
    aboutCourier: {
      id: 'courier-1',
      firstName: 'Kostas',
      lastName: 'Papadopoulos',
      deactivatedAt: null,
    },
    replyEnteredBy: null,
    decidedBy: null,
    withdrawnBy: null,
  }

  describe('ComplaintCourierDto (AC-4, AC-7, cross check 7)', () => {
    it('determines role as ABOUT_YOU when aboutCourierId matches courier', () => {
      const dto = new ComplaintCourierDto(baseRecord, 'courier-1')
      expect(dto.role).toBe(ComplaintCourierRole.ABOUT_YOU)
      expect(dto.filedBy).toBe(EnumComplaintFiledBy.RESTAURANT)
    })

    it('determines role as FILED_BY_YOU when aboutCourierId does not match', () => {
      const filedRecord: ComplaintRecord = {
        ...baseRecord,
        filedBy: EnumComplaintFiledBy.RIDER,
        about: EnumComplaintAbout.RESTAURANT,
        filerCourierId: 'courier-1',
        aboutCourierId: null,
      }
      const dto = new ComplaintCourierDto(filedRecord, 'courier-1')
      expect(dto.role).toBe(ComplaintCourierRole.FILED_BY_YOU)
    })

    it('hasPhoto is true ONLY for the filer courier, never for the about courier (AC-9)', () => {
      const recordWithPhoto: ComplaintRecord = {
        ...baseRecord,
        filedBy: EnumComplaintFiledBy.RIDER,
        filerCourierId: 'courier-filer',
        aboutCourierId: 'courier-target',
        photoKey: 'secret-uuid.jpg',
      }

      // Filer rider sees hasPhoto = true
      const filerDto = new ComplaintCourierDto(recordWithPhoto, 'courier-filer')
      expect(filerDto.hasPhoto).toBe(true)

      // About rider sees hasPhoto = false
      const targetDto = new ComplaintCourierDto(recordWithPhoto, 'courier-target')
      expect(targetDto.hasPhoto).toBe(false)

      // Photo key itself is never exposed
      expect((filerDto as any).photoKey).toBeUndefined()
      expect((targetDto as any).photoKey).toBeUndefined()
    })

    it('indicates replyEnteredForRider when the stored flag is set', () => {
      const adminEnteredRecord: ComplaintRecord = {
        ...baseRecord,
        riderReply: 'Reply via phone',
        replyEnteredByUserId: 'admin-1',
        replyEnteredForRider: true,
      }
      const dto = new ComplaintCourierDto(adminEnteredRecord, 'courier-1')
      expect(dto.replyEnteredForRider).toBe(true)
    })

    it('never exposes admin IDs or admin labels to courier', () => {
      const recordWithAdminData: ComplaintRecord = {
        ...baseRecord,
        filedBy: EnumComplaintFiledBy.ADMIN,
        filerAdminId: 'admin-secret-id',
        decidedByUserId: 'admin-decider-id',
        withdrawnByUserId: 'admin-withdrawer-id',
        replyEnteredByUserId: 'admin-phone-id',
        replyEnteredForRider: true,
        decidedBy: { id: 'admin-decider-id', email: 'admin@coop.gr', username: 'superadmin' },
      }
      const dto = new ComplaintCourierDto(recordWithAdminData, 'courier-1')

      expect((dto as any).filerAdminId).toBeUndefined()
      expect((dto as any).decidedByUserId).toBeUndefined()
      expect((dto as any).decidedBy).toBeUndefined()
      expect((dto as any).withdrawnByUserId).toBeUndefined()
      expect((dto as any).withdrawnBy).toBeUndefined()
      expect((dto as any).replyEnteredBy).toBeUndefined()
    })
  })

  describe('ComplaintPartnerDto (AC-7, cross check 7)', () => {
    it('maps AWAITING_REPLY to OPEN for restaurant view', () => {
      const awaitingRecord: ComplaintRecord = {
        ...baseRecord,
        status: EnumComplaintStatus.AWAITING_REPLY,
      }
      const dto = new ComplaintPartnerDto(awaitingRecord)
      expect(dto.status).toBe(ComplaintPartnerStatus.OPEN)
    })

    it('preserves DECIDED and WITHDRAWN statuses', () => {
      const decidedDto = new ComplaintPartnerDto({
        ...baseRecord,
        status: EnumComplaintStatus.DECIDED,
        outcome: 'Co-op spoke with rider.',
        decidedAt: new Date(),
      })
      expect(decidedDto.status).toBe(ComplaintPartnerStatus.DECIDED)
      expect(decidedDto.outcome).toBe('Co-op spoke with rider.')

      const withdrawnDto = new ComplaintPartnerDto({
        ...baseRecord,
        status: EnumComplaintStatus.WITHDRAWN,
        withdrawnReason: 'Partner withdrew.',
      })
      expect(withdrawnDto.status).toBe(ComplaintPartnerStatus.WITHDRAWN)
      expect(withdrawnDto.withdrawnReason).toBe('Partner withdrew.')
    })

    it('never exposes rider reply or admin details to restaurant', () => {
      const recordWithSecrets: ComplaintRecord = {
        ...baseRecord,
        status: EnumComplaintStatus.DECIDED,
        riderReply: 'Rider private explanation',
        repliedAt: new Date(),
        decidedByUserId: 'admin-user-id',
        decidedBy: { id: 'admin-user-id', email: 'admin@coop.gr', username: 'admin' },
      }
      const dto = new ComplaintPartnerDto(recordWithSecrets)

      expect((dto as any).riderReply).toBeUndefined()
      expect((dto as any).repliedAt).toBeUndefined()
      expect((dto as any).decidedBy).toBeUndefined()
      expect((dto as any).decidedByUserId).toBeUndefined()
    })
  })

  describe('ComplaintAdminDto (AC-6, AC-7)', () => {
    it('exposes full details including filer names and admin labels', () => {
      const fullRecord: ComplaintRecord = {
        ...baseRecord,
        status: EnumComplaintStatus.DECIDED,
        outcome: 'Warning issued',
        decidedAt: new Date('2026-11-21T10:00:00Z'),
        decidedByUserId: 'admin-1',
        decidedBy: { id: 'admin-1', email: 'dispatcher@coop.gr', username: 'dispatch' },
        aboutCourierDeactivated: false,
      } as any

      const dto = new ComplaintAdminDto(fullRecord)

      expect(dto.id).toBe('comp-100')
      expect(dto.filerName).toBe('Souvlaki Bar')
      expect(dto.aboutCourierName).toBe('Kostas Papadopoulos')
      expect(dto.aboutCourierDeactivated).toBe(false)
      expect(dto.outcome).toBe('Warning issued')
      expect(dto.decidedBy).toBe('dispatcher@coop.gr')
      expect(dto.hasPhoto).toBe(false)
    })

    it('formats admin label prioritizing email then username then id', () => {
      const recordWithEmail: ComplaintRecord = {
        ...baseRecord,
        decidedBy: { id: 'admin-id', email: 'email@coop.gr', username: 'user' },
      }
      expect(new ComplaintAdminDto(recordWithEmail).decidedBy).toBe('email@coop.gr')

      const recordWithUsername: ComplaintRecord = {
        ...baseRecord,
        decidedBy: { id: 'admin-id', email: null, username: 'adminuser' },
      }
      expect(new ComplaintAdminDto(recordWithUsername).decidedBy).toBe('adminuser')

      const recordWithIdOnly: ComplaintRecord = {
        ...baseRecord,
        decidedBy: { id: 'admin-id-only', email: null, username: null },
      }
      expect(new ComplaintAdminDto(recordWithIdOnly).decidedBy).toBe('admin-id-only')
    })
  })

  describe('ComplaintCourierPagingDto (AC-8 & ruling 2026-11-22)', () => {
    it('contains only cursor fields (currentPage, perPage, prevPage, nextPage) and no totals', () => {
      const dto = {
        currentPage: 2,
        perPage: 15,
        prevPage: 1,
        nextPage: 3,
      }

      expect(dto.currentPage).toBe(2)
      expect(dto.perPage).toBe(15)
      expect(dto.prevPage).toBe(1)
      expect(dto.nextPage).toBe(3)
      expect((dto as any).total).toBeUndefined()
      expect((dto as any).totalItems).toBeUndefined()
      expect((dto as any).totalPages).toBeUndefined()
      expect((dto as any).currentItems).toBeUndefined()
    })
  })
})
