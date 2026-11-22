// Spec 0054 (row 47), AC-4: how DeliveryEvent message codes and parameters are stored and formatted.
// Every DeliveryEvent written by the application uses eventText or storedEventText to generate:
// - messageCode: the code from the inventory
// - messageParams: the typed payload values
// - message: the rendered English message matching the historical format word-for-word
// Old rows written before spec 0054 have null messageCode and messageParams, preserving their English message.
import { eventText, eventPart, storedEventText } from './event-text'
import { EVENT_MESSAGE_CODES } from 'src/shared-types/event-messages'

describe('eventText and storedEventText (Spec 0054, AC-4)', () => {
  describe('eventText', () => {
    test('FOOD_READY builds messageCode, messageParams, and renders exact English message with Athens clock', () => {
      // 10:00 UTC = 12:00 in Europe/Athens
      const text = eventText('FOOD_READY', { at: '2026-11-20T10:00:00.000Z' })

      expect(text.messageCode).toBe('FOOD_READY')
      expect(text.messageParams).toEqual({ at: '2026-11-20T10:00:00.000Z' })
      expect(text.message).toBe('Food ready at 12:00')
    })

    test('CREATED builds messageCode and formats readyAt clock', () => {
      const text = eventText('CREATED', {
        deliveryId: 'del-101',
        partnerId: 'partner-202',
        readyAt: '2026-11-20T16:30:00.000Z',
      })

      expect(text.messageCode).toBe('CREATED')
      expect(text.messageParams).toEqual({
        deliveryId: 'del-101',
        partnerId: 'partner-202',
        readyAt: '2026-11-20T16:30:00.000Z',
      })
      // 16:30 UTC = 18:30 in Europe/Athens
      expect(text.message).toBe('Delivery was created delivery del-101 from partner partner-202, ready at 18:30')
    })

    test('NO_COURIER_AVAILABLE builds messageCode with empty params and verbatim English text', () => {
      const text = eventText('NO_COURIER_AVAILABLE', {})

      expect(text.messageCode).toBe('NO_COURIER_AVAILABLE')
      expect(text.messageParams).toEqual({})
      expect(text.message).toBe('No rider free; the delivery waits and is matched again when one is')
    })

    test('CANCELLATION_PAY renders exact English pay sentence with policy and amount', () => {
      const text = eventText('CANCELLATION_PAY', {
        courierId: 'courier-9',
        amount: 350,
        currency: 'EUR',
        policy: 'FULL_COMPENSATION',
        cancelledBy: 'COOP',
      })

      expect(text.messageCode).toBe('CANCELLATION_PAY')
      expect(text.message).toBe(
        'Courier courier-9 paid 350 EUR (cents) under FULL_COMPENSATION for cancellation by COOP'
      )
    })
  })

  describe('eventPart', () => {
    test('eventPart packages part code and part params', () => {
      const part = eventPart('STOP_PICKUP', { shortId: '101' })

      expect(part).toEqual({
        part: 'STOP_PICKUP',
        params: { shortId: '101' },
      })
    })
  })

  describe('storedEventText (AC-4: database column mapping and historical null codes)', () => {
    test('new event with code and params passes all three columns to database', () => {
      const text = eventText('ACCEPTED', { courierId: 'courier-7', deliveryId: 'del-99' })
      const stored = storedEventText(text)

      expect(stored).toEqual({
        message: 'Courier courier-7 accepted delivery del-99',
        messageCode: 'ACCEPTED',
        messageParams: { courierId: 'courier-7', deliveryId: 'del-99' },
      })
    })

    test('event without params omits messageParams so Prisma leaves Json column null', () => {
      const stored = storedEventText({
        message: 'Rider went offline',
        messageCode: 'RIDER_WENT_OFFLINE',
      })

      expect(stored.message).toBe('Rider went offline')
      expect(stored.messageCode).toBe('RIDER_WENT_OFFLINE')
      expect(stored.messageParams).toBeUndefined()
    })

    test('old rows from before spec 0054 (null code) preserve the message and omit messageCode/messageParams', () => {
      // Historical events stored in database have plain English messages without code or params
      const oldEvent = {
        message: 'Delivery was marked as delivered by courier courier-42',
      }
      const stored = storedEventText(oldEvent)

      expect(stored.message).toBe('Delivery was marked as delivered by courier courier-42')
      expect(stored.messageCode).toBeUndefined()
      expect(stored.messageParams).toBeUndefined()
    })

    test('null or empty input produces null message', () => {
      expect(storedEventText(null)).toEqual({ message: null })
      expect(storedEventText(undefined)).toEqual({ message: null })
      expect(storedEventText({ message: null as any })).toEqual({ message: null })
    })
  })
})
