import { EnumAddOnMoment, EnumTwoOrderPolicy } from 'src/shared-types/stacking'
import {
  EnumCourierCompensationCalculationType,
  EnumCourierDietaryRestrictions,
  EnumCourierMatcherType,
  EnumCurrency,
  EnumDeliveryDurationCalculationType,
  EnumDistanceUnit,
  EnumGeoCalculationType,
  EnumQuoteCalculationType,
  InstanceConfigSettings,
  InstanceDetails,
} from 'src/shared-types'
import { WorkRulesService, HowItWorks, EN_WORDS } from './work-rules.service'
import { EL_WORDS } from './work-rules.el'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { RemovalRequestRepository } from 'src/persistence/repositories/removal-request.repository'
import { SettingChangeRepository } from 'src/persistence/repositories/setting-change.repository'
import { RIDER_REACH_MONTHS } from 'src/services/time-worked/time-worked.service'
import { RIDER_FACING_SETTINGS, RIDER_FACING_SETTING_KEYS } from 'src/shared-types/rider-facing-settings'
import { RIDER_FACING_SETTINGS_EL } from 'src/shared-types/rider-facing-settings.el'

describe('WorkRules Greek "How offers and pay work" (row 137, problem 15)', () => {
  let service: WorkRulesService
  let mockConfigDomainService: jest.Mocked<ConfigDomainService>
  let mockRemovalRequestRepository: jest.Mocked<RemovalRequestRepository>
  let mockSettingChangeRepository: jest.Mocked<SettingChangeRepository>

  const baseSettings: InstanceConfigSettings = {
    courierMatcherType: EnumCourierMatcherType.FAIRNESS,
    quoteCalculationType: EnumQuoteCalculationType.BY_DISTANCE,
    geoCalculationType: EnumGeoCalculationType.HAVERSINE,
    deliveryDurationCalculationType: EnumDeliveryDurationCalculationType.OSRM,
    courierCompensationCalculationType: EnumCourierCompensationCalculationType.FROM_QUOTE_FROM,
    defaultDietaryRestrictions: EnumCourierDietaryRestrictions.NONE,
    distanceUnit: EnumDistanceUnit.KILOMETERS,
    currency: EnumCurrency.EUR,
    maxAssignmentDistance: 20,
    maxDriftDistance: 5,
    quoteExpirationMinutes: 15,
    feePercentageAmount: 10,
    feePercentageCeiling: 25,
    quoteRatePerDistanceUnit: 150,
    quoteBaseFee: 200,
    defaultCourierPayRate: 300,
    defaultMaxWorkingHours: 8,
    details: {} as InstanceDetails,
    updatedAt: '2026-11-23T10:00:00.000Z',
    registeredRegistries: [],
    reassignmentPayoutPolicies: { FULL_COMPENSATION: 100, HALF_COMPENSATION: 50 },
    reassignmentPayoutDefaultPolicy: 'FULL_COMPENSATION',
    offerExpiryEnabled: true,
    offerExpirySeconds: 60,
    noCourierRetrySeconds: 30,
    offerTimingEnabled: false,
    offerLeadMinutes: 3,
    offerTimingCandidates: 5,
    stackingEnabled: false,
    twoOrderPolicy: EnumTwoOrderPolicy.SHORTAGE_ONLY,
    twoOrderDelayLimitMinutes: 10,
    addOnOffersEnabled: false,
    addOnMoment: EnumAddOnMoment.BEFORE_PICKUP,
    savedCustomerRetentionMonths: 12,
    restaurantHistoryDays: 30,
    handBackSeconds: 60,
    sosLocationRetentionDays: 30,
    arrivalRadiusMetres: 50,
    shiftsEnabled: true,
    shiftDropNoticeHours: 12,
    dispatchPhoneNumber: '+302421012345',
    cancellationPayoutPolicy: 'FULL_COMPENSATION',
    waitPayEnabled: true,
    waitPayFreeMinutes: 5,
    waitPayCentsPerMinute: 10,
    waitLimitMinutes: 10,
    splitAnswerMinutes: 10,
    shiftBreakMinutes: 30,
    returnTripPayPercent: 100,
    chatQuickRepliesDispatch: [{ el: 'Προεπιλογή 1', en: 'Preset 1' }],
    chatQuickRepliesCourier: [{ el: 'Προεπιλογή 2', en: 'Preset 2' }],
    chatRetentionDays: 90,
    addressNoteRetentionDays: 182,
    reviewAnswerDays: 14,
    reviewCorrectionMaxCents: 5000,
    boxUnitsSmall: 30,
    boxUnitsMedium: 50,
    boxUnitsLarge: 100,
    boxDefaultSize: 'MEDIUM',
    fairnessWeightRoadTime: 50,
    fairnessWeightEarnings: 30,
    fairnessWeightWaiting: 20,
    fairnessWeightShift: 0,
    fairnessCandidateLimit: 10,
    fairnessMinOnlineMinutes: 30,
  }

  const defaultReasons = [
    { label: 'Moped breakdown', labelEl: 'Βλάβη μηχανακίου', paidToRider: true },
    { label: 'Customer absent', labelEl: 'Απών πελάτης', paidToRider: false },
  ]

  beforeEach(() => {
    mockConfigDomainService = {
      instanceConfig: {
        getInstanceConfigSettings: jest.fn().mockResolvedValue({ ...baseSettings }),
      },
    } as unknown as jest.Mocked<ConfigDomainService>

    mockRemovalRequestRepository = {
      findActiveReasons: jest.fn().mockResolvedValue([...defaultReasons]),
    } as unknown as jest.Mocked<RemovalRequestRepository>

    mockSettingChangeRepository = {
      findPage: jest.fn().mockResolvedValue({ data: [], pagination: {} }),
      findOldest: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<SettingChangeRepository>

    service = new WorkRulesService(mockConfigDomainService, mockRemovalRequestRepository, mockSettingChangeRepository)
  })

  // Helper to assert Greek characters exist and no English sentences leaked
  const GREEK_REGEX = /[\u0370-\u03FF]/
  const SECTIONS = ['offers', 'pay', 'personDecides', 'appRecords', 'timeWorked', 'earningsFigures'] as const

  function assertGreekParity(elResult: HowItWorks, enResult: HowItWorks) {
    for (const section of SECTIONS) {
      const elList = elResult[section]
      const enList = enResult[section]

      // Same number of sentences per section as English
      expect(elList.length).toBe(enList.length)

      for (const elSentence of elList) {
        // Every Greek sentence must contain Greek letters
        expect(GREEK_REGEX.test(elSentence)).toBe(true)
        // No English sentence left
        expect(enList).not.toContain(elSentence)
      }
    }
    expect(elResult.reviewAnswerDays).toBe(enResult.reviewAnswerDays)
  }

  describe('EL_WORDS dictionary units and helpers', () => {
    describe('money formatting', () => {
      it('formats EUR with comma and symbol after ("2,00 €")', () => {
        expect(EL_WORDS.money(200, 'EUR')).toBe('2,00 €')
        expect(EL_WORDS.money(150, 'EUR')).toBe('1,50 €')
        expect(EL_WORDS.money(10, 'EUR')).toBe('0,10 €')
        expect(EL_WORDS.money(0, 'EUR')).toBe('0,00 €')
      })

      it('formats non-EUR currency with comma and currency after ("2,00 USD")', () => {
        expect(EL_WORDS.money(200, 'USD')).toBe('2,00 USD')
        expect(EL_WORDS.money(150, 'GBP')).toBe('1,50 GBP')
      })

      it('formats null as "δεν έχει οριστεί" (not set), never a dash', () => {
        expect(EL_WORDS.money(null, 'EUR')).toBe('δεν έχει οριστεί')
        expect(EL_WORDS.money(null, 'USD')).toBe('δεν έχει οριστεί')
      })
    })

    describe('unit formatting', () => {
      it('translates MILES to "μίλια" and others to "km"', () => {
        expect(EL_WORDS.unit('MILES')).toBe('μίλια')
        expect(EL_WORDS.unit('KILOMETERS')).toBe('km')
      })
    })

    describe('policyName formatting', () => {
      it('translates known compensation policies into Greek, in the nominative', () => {
        expect(EL_WORDS.policyName('FULL_COMPENSATION', 'full compensation')).toBe('πλήρης αποζημίωση')
        expect(EL_WORDS.policyName('HALF_COMPENSATION', 'half compensation')).toBe('μισή αποζημίωση')
        expect(EL_WORDS.policyName('NO_COMPENSATION', 'no compensation')).toBe('καμία αποζημίωση')
      })

      it('keeps English name for an unknown policy', () => {
        expect(EL_WORDS.policyName('CUSTOM_POLICY', 'custom policy')).toBe('custom policy')
      })
    })

    describe('policyWithPercent formatting', () => {
      it('formats policy with percentage in Greek', () => {
        expect(EL_WORDS.policyWithPercent('πλήρης αποζημίωση', 100)).toBe('πλήρης αποζημίωση (100% της αμοιβής της)')
        expect(EL_WORDS.policyWithPercent('μισή αποζημίωση', 50)).toBe('μισή αποζημίωση (50% της αμοιβής της)')
      })
    })

    describe('reasonLabel formatting', () => {
      it('returns labelEl in Greek when labelEl is provided', () => {
        expect(EL_WORDS.reasonLabel({ label: 'Moped breakdown', labelEl: 'Βλάβη μηχανακίου' })).toBe(
          'Βλάβη μηχανακίου'
        )
      })

      it('falls back to label when labelEl is null', () => {
        expect(EL_WORDS.reasonLabel({ label: 'Customer absent', labelEl: null })).toBe('Customer absent')
      })

      it('falls back to label when labelEl is empty string', () => {
        expect(EL_WORDS.reasonLabel({ label: 'Severe weather', labelEl: '' })).toBe('Severe weather')
      })

      it('EN_WORDS always returns label regardless of labelEl', () => {
        expect(EN_WORDS.reasonLabel({ label: 'Moped breakdown', labelEl: 'Βλάβη μηχανακίου' })).toBe('Moped breakdown')
        expect(EN_WORDS.reasonLabel({ label: 'Customer absent', labelEl: null })).toBe('Customer absent')
      })
    })

    describe('matcher.STATIC', () => {
      it('returns Greek sentence for STATIC manual dispatch', () => {
        const sentence = EL_WORDS.matcher.STATIC!('20 km')
        expect(sentence).toBe('Ο συντονισμός διαλέγει με το χέρι τον διανομέα για κάθε παραγγελία.')
        expect(GREEK_REGEX.test(sentence)).toBe(true)
      })
    })

    describe('timeWorked and earningsFigures sentence counts', () => {
      it('returns 6 Greek sentences for timeWorked with break > 0', () => {
        const sentences = EL_WORDS.timeWorked(30)
        expect(sentences).toHaveLength(6)
        expect(sentences[1]).toContain('30 λεπτά')
        expect(sentences[1]).toContain('«Διάλειμμα»')
        for (const s of sentences) {
          expect(GREEK_REGEX.test(s)).toBe(true)
        }
      })

      it('returns 6 Greek sentences for timeWorked with break = 0', () => {
        const sentences = EL_WORDS.timeWorked(0)
        expect(sentences).toHaveLength(6)
        expect(sentences[1]).toBe('Κάθε μετάβαση εκτός σύνδεσης χωρίς δουλειά τερματίζει τη βάρδια.')
        for (const s of sentences) {
          expect(GREEK_REGEX.test(s)).toBe(true)
        }
      })

      it('returns 7 Greek sentences for earningsFigures naming reach months', () => {
        const sentences = EL_WORDS.earningsFigures()
        expect(sentences).toHaveLength(7)
        expect(sentences[5]).toContain(`${RIDER_REACH_MONTHS} μηνών`)
        for (const s of sentences) {
          expect(GREEK_REGEX.test(s)).toBe(true)
        }
      })

      it('names the Earnings figures and the time split with the app\'s own labels', () => {
        const figures = EL_WORDS.earningsFigures().join(' ')
        expect(figures).toContain('€ ανά ώρα σε παραγγελία')
        expect(figures).toContain('€ ανά αμειβόμενο km')

        const split = EL_WORDS.timeWorked(30).join(' ')
        expect(split).toContain('«Παραγγελίες»')
        expect(split).toContain('«Αμειβόμενη αναμονή»')
        expect(split).toContain('«Χωρίς αμοιβή»')
      })

      it('personDecides says "αποδέσμευση" and "παύση διανομών"', () => {
        const text = EL_WORDS.personDecides.join(' ')
        expect(text).toContain('αποδέσμευση')
        expect(text).toContain('παύση διανομών')
      })

      it('returns 2 Greek sentences for personDecides', () => {
        expect(EL_WORDS.personDecides).toHaveLength(2)
        for (const s of EL_WORDS.personDecides) {
          expect(GREEK_REGEX.test(s)).toBe(true)
        }
      })

      it('returns 3 Greek sentences for appRecords', () => {
        expect(EL_WORDS.appRecords).toHaveLength(3)
        for (const s of EL_WORDS.appRecords) {
          expect(GREEK_REGEX.test(s)).toBe(true)
        }
      })

      it('formats addressNotes with retention days and approximate months in Greek', () => {
        const note6Months = EL_WORDS.addressNotes(182)
        expect(note6Months).toContain('182 ημέρες (περίπου 6 μήνες)')
        expect(GREEK_REGEX.test(note6Months)).toBe(true)

        const note1Month = EL_WORDS.addressNotes(30)
        // Accusative after "για ... (περίπου ...)": "1 μήνα", not "1 μήνας".
        expect(note1Month).toContain('30 ημέρες (περίπου 1 μήνα)')
        expect(note1Month).not.toContain('μήνας')
      })
    })
  })

  describe('Clause 1: howItWorks() with no argument and howItWorks("en")', () => {
    it('returns exactly the English returned before, and defaults to English without argument', async () => {
      const defaultResult = await service.howItWorks()
      const enResult = await service.howItWorks('en')

      expect(defaultResult).toEqual(enResult)

      // Offers
      expect(defaultResult.offers[0]).toContain('nearest free riders')
      expect(defaultResult.offers[0]).toContain('20 km')
      expect(defaultResult.offers).toContain('A rider already on a job gets no second offer.')
      expect(defaultResult.offers).toContain(
        'You have 60 seconds to answer an offer; then it goes to the next rider.'
      )

      // Pay
      expect(defaultResult.pay[0]).toContain('base of €2.00 plus €1.50 per km')
      expect(
        defaultResult.pay.some((line) => line.includes('first 5 minutes are not paid, then each minute pays €0.10'))
      ).toBe(true)
      expect(defaultResult.pay.some((line) => line.includes('Being taken off an order pays you for these reasons: Moped breakdown'))).toBe(true)
      expect(defaultResult.pay.some((line) => line.includes('These reasons do not pay: Customer absent'))).toBe(true)

      // Fixed sections
      expect(defaultResult.personDecides).toEqual(EN_WORDS.personDecides)
      expect(defaultResult.earningsFigures).toEqual(EN_WORDS.earningsFigures())
      expect(defaultResult.reviewAnswerDays).toBe(14)
    })
  })

  describe('Clause 2: howItWorks("el") section parity across all configurations', () => {
    describe('Matchers', () => {
      it('FAIRNESS matcher with shifts enabled', async () => {
        ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
          ...baseSettings,
          courierMatcherType: EnumCourierMatcherType.FAIRNESS,
          shiftsEnabled: true,
          fairnessWeightShift: 10,
        })

        const en = await service.howItWorks('en')
        const el = await service.howItWorks('el')

        assertGreekParity(el, en)
        expect(el.offers[3]).toContain('Όσο οι βάρδιες είναι ενεργές')
        expect(el.offers[3]).toContain('βάρος 10')
      })

      it('FAIRNESS matcher without shifts', async () => {
        ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
          ...baseSettings,
          courierMatcherType: EnumCourierMatcherType.FAIRNESS,
          shiftsEnabled: false,
        })

        const en = await service.howItWorks('en')
        const el = await service.howItWorks('el')

        assertGreekParity(el, en)
        expect(el.offers.join(' ')).not.toContain('Όσο οι βάρδιες είναι ενεργές')
      })

      it('NEAREST_COURIER matcher', async () => {
        ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
          ...baseSettings,
          courierMatcherType: EnumCourierMatcherType.NEAREST_COURIER,
        })

        const en = await service.howItWorks('en')
        const el = await service.howItWorks('el')

        assertGreekParity(el, en)
        expect(el.offers[0]).toContain('στον πιο κοντινό ελεύθερο διανομέα')
        expect(el.offers[0]).toContain('20 km')
        expect(el.offers[1]).toBe(EL_WORDS.seeWhy)
      })

      it('COURIER_SENIORITY matcher', async () => {
        ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
          ...baseSettings,
          courierMatcherType: EnumCourierMatcherType.COURIER_SENIORITY,
        })

        const en = await service.howItWorks('en')
        const el = await service.howItWorks('el')

        assertGreekParity(el, en)
        expect(el.offers[0]).toContain('με τον παλαιότερο λογαριασμό')
        expect(el.offers[1]).toBe(EL_WORDS.seeWhy)
      })

      it('STATIC matcher', async () => {
        ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
          ...baseSettings,
          courierMatcherType: EnumCourierMatcherType.STATIC,
        })

        const en = await service.howItWorks('en')
        const el = await service.howItWorks('el')

        assertGreekParity(el, en)
        expect(el.offers[0]).toBe('Ο συντονισμός διαλέγει με το χέρι τον διανομέα για κάθε παραγγελία.')
        expect(el.offers[1]).toBe(EL_WORDS.seeWhy)
      })

      it('unknown matcher falling back to nearest sentence', async () => {
        ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
          ...baseSettings,
          courierMatcherType: 'UNKNOWN_MATCHER' as any,
        })

        const en = await service.howItWorks('en')
        const el = await service.howItWorks('el')

        assertGreekParity(el, en)
        expect(el.offers[0]).toContain('στον πιο κοντινό ελεύθερο διανομέα')
      })
    })

    describe('Offer expiry on and off', () => {
      it('offerExpiryEnabled: true includes countdown seconds', async () => {
        ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
          ...baseSettings,
          offerExpiryEnabled: true,
          offerExpirySeconds: 45,
        })

        const en = await service.howItWorks('en')
        const el = await service.howItWorks('el')

        assertGreekParity(el, en)
        expect(el.offers).toContain('Έχετε 45 δευτερόλεπτα για να απαντήσετε σε μια πρόταση· μετά πηγαίνει στον επόμενο διανομέα.')
      })

      it('offerExpiryEnabled: false includes offer waits sentence', async () => {
        ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
          ...baseSettings,
          offerExpiryEnabled: false,
        })

        const en = await service.howItWorks('en')
        const el = await service.howItWorks('el')

        assertGreekParity(el, en)
        expect(el.offers).toContain('Μια πρόταση περιμένει την απάντησή σας μέχρι να την αποδεχτείτε ή να την απορρίψετε.')
      })
    })

    describe('Offer timing on and off', () => {
      it('offerTimingEnabled: true includes lead minutes sentence', async () => {
        ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
          ...baseSettings,
          offerTimingEnabled: true,
          offerLeadMinutes: 5,
        })

        const en = await service.howItWorks('en')
        const el = await service.howItWorks('el')

        assertGreekParity(el, en)
        expect(el.offers.some((line) => line.includes('περίπου 5 λεπτά πριν το κατάστημα'))).toBe(true)
      })

      it('offerTimingEnabled: false omits lead minutes sentence', async () => {
        ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
          ...baseSettings,
          offerTimingEnabled: false,
        })

        const en = await service.howItWorks('en')
        const el = await service.howItWorks('el')

        assertGreekParity(el, en)
        expect(el.offers.some((line) => line.includes('πριν το κατάστημα πει'))).toBe(false)
      })
    })

    describe('Stacking on and off', () => {
      it('stackingEnabled: true with SHORTAGE_ONLY', async () => {
        ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
          ...baseSettings,
          stackingEnabled: true,
          twoOrderPolicy: EnumTwoOrderPolicy.SHORTAGE_ONLY,
          twoOrderDelayLimitMinutes: 10,
        })

        const en = await service.howItWorks('en')
        const el = await service.howItWorks('el')

        assertGreekParity(el, en)
        expect(el.offers.some((line) => line.includes('μόνο όταν μία από τις δύο δεν βρήκε ελεύθερο διανομέα'))).toBe(true)
      })

      it('stackingEnabled: true with WHENEVER_FITS', async () => {
        ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
          ...baseSettings,
          stackingEnabled: true,
          twoOrderPolicy: EnumTwoOrderPolicy.WHENEVER_FITS,
          twoOrderDelayLimitMinutes: 15,
        })

        const en = await service.howItWorks('en')
        const el = await service.howItWorks('el')

        assertGreekParity(el, en)
        expect(el.offers.some((line) => line.includes('όποτε χωράνε και οι δύο'))).toBe(true)
      })

      it('stackingEnabled: false omits stacking sentence', async () => {
        ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
          ...baseSettings,
          stackingEnabled: false,
        })

        const en = await service.howItWorks('en')
        const el = await service.howItWorks('el')

        assertGreekParity(el, en)
        expect(el.offers.some((line) => line.includes('δύο παραγγελίες μαζί'))).toBe(false)
      })
    })

    describe('Add-on offers on and off', () => {
      it('addOnOffersEnabled: true with BEFORE_DROPOFF', async () => {
        ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
          ...baseSettings,
          addOnOffersEnabled: true,
          addOnMoment: EnumAddOnMoment.BEFORE_DROPOFF,
          twoOrderPolicy: EnumTwoOrderPolicy.SHORTAGE_ONLY,
        })

        const en = await service.howItWorks('en')
        const el = await service.howItWorks('el')

        assertGreekParity(el, en)
        expect(el.offers.some((line) => line.includes('οποιαδήποτε στιγμή πριν παραδώσετε'))).toBe(true)
      })

      it('addOnOffersEnabled: true with SAME_RESTAURANT', async () => {
        ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
          ...baseSettings,
          addOnOffersEnabled: true,
          addOnMoment: EnumAddOnMoment.SAME_RESTAURANT,
          twoOrderPolicy: EnumTwoOrderPolicy.WHENEVER_FITS,
        })

        const en = await service.howItWorks('en')
        const el = await service.howItWorks('el')

        assertGreekParity(el, en)
        expect(el.offers.some((line) => line.includes('πριν παραλάβετε την τρέχουσα παραγγελία σας, και μόνο από το ίδιο κατάστημα'))).toBe(true)
        expect(el.offers.some((line) => line.includes('όποτε χωράει, ακόμη κι όταν υπάρχει ελεύθερος διανομέας'))).toBe(true)
      })

      it('addOnOffersEnabled: true with BEFORE_PICKUP', async () => {
        ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
          ...baseSettings,
          addOnOffersEnabled: true,
          addOnMoment: EnumAddOnMoment.BEFORE_PICKUP,
          twoOrderPolicy: EnumTwoOrderPolicy.SHORTAGE_ONLY,
        })

        const en = await service.howItWorks('en')
        const el = await service.howItWorks('el')

        assertGreekParity(el, en)
        expect(el.offers.some((line) => line.includes('στον δρόμο, πριν παραλάβετε την τρέχουσα παραγγελία σας.'))).toBe(true)
        expect(el.offers.some((line) => line.includes('και μόνο από το ίδιο κατάστημα'))).toBe(false)
        expect(el.offers.some((line) => line.includes('πριν παραδώσετε'))).toBe(false)
      })

      it('addOnOffersEnabled: true is NOT said under STATIC matcher', async () => {
        ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
          ...baseSettings,
          courierMatcherType: EnumCourierMatcherType.STATIC,
          addOnOffersEnabled: true,
          addOnMoment: EnumAddOnMoment.BEFORE_PICKUP,
        })

        const en = await service.howItWorks('en')
        const el = await service.howItWorks('el')

        assertGreekParity(el, en)
        // STATIC suppresses add-ons
        expect(el.offers.some((line) => line.includes('μία ακόμη παραγγελία στον δρόμο'))).toBe(false)
        expect(en.offers.some((line) => line.includes('one more order on the way'))).toBe(false)
      })

      it('addOnOffersEnabled: false omits add-on sentence', async () => {
        ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
          ...baseSettings,
          addOnOffersEnabled: false,
        })

        const en = await service.howItWorks('en')
        const el = await service.howItWorks('el')

        assertGreekParity(el, en)
        expect(el.offers.some((line) => line.includes('μία ακόμη παραγγελία στον δρόμο'))).toBe(false)
      })
    })

    describe('Wait pay on and off', () => {
      it('waitPayEnabled: true and waitPayCentsPerMinute > 0', async () => {
        ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
          ...baseSettings,
          waitPayEnabled: true,
          waitPayFreeMinutes: 6,
          waitPayCentsPerMinute: 12,
        })

        const en = await service.howItWorks('en')
        const el = await service.howItWorks('el')

        assertGreekParity(el, en)
        expect(el.pay.some((line) => line.includes('τα πρώτα 6 λεπτά δεν πληρώνονται και μετά κάθε λεπτό πληρώνει 0,12 €'))).toBe(true)
      })

      it('waitPayEnabled: false shows waitNotPaid in Greek', async () => {
        ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
          ...baseSettings,
          waitPayEnabled: false,
        })

        const en = await service.howItWorks('en')
        const el = await service.howItWorks('el')

        assertGreekParity(el, en)
        expect(el.pay).toContain('Η αναμονή σε κατάστημα δεν πληρώνεται αυτή τη στιγμή.')
      })

      it('waitPayEnabled: true with waitPayCentsPerMinute = 0 shows waitNotPaid in Greek', async () => {
        ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
          ...baseSettings,
          waitPayEnabled: true,
          waitPayCentsPerMinute: 0,
        })

        const en = await service.howItWorks('en')
        const el = await service.howItWorks('el')

        assertGreekParity(el, en)
        expect(el.pay).toContain('Η αναμονή σε κατάστημα δεν πληρώνεται αυτή τη στιγμή.')
      })
    })

    describe('Hand back on and off', () => {
      it('handBackSeconds > 0 shows handBack in Greek', async () => {
        ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
          ...baseSettings,
          handBackSeconds: 90,
        })

        const en = await service.howItWorks('en')
        const el = await service.howItWorks('el')

        assertGreekParity(el, en)
        expect(el.pay).toContain('Μπορείτε να επιστρέψετε χωρίς κόστος μια παραγγελία που αποδεχτήκατε, μέσα σε 90 δευτερόλεπτα.')
      })

      it('handBackSeconds = 0 shows handBackOff in Greek', async () => {
        ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
          ...baseSettings,
          handBackSeconds: 0,
        })

        const en = await service.howItWorks('en')
        const el = await service.howItWorks('el')

        assertGreekParity(el, en)
        expect(el.pay).toContain('Η επιστροφή μιας παραγγελίας που αποδεχτήκατε χωρίς κόστος είναι απενεργοποιημένη.')
      })
    })

    describe('Paid and unpaid removal reasons presence and absence', () => {
      it('both paid and unpaid reasons present', async () => {
        mockRemovalRequestRepository.findActiveReasons.mockResolvedValue([
          { label: 'Moped breakdown', labelEl: 'Βλάβη μηχανής', paidToRider: true },
          { label: 'Customer absent', labelEl: 'Απών πελάτης', paidToRider: false },
        ] as any)

        const en = await service.howItWorks('en')
        const el = await service.howItWorks('el')

        assertGreekParity(el, en)
        expect(el.pay.some((line) => line.includes('Η αποδέσμευση από μια παραγγελία πληρώνεται για αυτούς τους λόγους: Βλάβη μηχανής.'))).toBe(true)
        expect(el.pay.some((line) => line.includes('Αυτοί οι λόγοι δεν πληρώνονται: Απών πελάτης.'))).toBe(true)
      })

      it('paid present, unpaid absent', async () => {
        mockRemovalRequestRepository.findActiveReasons.mockResolvedValue([
          { label: 'Moped breakdown', labelEl: 'Βλάβη μηχανής', paidToRider: true },
        ] as any)

        const en = await service.howItWorks('en')
        const el = await service.howItWorks('el')

        assertGreekParity(el, en)
        expect(el.pay.some((line) => line.includes('Η αποδέσμευση από μια παραγγελία πληρώνεται'))).toBe(true)
        expect(el.pay.some((line) => line.includes('Αυτοί οι λόγοι δεν πληρώνονται'))).toBe(false)
      })

      it('unpaid present, paid absent', async () => {
        mockRemovalRequestRepository.findActiveReasons.mockResolvedValue([
          { label: 'Customer absent', labelEl: 'Απών πελάτης', paidToRider: false },
        ] as any)

        const en = await service.howItWorks('en')
        const el = await service.howItWorks('el')

        assertGreekParity(el, en)
        expect(el.pay.some((line) => line.includes('Η αφαίρεση από μια παραγγελία σας πληρώνεται'))).toBe(false)
        expect(el.pay.some((line) => line.includes('Αυτοί οι λόγοι δεν πληρώνονται'))).toBe(true)
      })

      it('both paid and unpaid reasons absent', async () => {
        mockRemovalRequestRepository.findActiveReasons.mockResolvedValue([])

        const en = await service.howItWorks('en')
        const el = await service.howItWorks('el')

        assertGreekParity(el, en)
        expect(el.pay.some((line) => line.includes('Η αφαίρεση από μια παραγγελία σας πληρώνεται'))).toBe(false)
        expect(el.pay.some((line) => line.includes('Αυτοί οι λόγοι δεν πληρώνονται'))).toBe(false)
      })
    })
  })

  describe('Clause 3: Live setting values appearing in Greek sentences', () => {
    it('reflects distance with units (km and miles -> μίλια)', async () => {
      // 1. km
      ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
        ...baseSettings,
        maxAssignmentDistance: 15,
        distanceUnit: EnumDistanceUnit.KILOMETERS,
      })

      let el = await service.howItWorks('el')
      expect(el.offers[0]).toContain('15 km')

      // 2. miles -> μίλια
      ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
        ...baseSettings,
        maxAssignmentDistance: 12,
        distanceUnit: EnumDistanceUnit.MILES,
      })

      el = await service.howItWorks('el')
      expect(el.offers[0]).toContain('12 μίλια')
      // After "ανά" the unit is singular: "ανά μίλι", while the distance itself stays "12 μίλια".
      expect(el.pay[0]).toContain('ανά μίλι της διαδρομής')
      expect(el.pay[0]).not.toContain('ανά μίλια')
    })

    it('reflects fairness weights, limits, and minutes in Greek sentences', async () => {
      ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
        ...baseSettings,
        courierMatcherType: EnumCourierMatcherType.FAIRNESS,
        fairnessCandidateLimit: 8,
        fairnessWeightRoadTime: 40,
        fairnessWeightEarnings: 25,
        fairnessWeightWaiting: 15,
        fairnessMinOnlineMinutes: 20,
        shiftsEnabled: true,
        fairnessWeightShift: 18,
      })

      const el = await service.howItWorks('el')
      expect(el.offers[0]).toContain('στους 8 πιο κοντινούς ελεύθερους διανομείς')
      expect(el.offers[1]).toContain('βάρος 40')
      expect(el.offers[1]).toContain('βάρος 25')
      expect(el.offers[1]).toContain('βάρος 15')
      expect(el.offers[2]).toContain('συμπληρώσετε 20 λεπτά')
      expect(el.offers[3]).toContain('βάρος 18')
    })

    it('reflects Greek money ("2,50 €", non-EUR "2,50 USD") and pay values', async () => {
      // EUR
      ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
        ...baseSettings,
        currency: EnumCurrency.EUR,
        quoteBaseFee: 250,
        quoteRatePerDistanceUnit: 180,
        waitPayFreeMinutes: 7,
        waitPayCentsPerMinute: 15,
        waitLimitMinutes: 12,
        splitAnswerMinutes: 14,
        returnTripPayPercent: 75,
        reviewCorrectionMaxCents: 6000,
      })

      let el = await service.howItWorks('el')
      expect(el.pay[0]).toContain('βασική αμοιβή 2,50 € συν 1,80 € ανά km')
      expect(el.pay[1]).toContain('πρώτα 7 λεπτά δεν πληρώνονται και μετά κάθε λεπτό πληρώνει 0,15 €')
      expect(el.pay[2]).toContain('καθυστέρηση 12 λεπτών')
      expect(el.pay[3]).toContain('14 λεπτά χωρίς απάντηση')
      expect(el.pay[6]).toContain('75% της αμοιβής απόστασης')
      expect(el.pay.find((line) => line.includes('επανεξέταση'))).toContain('έως 60,00 €')

      // USD
      ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
        ...baseSettings,
        currency: EnumCurrency.USD,
        quoteBaseFee: 250,
        quoteRatePerDistanceUnit: 180,
      })

      el = await service.howItWorks('el')
      expect(el.pay[0]).toContain('βασική αμοιβή 2,50 USD συν 1,80 USD ανά km')
    })

    it('translates cancellation and reassignment policies in Greek (FULL, HALF, NO, unknown keeps English)', async () => {
      // 1. FULL_COMPENSATION
      ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
        ...baseSettings,
        cancellationPayoutPolicy: 'FULL_COMPENSATION',
        reassignmentPayoutDefaultPolicy: 'FULL_COMPENSATION',
        reassignmentPayoutPolicies: { FULL_COMPENSATION: 100 },
      })

      let el = await service.howItWorks('el')
      expect(el.pay[4]).toBe('Αν ακυρωθεί μια δουλειά που αποδεχτήκατε, η πληρωμή σας είναι: πλήρης αποζημίωση (100% της αμοιβής της).')
      expect(el.pay[5]).toBe('Αν αποδεσμευτείτε από μια δουλειά, η πληρωμή σας συνήθως είναι: πλήρης αποζημίωση (100% της αμοιβής της).')

      // 2. HALF_COMPENSATION
      ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
        ...baseSettings,
        cancellationPayoutPolicy: 'HALF_COMPENSATION',
        reassignmentPayoutDefaultPolicy: 'HALF_COMPENSATION',
        reassignmentPayoutPolicies: { HALF_COMPENSATION: 50 },
      })

      el = await service.howItWorks('el')
      expect(el.pay[4]).toBe('Αν ακυρωθεί μια δουλειά που αποδεχτήκατε, η πληρωμή σας είναι: μισή αποζημίωση (50% της αμοιβής της).')

      // 3. NO_COMPENSATION without percentage entry
      ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
        ...baseSettings,
        cancellationPayoutPolicy: 'NO_COMPENSATION',
        reassignmentPayoutDefaultPolicy: 'NO_COMPENSATION',
        reassignmentPayoutPolicies: {},
      })

      el = await service.howItWorks('el')
      expect(el.pay[4]).toBe('Αν ακυρωθεί μια δουλειά που αποδεχτήκατε, η πληρωμή σας είναι: καμία αποζημίωση.')

      // 4. Unknown policy keeps English name
      ;(mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
        ...baseSettings,
        cancellationPayoutPolicy: 'CUSTOM_COMPENSATION',
        reassignmentPayoutDefaultPolicy: 'CUSTOM_COMPENSATION',
        reassignmentPayoutPolicies: {},
      })

      el = await service.howItWorks('el')
      expect(el.pay[4]).toBe('Αν ακυρωθεί μια δουλειά που αποδεχτήκατε, η πληρωμή σας είναι: custom compensation.')
    })
  })

  describe('Clause 4: Removal reason labels in Greek vs English', () => {
    it('shows labelEl in Greek, label when labelEl is null or empty, and always label in English', async () => {
      mockRemovalRequestRepository.findActiveReasons.mockResolvedValue([
        { label: 'Moped breakdown', labelEl: 'Βλάβη μηχανής', paidToRider: true },
        { label: 'Severe storm', labelEl: '', paidToRider: true },
        { label: 'Customer absent', labelEl: null, paidToRider: false },
      ] as any)

      const el = await service.howItWorks('el')
      const en = await service.howItWorks('en')

      // In Greek:
      // - 'Moped breakdown' has labelEl -> 'Βλάβη μηχανής'
      // - 'Severe storm' has empty labelEl -> 'Severe storm'
      // - 'Customer absent' has null labelEl -> 'Customer absent'
      const elPaidLine = el.pay.find((line) => line.includes('Η αποδέσμευση από μια παραγγελία πληρώνεται'))
      expect(elPaidLine).toContain('Βλάβη μηχανής, Severe storm')

      const elUnpaidLine = el.pay.find((line) => line.includes('Αυτοί οι λόγοι δεν πληρώνονται'))
      expect(elUnpaidLine).toContain('Customer absent')

      // In English:
      // Always uses label regardless of labelEl
      const enPaidLine = en.pay.find((line) => line.includes('Being taken off an order pays you'))
      expect(enPaidLine).toContain('Moped breakdown, Severe storm')

      const enUnpaidLine = en.pay.find((line) => line.includes('These reasons do not pay'))
      expect(enUnpaidLine).toContain('Customer absent')
    })
  })

  // Row 137 review fixes: the rider's "What changed" list in the rider's language.
  describe('riderChanges in Greek (row 137 review, requirement 1)', () => {
    const LATIN_WORD = /[A-Za-z]{2,}/
    let nextId = 0
    const change = (key: string, oldValue: unknown, newValue: unknown) =>
      ({
        id: `change-${nextId++}`,
        key,
        subject: null,
        oldValue,
        newValue,
        createdAt: new Date('2026-11-23T08:00:00Z'),
        changedBy: { id: 'admin-1', email: 'admin@coop.gr', username: 'admin' },
      } as any)

    const pageOf = (...rows: unknown[]) =>
      mockSettingChangeRepository.findPage.mockResolvedValue({ data: rows, pagination: { totalPages: 1 } } as any)

    const useSettings = (overrides: Partial<InstanceConfigSettings>) =>
      (mockConfigDomainService.instanceConfig.getInstanceConfigSettings as jest.Mock).mockResolvedValue({
        ...baseSettings,
        ...overrides,
      })

    it('words labels, on/off, units and money in Greek', async () => {
      pageOf(
        change('waitPayEnabled', false, true),
        change('shiftsEnabled', true, false),
        change('waitPayFreeMinutes', 5, 10),
        change('offerExpirySeconds', 60, 45),
        change('shiftDropNoticeHours', 12, 24),
        change('reviewAnswerDays', 14, 7),
        change('quoteBaseFee', 200, 250),
        change('quoteBaseFee', null, 250),
        change('maxAssignmentDistance', 20, 15),
        change('quoteRatePerDistanceUnit', 150, 180)
      )

      const result = await service.riderChanges({ page: 1, perPage: 20 }, 'el')
      const lines = result.data

      expect(lines).toHaveLength(10)
      // Every label is the Greek entry's label, holds Greek letters and is not the English label.
      const keys = [
        'waitPayEnabled',
        'shiftsEnabled',
        'waitPayFreeMinutes',
        'offerExpirySeconds',
        'shiftDropNoticeHours',
        'reviewAnswerDays',
        'quoteBaseFee',
        'quoteBaseFee',
        'maxAssignmentDistance',
        'quoteRatePerDistanceUnit',
      ]
      lines.forEach((line, index) => {
        const key = keys[index] as string
        expect(line.label).toBe(RIDER_FACING_SETTINGS_EL[key]?.label)
        expect(line.label).not.toBe(RIDER_FACING_SETTINGS[key]?.label)
        expect(GREEK_REGEX.test(line.label)).toBe(true)
        expect(LATIN_WORD.test(line.label)).toBe(false)
      })

      // On / off
      expect([lines[0]?.oldText, lines[0]?.newText]).toEqual(['ανενεργό', 'ενεργό'])
      expect([lines[1]?.oldText, lines[1]?.newText]).toEqual(['ενεργό', 'ανενεργό'])
      // Units
      expect([lines[2]?.oldText, lines[2]?.newText]).toEqual(['5 λεπτά', '10 λεπτά'])
      expect([lines[3]?.oldText, lines[3]?.newText]).toEqual(['60 δευτερόλεπτα', '45 δευτερόλεπτα'])
      expect([lines[4]?.oldText, lines[4]?.newText]).toEqual(['12 ώρες', '24 ώρες'])
      expect([lines[5]?.oldText, lines[5]?.newText]).toEqual(['14 ημέρες', '7 ημέρες'])
      // Money: decimal comma, the symbol after; a missing value reads "not set" in Greek.
      expect([lines[6]?.oldText, lines[6]?.newText]).toEqual(['2,00 €', '2,50 €'])
      expect([lines[7]?.oldText, lines[7]?.newText]).toEqual(['δεν έχει οριστεί', '2,50 €'])
      // Distance, in the instance's unit (km here).
      expect([lines[8]?.oldText, lines[8]?.newText]).toEqual(['20 km', '15 km'])
      expect([lines[9]?.oldText, lines[9]?.newText]).toEqual(['1,50 € ανά km', '1,80 € ανά km'])

      // No English word from the English list leaks into a Greek line.
      for (const line of lines) {
        for (const text of [line.oldText, line.newText]) {
          expect(text).not.toMatch(/\b(on|off|minutes|seconds|hours|days|not set|per)\b/)
        }
      }
      // Still no person on a rider's line.
      expect((lines[0] as any).changedBy).toBeUndefined()
    })

    it('uses Greek distance words on a MILES instance and another currency after the amount', async () => {
      useSettings({ distanceUnit: EnumDistanceUnit.MILES, currency: EnumCurrency.USD })
      pageOf(change('maxAssignmentDistance', 20, 12), change('quoteRatePerDistanceUnit', 150, 180))

      const result = await service.riderChanges({}, 'el')

      expect([result.data[0]?.oldText, result.data[0]?.newText]).toEqual(['20 μίλια', '12 μίλια'])
      expect([result.data[1]?.oldText, result.data[1]?.newText]).toEqual(['1,50 USD ανά μίλι', '1,80 USD ανά μίλι'])
    })

    it('names every weekday of a shift slot in Greek', async () => {
      const greekDays = ['Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο', 'Κυριακή']
      const englishDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
      // Weekday 1 is Monday, as in the English list.
      pageOf(
        ...greekDays.map((_, index) =>
          change('shiftSlot', null, { weekday: index + 1, startMinute: 600, endMinute: 870, riderCap: 4 })
        )
      )

      const el = await service.riderChanges({}, 'el')
      const en = await service.riderChanges({}, 'en')

      expect(el.data).toHaveLength(7)
      el.data.forEach((line, index) => {
        expect(line.label).toBe(RIDER_FACING_SETTINGS_EL['shiftSlot']?.label)
        expect(line.newText.startsWith(`${greekDays[index]} `)).toBe(true)
        expect(line.newText).toContain('10:00')
        expect(line.newText).toContain('14:30')
        expect(line.newText).toContain('4')
        expect(LATIN_WORD.test(line.newText)).toBe(false)
        expect(LATIN_WORD.test(line.oldText)).toBe(false)
        expect(GREEK_REGEX.test(line.oldText)).toBe(true)
      })
      // The same rows in English are unchanged.
      en.data.forEach((line, index) => {
        expect(line.newText).toBe(`${englishDays[index]} 10:00 to 14:30, up to 4 riders`)
        expect(line.oldText).toBe('none')
      })
    })

    it('words a removal reason by labelEl, by label when labelEl is missing or empty, with its pay in Greek', async () => {
      pageOf(
        change('removalReason', null, { label: 'Moped breakdown', labelEl: 'Βλάβη μηχανής', paidToRider: true }),
        change('removalReason', null, { label: 'Customer absent', labelEl: null, paidToRider: false }),
        change('removalReason', null, { label: 'Severe storm', labelEl: '', paidToRider: true }),
        change('removalReason', null, { label: 'Wrong address', paidToRider: false }),
        // The pay flips and nothing else: both sides must still read in Greek.
        change(
          'removalReason',
          { label: 'Flat tyre', labelEl: 'Σκασμένο λάστιχο', paidToRider: false },
          { label: 'Flat tyre', labelEl: 'Σκασμένο λάστιχο', paidToRider: true }
        )
      )

      const result = await service.riderChanges({}, 'el')

      expect(result.data.map((line) => line.newText)).toEqual([
        'Βλάβη μηχανής, πληρώνει τον διανομέα',
        'Customer absent, δεν πληρώνει',
        'Severe storm, πληρώνει τον διανομέα',
        'Wrong address, δεν πληρώνει',
        'Σκασμένο λάστιχο, πληρώνει τον διανομέα',
      ])
      expect(result.data[4]?.oldText).toBe('Σκασμένο λάστιχο, δεν πληρώνει')
      for (const line of result.data) {
        expect(line.label).toBe(RIDER_FACING_SETTINGS_EL['removalReason']?.label)
        expect(line.newText).not.toContain('pays the rider')
        expect(line.newText).not.toContain('does not pay')
      }
      // A reason that did not exist before reads as Greek, not "none".
      expect(result.data[0]?.oldText).not.toBe('none')
      expect(GREEK_REGEX.test(result.data[0]?.oldText ?? '')).toBe(true)
    })

    it('still asks the repository for the rider facing keys and the same page in Greek', async () => {
      pageOf(change('waitPayFreeMinutes', 5, 10))

      const result = await service.riderChanges({ page: 3, perPage: 7 }, 'el')

      expect(mockSettingChangeRepository.findPage).toHaveBeenCalledWith({
        keys: RIDER_FACING_SETTING_KEYS,
        page: 3,
        perPage: 7,
      })
      expect(result.pagination).toEqual({ totalPages: 1 })
    })

    it('riderChanges(options) and riderChanges(options, "en") stay exactly English', async () => {
      pageOf(
        change('waitPayEnabled', false, true),
        change('waitPayFreeMinutes', 5, 10),
        change('quoteBaseFee', null, 250),
        change('maxAssignmentDistance', 20, 15),
        change('quoteRatePerDistanceUnit', 150, 180),
        change('cancellationPayoutPolicy', 'FULL_COMPENSATION', 'HALF_COMPENSATION'),
        change('shiftSlot', null, { weekday: 3, startMinute: 600, endMinute: 840, riderCap: 4 }),
        // A Greek label on the reason must not reach the English list.
        change('removalReason', null, { label: 'Moped breakdown', labelEl: 'Βλάβη μηχανής', paidToRider: true })
      )

      const byDefault = await service.riderChanges({ page: 1, perPage: 20 })
      const english = await service.riderChanges({ page: 1, perPage: 20 }, 'en')

      expect(byDefault).toEqual(english)
      expect(english.data.map(({ label, oldText, newText }) => ({ label, oldText, newText }))).toEqual([
        { label: 'Pay for waiting at a restaurant', oldText: 'off', newText: 'on' },
        { label: 'Unpaid minutes of waiting', oldText: '5 minutes', newText: '10 minutes' },
        { label: 'Base pay per delivery', oldText: 'not set', newText: '€2.50' },
        { label: 'Farthest distance to the restaurant for an offer', oldText: '20 km', newText: '15 km' },
        { label: 'Pay per distance', oldText: '€1.50 per km', newText: '€1.80 per km' },
        {
          label: 'Pay when a job you accepted is cancelled',
          oldText: 'full compensation',
          newText: 'half compensation',
        },
        { label: 'Shift', oldText: 'none', newText: 'Wednesday 10:00 to 14:00, up to 4 riders' },
        { label: 'Reason to be taken off an order', oldText: 'none', newText: 'Moped breakdown, pays the rider' },
      ])
      for (const line of english.data) {
        expect(GREEK_REGEX.test(`${line.label}${line.oldText}${line.newText}`)).toBe(false)
      }
    })
  })
})
