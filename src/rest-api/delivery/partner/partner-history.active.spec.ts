import { EnumDeliveryStatus } from '@prisma/types'
import {
  PARTNER_ENDED_STATUSES,
  partnerHistoryCutoff,
  partnerHistoryWhere,
  isInPartnerHistory,
  olderThanHistoryMessage,
} from './partner-history'

describe('partner-history (Spec 0017, AC-2 & AC-3, decisions 28.2 & 28.3)', () => {
  const now = new Date('2026-11-02T12:00:00.000Z')
  const partnerId = 'partner-volos-nosh'

  describe('PARTNER_ENDED_STATUSES', () => {
    it('contains exactly DROPPED_OFF, CANCELED, and FAILED', () => {
      expect(PARTNER_ENDED_STATUSES).toEqual([
        EnumDeliveryStatus.DROPPED_OFF,
        EnumDeliveryStatus.CANCELED,
        EnumDeliveryStatus.FAILED,
      ])
    })
  })

  describe('partnerHistoryCutoff', () => {
    it('computes rolling cutoff: now minus N * 24 hours', () => {
      // 30 days = 30 * 24 * 60 * 60 * 1000 ms = 2,592,000,000 ms
      const cutoff30 = partnerHistoryCutoff(30, now)
      expect(cutoff30.getTime()).toBe(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      expect(cutoff30.toISOString()).toBe('2026-10-03T12:00:00.000Z')

      // 1 day = 24 hours
      const cutoff1 = partnerHistoryCutoff(1, now)
      expect(cutoff1.getTime()).toBe(now.getTime() - 1 * 24 * 60 * 60 * 1000)
      expect(cutoff1.toISOString()).toBe('2026-11-01T12:00:00.000Z')
    })
  })

  describe('partnerHistoryWhere', () => {
    it('always sets partnerId and ORs cutoff condition with open status condition', () => {
      const days = 30
      const where = partnerHistoryWhere(partnerId, days, now)

      expect(where.partnerId).toBe(partnerId)
      expect(where.OR).toEqual([
        {
          createdAt: {
            gte: partnerHistoryCutoff(days, now),
          },
        },
        {
          status: {
            notIn: [
              EnumDeliveryStatus.DROPPED_OFF,
              EnumDeliveryStatus.CANCELED,
              EnumDeliveryStatus.FAILED,
            ],
          },
        },
      ])
    })
  })

  describe('isInPartnerHistory', () => {
    const days = 30
    const cutoff = partnerHistoryCutoff(days, now)

    describe('ended deliveries', () => {
      it('an ended delivery exactly at the cutoff is in (true)', () => {
        expect(
          isInPartnerHistory(
            { createdAt: new Date(cutoff.getTime()), status: EnumDeliveryStatus.DROPPED_OFF },
            days,
            now
          )
        ).toBe(true)
      })

      it('an ended delivery one millisecond newer than cutoff is in (true)', () => {
        expect(
          isInPartnerHistory(
            { createdAt: new Date(cutoff.getTime() + 1), status: EnumDeliveryStatus.DROPPED_OFF },
            days,
            now
          )
        ).toBe(true)
      })

      it('an ended delivery one millisecond older than cutoff is out (false)', () => {
        expect(
          isInPartnerHistory(
            { createdAt: new Date(cutoff.getTime() - 1), status: EnumDeliveryStatus.DROPPED_OFF },
            days,
            now
          )
        ).toBe(false)
      })

      it('an ended delivery days older than cutoff is out (false)', () => {
        expect(
          isInPartnerHistory(
            { createdAt: new Date(cutoff.getTime() - 5 * 24 * 60 * 60 * 1000), status: EnumDeliveryStatus.DROPPED_OFF },
            days,
            now
          )
        ).toBe(false)
      })

      it('FAILED status counts as ended and is out when older than cutoff', () => {
        expect(
          isInPartnerHistory(
            { createdAt: new Date(cutoff.getTime() - 1), status: EnumDeliveryStatus.FAILED },
            days,
            now
          )
        ).toBe(false)
      })

      it('CANCELED status counts as ended and is out when older than cutoff', () => {
        expect(
          isInPartnerHistory(
            { createdAt: new Date(cutoff.getTime() - 1), status: EnumDeliveryStatus.CANCELED },
            days,
            now
          )
        ).toBe(false)
      })
    })

    describe('open deliveries', () => {
      const openStatuses: EnumDeliveryStatus[] = [
        EnumDeliveryStatus.CREATED,
        EnumDeliveryStatus.ASSIGNING_COURIER,
        EnumDeliveryStatus.ACCEPTED,
        EnumDeliveryStatus.DISPATCHED,
        EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
        EnumDeliveryStatus.PICKED_UP,
        EnumDeliveryStatus.ON_THE_WAY,
        EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
      ]

      openStatuses.forEach((status) => {
        it(`an open delivery of status ${status} is in (true) even when 100 days older than cutoff`, () => {
          const ancientDate = new Date(cutoff.getTime() - 100 * 24 * 60 * 60 * 1000)
          expect(
            isInPartnerHistory(
              { createdAt: ancientDate, status },
              days,
              now
            )
          ).toBe(true)
        })
      })
    })
  })

  describe('olderThanHistoryMessage', () => {
    it('uses plural "days" for numbers other than 1', () => {
      expect(olderThanHistoryMessage(30)).toBe(
        'This order is older than 30 days. The co-op can look it up for you.'
      )
      expect(olderThanHistoryMessage(7)).toBe(
        'This order is older than 7 days. The co-op can look it up for you.'
      )
    })

    it('uses singular "1 day" when days is 1', () => {
      expect(olderThanHistoryMessage(1)).toBe(
        'This order is older than 1 day. The co-op can look it up for you.'
      )
    })
  })
})
