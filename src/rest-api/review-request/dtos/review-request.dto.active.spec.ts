import { EnumReviewOutcome, EnumReviewRequestStatus, EnumReviewTopic } from '@prisma/types'
import { ReviewRequestRecord } from 'src/persistence/repositories/review-request.repository'
import { ReviewRequestAdminDto, ReviewRequestCourierDto } from './review-request.dto'

describe('ReviewRequestDto (spec 0038, AC-5, AC-8)', () => {
  const fixedNow = new Date('2026-11-19T10:00:00.000Z')
  const pastDate = new Date('2026-11-15T10:00:00.000Z')
  const futureDate = new Date('2026-11-25T10:00:00.000Z')

  const baseRecord: ReviewRequestRecord = {
    id: 'req-1',
    topic: EnumReviewTopic.PAY,
    note: 'Pay amount looks incorrect for distance',
    status: EnumReviewRequestStatus.OPEN,
    createdAt: new Date('2026-11-01T10:00:00.000Z'),
    dueAt: pastDate,
    openFor: 'courier-1:del-1',
    courierId: 'courier-1',
    deliveryId: 'del-1',
    answeredByUserId: null,
    answeredAt: null,
    outcome: null,
    answer: null,
    withdrawnAt: null,
    delivery: {
      id: 'del-1',
      pickupBusinessName: 'Volos Bakery',
      createdAt: new Date('2026-11-01T09:30:00.000Z'),
    },
    courier: {
      firstName: 'Kostas',
      lastName: 'Georgiou',
    },
    answeredBy: null,
    correctionCents: null,
    correctionCurrency: null,
  }

  describe('ReviewRequestCourierDto overdue calculation (AC-8)', () => {
    it('an OPEN request with dueAt in the past reads overdue true', () => {
      const record: ReviewRequestRecord = {
        ...baseRecord,
        status: EnumReviewRequestStatus.OPEN,
        dueAt: pastDate,
      }
      const dto = new ReviewRequestCourierDto(record, fixedNow)
      expect(dto.overdue).toBe(true)
    })

    it('an OPEN request with dueAt in the future reads overdue false', () => {
      const record: ReviewRequestRecord = {
        ...baseRecord,
        status: EnumReviewRequestStatus.OPEN,
        dueAt: futureDate,
      }
      const dto = new ReviewRequestCourierDto(record, fixedNow)
      expect(dto.overdue).toBe(false)
    })

    it('an ANSWERED request with dueAt in the past reads overdue false', () => {
      const record: ReviewRequestRecord = {
        ...baseRecord,
        status: EnumReviewRequestStatus.ANSWERED,
        dueAt: pastDate,
        outcome: EnumReviewOutcome.STANDS,
        answer: 'Decision was according to rules',
        answeredAt: new Date('2026-11-16T10:00:00.000Z'),
      }
      const dto = new ReviewRequestCourierDto(record, fixedNow)
      expect(dto.overdue).toBe(false)
    })

    it('a WITHDRAWN request with dueAt in the past reads overdue false', () => {
      const record: ReviewRequestRecord = {
        ...baseRecord,
        status: EnumReviewRequestStatus.WITHDRAWN,
        dueAt: pastDate,
        withdrawnAt: new Date('2026-11-10T10:00:00.000Z'),
      }
      const dto = new ReviewRequestCourierDto(record, fixedNow)
      expect(dto.overdue).toBe(false)
    })
  })

  describe('ReviewRequestAdminDto overdue calculation (AC-5)', () => {
    it('an OPEN request with dueAt in the past reads overdue true', () => {
      const record: ReviewRequestRecord = {
        ...baseRecord,
        status: EnumReviewRequestStatus.OPEN,
        dueAt: pastDate,
      }
      const dto = new ReviewRequestAdminDto(record, fixedNow)
      expect(dto.overdue).toBe(true)
      expect(dto.courierName).toBe('Kostas Georgiou')
    })

    it('an OPEN request with dueAt in the future reads overdue false', () => {
      const record: ReviewRequestRecord = {
        ...baseRecord,
        status: EnumReviewRequestStatus.OPEN,
        dueAt: futureDate,
      }
      const dto = new ReviewRequestAdminDto(record, fixedNow)
      expect(dto.overdue).toBe(false)
    })

    it('an ANSWERED request with dueAt in the past reads overdue false', () => {
      const record: ReviewRequestRecord = {
        ...baseRecord,
        status: EnumReviewRequestStatus.ANSWERED,
        dueAt: pastDate,
        outcome: EnumReviewOutcome.CHANGED,
        answer: 'Adjusted pay',
        answeredAt: new Date('2026-11-16T10:00:00.000Z'),
        answeredBy: { id: 'admin-1', email: 'admin@coop.gr', username: 'admin' },
      }
      const dto = new ReviewRequestAdminDto(record, fixedNow)
      expect(dto.overdue).toBe(false)
      expect(dto.answeredBy).toBe('admin@coop.gr')
    })

    it('a WITHDRAWN request with dueAt in the past reads overdue false', () => {
      const record: ReviewRequestRecord = {
        ...baseRecord,
        status: EnumReviewRequestStatus.WITHDRAWN,
        dueAt: pastDate,
        withdrawnAt: new Date('2026-11-10T10:00:00.000Z'),
      }
      const dto = new ReviewRequestAdminDto(record, fixedNow)
      expect(dto.overdue).toBe(false)
    })
  })
})
