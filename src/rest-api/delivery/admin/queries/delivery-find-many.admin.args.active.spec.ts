import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { DeliveryFindManyAdminArgs } from './delivery-find-many.admin.args'

describe('DeliveryFindManyAdminArgs', () => {
  describe('validation with plainToInstance and validate', () => {
    test('accepts empty object (all fields are optional)', async () => {
      const input = plainToInstance(DeliveryFindManyAdminArgs, {})
      const errors = await validate(input)
      expect(errors).toHaveLength(0)
    })

    test.each(['all', 'active', 'dropped_off', 'canceled'] as const)(
      'accepts valid state: "%s"',
      async (state) => {
        const input = plainToInstance(DeliveryFindManyAdminArgs, { state })
        const errors = await validate(input)
        expect(errors.filter((e) => e.property === 'state')).toHaveLength(0)
      }
    )

    test.each(['invalid', 'DROPPED_OFF', 'Active', 'completed', 'failed', 'unknown'])(
      'rejects invalid state: "%s"',
      async (state) => {
        const input = plainToInstance(DeliveryFindManyAdminArgs, { state })
        const errors = await validate(input)
        const stateError = errors.find((e) => e.property === 'state')
        expect(stateError).toBeDefined()
        expect(stateError?.constraints?.isIn).toBeDefined()
      }
    )

    test('accepts search string with up to 100 characters', async () => {
      const input100 = plainToInstance(DeliveryFindManyAdminArgs, {
        search: 'a'.repeat(100),
      })
      const errors100 = await validate(input100)
      expect(errors100.filter((e) => e.property === 'search')).toHaveLength(0)

      const inputShort = plainToInstance(DeliveryFindManyAdminArgs, {
        search: 'Nikos',
      })
      const errorsShort = await validate(inputShort)
      expect(errorsShort.filter((e) => e.property === 'search')).toHaveLength(0)
    })

    test('refuses search string of 101 characters', async () => {
      const input = plainToInstance(DeliveryFindManyAdminArgs, {
        search: 'a'.repeat(101),
      })
      const errors = await validate(input)
      const searchError = errors.find((e) => e.property === 'search')
      expect(searchError).toBeDefined()
      expect(searchError?.constraints?.maxLength).toBeDefined()
    })

    test('accepts courierId, page, and perPage', async () => {
      const input = plainToInstance(DeliveryFindManyAdminArgs, {
        courierId: 'courier-1',
        page: 1,
        perPage: 25,
      })
      const errors = await validate(input)
      expect(errors).toHaveLength(0)
    })
  })

  describe('ValidationPipe with app configuration', () => {
    // Real ValidationPipe configured with exact options from src/main.ts
    const pipe = new ValidationPipe({
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    })

    const transform = (query: any) =>
      pipe.transform(query, { type: 'query', metatype: DeliveryFindManyAdminArgs })

    test('accepts valid state values and transforms them', async () => {
      for (const state of ['all', 'active', 'dropped_off', 'canceled']) {
        const transformed = await transform({ state })
        expect(transformed).toBeInstanceOf(DeliveryFindManyAdminArgs)
        expect(transformed.state).toBe(state)
      }
    })

    test('refuses invalid state with 400 BadRequestException', async () => {
      await expect(transform({ state: 'invalid-state' })).rejects.toBeInstanceOf(
        BadRequestException
      )
      await expect(transform({ state: 'pending' })).rejects.toBeInstanceOf(
        BadRequestException
      )
    })

    test('accepts search string with up to 100 characters', async () => {
      const search100 = 'x'.repeat(100)
      const transformed = await transform({ search: search100 })
      expect(transformed).toBeInstanceOf(DeliveryFindManyAdminArgs)
      expect(transformed.search).toBe(search100)
    })

    test('refuses search string of 101 characters with 400 BadRequestException', async () => {
      const search101 = 'x'.repeat(101)
      await expect(transform({ search: search101 })).rejects.toBeInstanceOf(
        BadRequestException
      )
    })

    test('transforms query with page, perPage, courierId, state, and search', async () => {
      const transformed = await transform({
        page: '2',
        perPage: '15',
        courierId: 'courier-1',
        state: 'active',
        search: 'Souvlaki',
      })
      expect(transformed).toBeInstanceOf(DeliveryFindManyAdminArgs)
      expect(transformed.page).toBe(2)
      expect(transformed.perPage).toBe(15)
      expect(transformed.courierId).toBe('courier-1')
      expect(transformed.state).toBe('active')
      expect(transformed.search).toBe('Souvlaki')
    })
  })
})
