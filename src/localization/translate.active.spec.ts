// Spec 0054 (row 47), AC-3: language format helpers and server translator.
// Tests the server's formatting rules:
// - money: integer cents with currency code ("3,50 €" in Greek, "€3.50" in English)
// - decimal: language's decimal mark ("1,2" in Greek, "1.2" in English)
// - clock: ISO timestamp formatted in Europe/Athens (HH:mm)
// - list: joined with language's conjunction ("και" in Greek, "and" in English)
// - day/when: relative time formatting on Athens time
// - $t(...): nested key lookup
// - languageOf: safe fallback to 'el'
import { isLanguage, languageOf, renderEventMessage, translate } from './translate'

describe('translate and formatting helpers (Spec 0054, AC-3)', () => {
  describe('languageOf and isLanguage', () => {
    test('languageOf returns valid languages directly', () => {
      expect(languageOf('el')).toBe('el')
      expect(languageOf('en')).toBe('en')
    })

    test('languageOf falls back to el for null, undefined, or unsupported strings', () => {
      expect(languageOf(null)).toBe('el')
      expect(languageOf(undefined)).toBe('el')
      expect(languageOf('fr')).toBe('el')
      expect(languageOf('')).toBe('el')
    })

    test('isLanguage recognizes valid Language values', () => {
      expect(isLanguage('el')).toBe(true)
      expect(isLanguage('en')).toBe(true)
      expect(isLanguage('de')).toBe(false)
      expect(isLanguage(null)).toBe(false)
    })
  })

  describe('formatters', () => {
    test('money format: integer cents formatted as language-appropriate currency string', () => {
      // 350 cents = 3.50 EUR, formatted via COURIER_PAID_FOR_RETURN_TRIP
      const greekMoney = translate('el', 'server.event.COURIER_PAID_FOR_RETURN_TRIP', {
        courierId: 'c-1',
        amount: 350,
        currency: 'EUR',
      })
      expect(greekMoney).toContain('3,50\u00A0€')
    })

    test('decimal format: numbers formatted with language decimal mark', () => {
      const greekDecimal = translate('el', 'server.eventPart.ADD_ON_FIGURES', {
        extraKm: 1.5,
        extraMinutes: 4,
      })
      expect(greekDecimal).toContain('1,5 χλμ.')

      const englishDecimal = translate('en', 'server.eventPart.ADD_ON_FIGURES', {
        extraKm: 1.5,
        extraMinutes: 4,
      })
      expect(englishDecimal).toContain('1.5 km')
    })

    test('clock format: formats UTC ISO string as HH:mm in Europe/Athens timezone', () => {
      // 08:15 UTC = 10:15 in Europe/Athens (+2 in winter)
      const greekClock = translate('el', 'server.event.FOOD_READY', { at: '2026-11-20T08:15:00.000Z' })
      expect(greekClock).toBe('Το φαγητό ήταν έτοιμο στις 10:15')

      const englishClock = translate('en', 'server.event.FOOD_READY', { at: '2026-11-20T08:15:00.000Z' })
      expect(englishClock).toBe('Food ready at 10:15')
    })

    test('list format: joins parts with language-specific conjunction', () => {
      const parts = [
        { part: 'BOX' as const, params: { size: 'SMALL' } },
        { part: 'BOX' as const, params: { size: 'MEDIUM' } },
        { part: 'BOX' as const, params: { size: 'LARGE' } },
      ]

      const greekList = translate('el', 'server.event.SPLIT_REQUESTED', {
        count: 3,
        sizes: parts,
        splitId: 'split-1',
      })
      expect(greekList).toContain('Μικρό, Μεσαίο και Μεγάλο')

      const englishList = translate('en', 'server.event.SPLIT_REQUESTED', {
        count: 3,
        sizes: parts,
        splitId: 'split-1',
      })
      expect(englishList).toContain('Small, Medium and Large')
    })

    test('comma format: joins parts with comma and space', () => {
      const parts = [
        { part: 'STOP_PICKUP' as const, params: { shortId: '10' } },
        { part: 'STOP_DROPOFF' as const, params: { shortId: '10' } },
      ]

      const text = translate('en', 'server.eventPart.STACK_PAIRED', {
        otherDeliveryId: 'del-2',
        stops: parts,
      })
      expect(text).toContain('pickup 10, drop off 10')
    })

    test('nested key lookup $t(...) replaces nested translation keys', () => {
      const greek = translate('el', 'server.event.BOX_SIZE_ASSUMED', { size: 'LARGE', units: 50 })
      expect(greek).toContain('Μεγάλο')

      const english = translate('en', 'server.event.BOX_SIZE_ASSUMED', { size: 'LARGE', units: 50 })
      expect(english).toContain('Large')
    })
  })

  describe('renderEventMessage', () => {
    test('renders event code with params in requested language', () => {
      const enMsg = renderEventMessage('en', 'FOOD_READY', { at: '2026-11-20T10:00:00.000Z' })
      expect(enMsg).toBe('Food ready at 12:00')

      const elMsg = renderEventMessage('el', 'FOOD_READY', { at: '2026-11-20T10:00:00.000Z' })
      expect(elMsg).toBe('Το φαγητό ήταν έτοιμο στις 12:00')
    })

    test('renders ACCEPTED_TOGETHER_AUTOMATICALLY in English and Greek (decision 128.2)', () => {
      const enMsg = renderEventMessage('en', 'ACCEPTED_TOGETHER_AUTOMATICALLY', {
        courierId: 'c-1',
        deliveryId: 'del-1',
        otherDeliveryId: 'del-2',
      })
      expect(enMsg).toBe(
        'Courier c-1 accepted delivery del-1, offered together with delivery del-2 (accepted automatically)'
      )

      const elMsg = renderEventMessage('el', 'ACCEPTED_TOGETHER_AUTOMATICALLY', {
        courierId: 'c-1',
        deliveryId: 'del-1',
        otherDeliveryId: 'del-2',
      })
      expect(elMsg).toBe(
        'Ο διανομέας c-1 αποδέχτηκε την παραγγελία del-1, που προτάθηκε μαζί με την παραγγελία del-2 (αυτόματη αποδοχή)'
      )
    })

    test('renders TIP_CHANGED_BY_RESTAURANT in English and Greek with real amounts (Row 160, clause 4)', () => {
      // English shows raw cents and currency code
      const enMsg = renderEventMessage('en', 'TIP_CHANGED_BY_RESTAURANT', {
        oldTip: 150,
        newTip: 0,
        currency: 'EUR',
      })
      expect(enMsg).toBe('Tip changed by the restaurant from 150 to 0 EUR (cents)')

      // Greek formats amounts with money format (e.g. 1,50 € and 0,00 €)
      const elMsg = renderEventMessage('el', 'TIP_CHANGED_BY_RESTAURANT', {
        oldTip: 150,
        newTip: 0,
        currency: 'EUR',
      })
      expect(elMsg).toBe('Το κατάστημα άλλαξε το φιλοδώρημα από 1,50\u00A0€ σε 0,00\u00A0€')

      // Also verify when raising tip from 0 to 250 cents
      const enMsgRaised = renderEventMessage('en', 'TIP_CHANGED_BY_RESTAURANT', {
        oldTip: 0,
        newTip: 250,
        currency: 'EUR',
      })
      expect(enMsgRaised).toBe('Tip changed by the restaurant from 0 to 250 EUR (cents)')

      const elMsgRaised = renderEventMessage('el', 'TIP_CHANGED_BY_RESTAURANT', {
        oldTip: 0,
        newTip: 250,
        currency: 'EUR',
      })
      expect(elMsgRaised).toBe('Το κατάστημα άλλαξε το φιλοδώρημα από 0,00\u00A0€ σε 2,50\u00A0€')

      // And via translate directly
      const enDirect = translate('en', 'server.event.TIP_CHANGED_BY_RESTAURANT', {
        oldTip: 100,
        newTip: 200,
        currency: 'EUR',
      })
      expect(enDirect).toBe('Tip changed by the restaurant from 100 to 200 EUR (cents)')

      const elDirect = translate('el', 'server.event.TIP_CHANGED_BY_RESTAURANT', {
        oldTip: 100,
        newTip: 200,
        currency: 'EUR',
      })
      expect(elDirect).toBe('Το κατάστημα άλλαξε το φιλοδώρημα από 1,00\u00A0€ σε 2,00\u00A0€')
    })
  })
})
