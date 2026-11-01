import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CourierFindManyAdminArgs } from './courier-find-many.admin.args'

describe('CourierFindManyAdminArgs (scope row 97, Clause 4)', () => {
  describe('validation with plainToInstance and validate', () => {
    test('accepts empty object (all fields are optional)', async () => {
      const input = plainToInstance(CourierFindManyAdminArgs, {})
      const errors = await validate(input)
      expect(errors).toHaveLength(0)
    })

    test.each(['all', 'working', 'offline'] as const)(
      'accepts valid status: "%s"',
      async (status) => {
        const input = plainToInstance(CourierFindManyAdminArgs, { status })
        const errors = await validate(input)
        expect(errors.filter((e) => e.property === 'status')).toHaveLength(0)
      }
    )

    test.each(['invalid', 'ONLINE', 'online', 'LAST_CALL', 'busy', 'pending', 'offline '])(
      'rejects invalid status: "%s"',
      async (status) => {
        const input = plainToInstance(CourierFindManyAdminArgs, { status })
        const errors = await validate(input)
        const statusError = errors.find((e) => e.property === 'status')
        expect(statusError).toBeDefined()
        expect(statusError?.constraints?.isIn).toBeDefined()
      }
    )

    test('accepts search string with up to 100 characters', async () => {
      const input100 = plainToInstance(CourierFindManyAdminArgs, {
        search: 'a'.repeat(100),
      })
      const errors100 = await validate(input100)
      expect(errors100.filter((e) => e.property === 'search')).toHaveLength(0)

      const inputShort = plainToInstance(CourierFindManyAdminArgs, {
        search: 'Giorgos',
      })
      const errorsShort = await validate(inputShort)
      expect(errorsShort.filter((e) => e.property === 'search')).toHaveLength(0)
    })

    test('refuses search string of 101 characters', async () => {
      const input = plainToInstance(CourierFindManyAdminArgs, {
        search: 'a'.repeat(101),
      })
      const errors = await validate(input)
      const searchError = errors.find((e) => e.property === 'search')
      expect(searchError).toBeDefined()
      expect(searchError?.constraints?.maxLength).toBeDefined()
    })

    test('accepts page and perPage as optional integers', async () => {
      const input = plainToInstance(CourierFindManyAdminArgs, {
        page: 1,
        perPage: 25,
      })
      const errors = await validate(input)
      expect(errors).toHaveLength(0)
    })
  })

  describe('ValidationPipe with app configuration (main.ts options)', () => {
    // Real ValidationPipe configured with exact options from src/main.ts
    const pipe = new ValidationPipe({
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    })

    const transform = (query: any) =>
      pipe.transform(query, { type: 'query', metatype: CourierFindManyAdminArgs })

    test('accepts valid status values and transforms them', async () => {
      for (const status of ['all', 'working', 'offline']) {
        const transformed = await transform({ status })
        expect(transformed).toBeInstanceOf(CourierFindManyAdminArgs)
        expect(transformed.status).toBe(status)
      }
    })

    test('refuses invalid status with 400 BadRequestException', async () => {
      await expect(transform({ status: 'invalid-status' })).rejects.toBeInstanceOf(
        BadRequestException
      )
      await expect(transform({ status: 'busy' })).rejects.toBeInstanceOf(
        BadRequestException
      )
      await expect(transform({ status: 'online' })).rejects.toBeInstanceOf(
        BadRequestException
      )
    })

    test('accepts search string with up to 100 characters', async () => {
      const search100 = 'x'.repeat(100)
      const transformed = await transform({ search: search100 })
      expect(transformed).toBeInstanceOf(CourierFindManyAdminArgs)
      expect(transformed.search).toBe(search100)
    })

    test('refuses search string of 101 characters with 400 BadRequestException', async () => {
      const search101 = 'x'.repeat(101)
      await expect(transform({ search: search101 })).rejects.toBeInstanceOf(
        BadRequestException
      )
    })

    test('transforms full query with page, perPage, status, and search', async () => {
      const transformed = await transform({
        page: '2',
        perPage: '15',
        status: 'working',
        search: 'Giorgos Pap',
      })
      expect(transformed).toBeInstanceOf(CourierFindManyAdminArgs)
      expect(transformed.page).toBe(2)
      expect(transformed.perPage).toBe(15)
      expect(transformed.status).toBe('working')
      expect(transformed.search).toBe('Giorgos Pap')
    })

    test('transforms empty query object when both status and search are omitted', async () => {
      const transformed = await transform({})
      expect(transformed).toBeInstanceOf(CourierFindManyAdminArgs)
      expect(transformed.status).toBeUndefined()
      expect(transformed.search).toBeUndefined()
      expect(transformed.page).toBeUndefined()
      expect(transformed.perPage).toBeUndefined()
    })
  })
})
