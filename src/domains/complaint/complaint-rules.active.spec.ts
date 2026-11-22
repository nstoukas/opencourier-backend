import {
  EnumComplaintAbout,
  EnumComplaintCategory,
  EnumComplaintFiledBy,
  EnumComplaintStatus,
  EnumDeliveryStatus,
} from '@prisma/types'
import {
  ABOUT_ALLOWED_FOR,
  COMPLAINT_CATEGORIES,
  COMPLAINT_OPEN_STATUSES,
  COMPLAINT_TEXT_MAX,
  RESTAURANT_COMPLAINT_STATUSES,
  categoryFits,
  cleanText,
  openForKey,
  startingStatus,
} from './complaint-rules'

describe('ComplaintRules (Spec 0052, AC-1, AC-3, AC-5, cross check 6)', () => {
  describe('COMPLAINT_CATEGORIES & categoryFits (AC-1)', () => {
    it('defines the exact category list for RESTAURANT', () => {
      expect(COMPLAINT_CATEGORIES[EnumComplaintAbout.RESTAURANT]).toEqual([
        EnumComplaintCategory.LONG_WAIT,
        EnumComplaintCategory.FOOD_NOT_READY,
        EnumComplaintCategory.UNSAFE_PACKAGING,
        EnumComplaintCategory.RUDE_STAFF,
        EnumComplaintCategory.OTHER,
      ])
    })

    it('defines the exact category list for CUSTOMER', () => {
      expect(COMPLAINT_CATEGORIES[EnumComplaintAbout.CUSTOMER]).toEqual([
        EnumComplaintCategory.ABUSE_OR_THREAT,
        EnumComplaintCategory.UNSAFE_ADDRESS,
        EnumComplaintCategory.NOT_ANSWERING,
        EnumComplaintCategory.OTHER,
      ])
    })

    it('defines the exact category list for RIDER', () => {
      expect(COMPLAINT_CATEGORIES[EnumComplaintAbout.RIDER]).toEqual([
        EnumComplaintCategory.LATE,
        EnumComplaintCategory.RUDE,
        EnumComplaintCategory.FOOD_DAMAGED,
        EnumComplaintCategory.OTHER,
      ])
    })

    it('accepts valid category combinations', () => {
      expect(categoryFits(EnumComplaintAbout.RESTAURANT, EnumComplaintCategory.LONG_WAIT)).toBe(true)
      expect(categoryFits(EnumComplaintAbout.CUSTOMER, EnumComplaintCategory.ABUSE_OR_THREAT)).toBe(true)
      expect(categoryFits(EnumComplaintAbout.RIDER, EnumComplaintCategory.LATE)).toBe(true)
      // OTHER is valid for all three
      expect(categoryFits(EnumComplaintAbout.RESTAURANT, EnumComplaintCategory.OTHER)).toBe(true)
      expect(categoryFits(EnumComplaintAbout.CUSTOMER, EnumComplaintCategory.OTHER)).toBe(true)
      expect(categoryFits(EnumComplaintAbout.RIDER, EnumComplaintCategory.OTHER)).toBe(true)
    })

    it('rejects mismatched categories across about targets', () => {
      // Long wait is restaurant only, cannot be applied to rider or customer
      expect(categoryFits(EnumComplaintAbout.RIDER, EnumComplaintCategory.LONG_WAIT)).toBe(false)
      expect(categoryFits(EnumComplaintAbout.CUSTOMER, EnumComplaintCategory.LONG_WAIT)).toBe(false)
      // Late is rider only
      expect(categoryFits(EnumComplaintAbout.RESTAURANT, EnumComplaintCategory.LATE)).toBe(false)
      // Abuse or threat is customer only
      expect(categoryFits(EnumComplaintAbout.RESTAURANT, EnumComplaintCategory.ABUSE_OR_THREAT)).toBe(false)
      expect(categoryFits(EnumComplaintAbout.RIDER, EnumComplaintCategory.ABUSE_OR_THREAT)).toBe(false)
    })
  })

  describe('ABOUT_ALLOWED_FOR (AC-1, AC-3)', () => {
    it('allows rider to complain about RESTAURANT and CUSTOMER only', () => {
      expect(ABOUT_ALLOWED_FOR[EnumComplaintFiledBy.RIDER]).toEqual([
        EnumComplaintAbout.RESTAURANT,
        EnumComplaintAbout.CUSTOMER,
      ])
    })

    it('allows restaurant to complain about RIDER only', () => {
      expect(ABOUT_ALLOWED_FOR[EnumComplaintFiledBy.RESTAURANT]).toEqual([
        EnumComplaintAbout.RIDER,
      ])
    })

    it('allows admin to complain about RIDER only', () => {
      expect(ABOUT_ALLOWED_FOR[EnumComplaintFiledBy.ADMIN]).toEqual([
        EnumComplaintAbout.RIDER,
      ])
    })
  })

  describe('startingStatus (AC-1, AC-3, cross check 6)', () => {
    it('starts at AWAITING_REPLY when about RIDER', () => {
      expect(startingStatus(EnumComplaintAbout.RIDER)).toBe(EnumComplaintStatus.AWAITING_REPLY)
    })

    it('starts at OPEN when about RESTAURANT or CUSTOMER', () => {
      expect(startingStatus(EnumComplaintAbout.RESTAURANT)).toBe(EnumComplaintStatus.OPEN)
      expect(startingStatus(EnumComplaintAbout.CUSTOMER)).toBe(EnumComplaintStatus.OPEN)
    })
  })

  describe('COMPLAINT_OPEN_STATUSES & RESTAURANT_COMPLAINT_STATUSES (AC-3, AC-5)', () => {
    it('treats OPEN and AWAITING_REPLY as open statuses', () => {
      expect(COMPLAINT_OPEN_STATUSES).toEqual([
        EnumComplaintStatus.OPEN,
        EnumComplaintStatus.AWAITING_REPLY,
      ])
    })

    it('allows restaurants to file only on DROPPED_OFF or CANCELED deliveries', () => {
      expect(RESTAURANT_COMPLAINT_STATUSES).toEqual([
        EnumDeliveryStatus.DROPPED_OFF,
        EnumDeliveryStatus.CANCELED,
      ])
    })
  })

  describe('openForKey (cross check 6 & decision 83.1)', () => {
    it('formats key as <kind>:<id>:<deliveryId>:<about>', () => {
      const key = openForKey(
        { kind: 'RIDER', id: 'courier-123' },
        'del-456',
        EnumComplaintAbout.RESTAURANT
      )
      expect(key).toBe('RIDER:courier-123:del-456:RESTAURANT')
    })

    it('distinguishes restaurant and customer complaints on the same delivery for a rider', () => {
      const restaurantKey = openForKey(
        { kind: 'RIDER', id: 'courier-1' },
        'del-1',
        EnumComplaintAbout.RESTAURANT
      )
      const customerKey = openForKey(
        { kind: 'RIDER', id: 'courier-1' },
        'del-1',
        EnumComplaintAbout.CUSTOMER
      )
      expect(restaurantKey).not.toEqual(customerKey)
    })
  })

  describe('cleanText (AC-1, AC-2, AC-5)', () => {
    it('returns trimmed string for valid text between 1 and 1000 chars', () => {
      expect(cleanText('  Valid complaint text  ')).toBe('Valid complaint text')
      expect(cleanText('x')).toBe('x')
      expect(cleanText('a'.repeat(COMPLAINT_TEXT_MAX))).toBe('a'.repeat(COMPLAINT_TEXT_MAX))
    })

    it('returns null for empty string or whitespace only', () => {
      expect(cleanText('')).toBeNull()
      expect(cleanText('   ')).toBeNull()
      expect(cleanText('\n\t  \n')).toBeNull()
    })

    it('returns null if trimmed text exceeds 1000 characters', () => {
      const tooLong = 'a'.repeat(1001)
      expect(cleanText(tooLong)).toBeNull()
      expect(cleanText(`  ${tooLong}  `)).toBeNull()
    })
  })
})
