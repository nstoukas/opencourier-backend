import { EnumDeliveryStatus, Prisma } from '@prisma/types'
import {
  adminDeliveryListWhere,
  ADMIN_DELIVERY_STATES,
  MAX_DELIVERY_SEARCH_LENGTH,
} from './delivery-list-filter'

describe('delivery-list-filter', () => {
  describe('ADMIN_DELIVERY_STATES and MAX_DELIVERY_SEARCH_LENGTH', () => {
    test('ADMIN_DELIVERY_STATES contains exactly the four allowed states', () => {
      expect(ADMIN_DELIVERY_STATES).toEqual(['all', 'active', 'dropped_off', 'canceled'])
    })

    test('MAX_DELIVERY_SEARCH_LENGTH is 100 characters', () => {
      expect(MAX_DELIVERY_SEARCH_LENGTH).toBe(100)
    })
  })

  describe('adminDeliveryListWhere', () => {
    test('no filter gives empty where object {}', () => {
      expect(adminDeliveryListWhere({})).toEqual({})
      expect(
        adminDeliveryListWhere({
          courierId: undefined,
          state: undefined,
          search: undefined,
        })
      ).toEqual({})
    })

    test('courierId is kept in where', () => {
      const where = adminDeliveryListWhere({ courierId: 'courier-volos-1' })
      expect(where).toEqual({ courierId: 'courier-volos-1' })
    })

    describe('state filter (decision 96.1)', () => {
      test('state active = status notIn [DROPPED_OFF, CANCELED, FAILED]', () => {
        const where = adminDeliveryListWhere({ state: 'active' })
        expect(where).toEqual({
          status: {
            notIn: [
              EnumDeliveryStatus.DROPPED_OFF,
              EnumDeliveryStatus.CANCELED,
              EnumDeliveryStatus.FAILED,
            ],
          },
        })
        // Explicitly check that DROPPED_OFF is excluded so active deliveries include only in-flight/waiting
        expect((where.status as any).notIn).toContain(EnumDeliveryStatus.DROPPED_OFF)
        expect((where.status as any).notIn).toContain(EnumDeliveryStatus.CANCELED)
        expect((where.status as any).notIn).toContain(EnumDeliveryStatus.FAILED)
      })

      test('state dropped_off = status DROPPED_OFF', () => {
        const where = adminDeliveryListWhere({ state: 'dropped_off' })
        expect(where).toEqual({
          status: EnumDeliveryStatus.DROPPED_OFF,
        })
      })

      test('state canceled = status in [CANCELED, FAILED]', () => {
        const where = adminDeliveryListWhere({ state: 'canceled' })
        expect(where).toEqual({
          status: {
            in: [EnumDeliveryStatus.CANCELED, EnumDeliveryStatus.FAILED],
          },
        })
      })

      test('state all = no status rule in where', () => {
        const where = adminDeliveryListWhere({ state: 'all' })
        expect(where.status).toBeUndefined()
        expect(where).toEqual({})
      })
    })

    describe('search filter (decision 96.1)', () => {
      test('search ORs orderReference, dropoffName, pickupBusinessName (case-insensitive) and id endsWith', () => {
        const where = adminDeliveryListWhere({ search: 'Nikou' })
        expect(where).toEqual({
          OR: [
            { orderReference: { contains: 'Nikou', mode: Prisma.QueryMode.insensitive } },
            { dropoffName: { contains: 'Nikou', mode: Prisma.QueryMode.insensitive } },
            { pickupBusinessName: { contains: 'Nikou', mode: Prisma.QueryMode.insensitive } },
            { id: { endsWith: 'Nikou' } },
          ],
        })
        // Assert case-insensitive mode is explicitly set on all contains clauses
        const orClauses = where.OR as any[]
        expect(orClauses[0].orderReference.mode).toBe('insensitive')
        expect(orClauses[1].dropoffName.mode).toBe('insensitive')
        expect(orClauses[2].pickupBusinessName.mode).toBe('insensitive')
      })

      test('search trims leading and trailing whitespace', () => {
        const where = adminDeliveryListWhere({ search: '   ORD-9988   ' })
        expect(where).toEqual({
          OR: [
            { orderReference: { contains: 'ORD-9988', mode: Prisma.QueryMode.insensitive } },
            { dropoffName: { contains: 'ORD-9988', mode: Prisma.QueryMode.insensitive } },
            { pickupBusinessName: { contains: 'ORD-9988', mode: Prisma.QueryMode.insensitive } },
            { id: { endsWith: 'ORD-9988' } },
          ],
        })
      })

      test('ignores empty search string', () => {
        const where = adminDeliveryListWhere({ search: '' })
        expect(where.OR).toBeUndefined()
        expect(where).toEqual({})
      })

      test('ignores spaces-only search string', () => {
        const where = adminDeliveryListWhere({ search: '     ' })
        expect(where.OR).toBeUndefined()
        expect(where).toEqual({})
      })

      test('ignores undefined search', () => {
        const where = adminDeliveryListWhere({ search: undefined })
        expect(where.OR).toBeUndefined()
        expect(where).toEqual({})
      })
    })

    describe('combining courier, state, and search', () => {
      test('combines courierId, state active, and search', () => {
        const where = adminDeliveryListWhere({
          courierId: 'courier-42',
          state: 'active',
          search: 'souvlaki',
        })

        expect(where).toEqual({
          courierId: 'courier-42',
          status: {
            notIn: [
              EnumDeliveryStatus.DROPPED_OFF,
              EnumDeliveryStatus.CANCELED,
              EnumDeliveryStatus.FAILED,
            ],
          },
          OR: [
            { orderReference: { contains: 'souvlaki', mode: Prisma.QueryMode.insensitive } },
            { dropoffName: { contains: 'souvlaki', mode: Prisma.QueryMode.insensitive } },
            { pickupBusinessName: { contains: 'souvlaki', mode: Prisma.QueryMode.insensitive } },
            { id: { endsWith: 'souvlaki' } },
          ],
        })
      })

      test('combines courierId and state dropped_off without search', () => {
        const where = adminDeliveryListWhere({
          courierId: 'courier-42',
          state: 'dropped_off',
        })
        expect(where).toEqual({
          courierId: 'courier-42',
          status: EnumDeliveryStatus.DROPPED_OFF,
        })
      })

      test('combines state canceled and search without courierId', () => {
        const where = adminDeliveryListWhere({
          state: 'canceled',
          search: 'cancellation-ref',
        })
        expect(where.courierId).toBeUndefined()
        expect(where.status).toEqual({
          in: [EnumDeliveryStatus.CANCELED, EnumDeliveryStatus.FAILED],
        })
        expect(where.OR).toBeDefined()
      })

      test('combines courierId and search with state all (no status in where)', () => {
        const where = adminDeliveryListWhere({
          courierId: 'courier-42',
          state: 'all',
          search: 'customer-name',
        })
        expect(where.courierId).toBe('courier-42')
        expect(where.status).toBeUndefined()
        expect(where.OR).toBeDefined()
      })
    })
  })
})
