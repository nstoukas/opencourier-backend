import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { MAX_PARTNER_SEARCH_LENGTH, PartnerFindManyAdminArgs } from './partner-find-many.admin.args'

// Row 106: the admin restaurants list takes an optional `search` of at most 100 characters.
describe('PartnerFindManyAdminArgs search (scope row 106)', () => {
  test('the limit is 100 characters', () => {
    expect(MAX_PARTNER_SEARCH_LENGTH).toBe(100)
  })

  describe('validate', () => {
    const searchErrors = async (plain: object) => {
      const errors = await validate(plainToInstance(PartnerFindManyAdminArgs, plain))
      return errors.filter((error) => error.property === 'search')
    }

    test('accepts no search at all', async () => {
      expect(await searchErrors({})).toHaveLength(0)
    })

    test('accepts a search of exactly 100 characters and a short Greek one', async () => {
      expect(await searchErrors({ search: 'α'.repeat(100) })).toHaveLength(0)
      expect(await searchErrors({ search: 'Νόσης Ιάσονος' })).toHaveLength(0)
    })

    test('refuses a search of 101 characters with maxLength', async () => {
      const errors = await searchErrors({ search: 'a'.repeat(101) })
      expect(errors).toHaveLength(1)
      expect(errors[0]?.constraints?.maxLength).toBeDefined()
    })

    test.each([[123], [true], [{ text: 'nosh' }], [['nosh', 'volos']]])('refuses a non string search: %p', async (search) => {
      const errors = await searchErrors({ search })
      expect(errors).toHaveLength(1)
      expect(errors[0]?.constraints?.isString).toBeDefined()
    })
  })

  describe('ValidationPipe with the options of main.ts', () => {
    const pipe = new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } })
    const transform = (query: object) => pipe.transform(query, { type: 'query', metatype: PartnerFindManyAdminArgs })

    test('passes a search of 100 characters through unchanged, with page and perPage', async () => {
      const search = 'x'.repeat(100)
      const result = await transform({ page: '2', perPage: '10', search })
      expect(result).toBeInstanceOf(PartnerFindManyAdminArgs)
      expect(result.search).toBe(search)
      expect(result.page).toBe(2)
      expect(result.perPage).toBe(10)
    })

    test('refuses a search of 101 characters with a 400', async () => {
      await expect(transform({ search: 'x'.repeat(101) })).rejects.toBeInstanceOf(BadRequestException)
    })

    test('refuses a search sent twice (?search=a&search=b arrives as an array) with a 400', async () => {
      await expect(transform({ search: ['nosh', 'volos'] })).rejects.toBeInstanceOf(BadRequestException)
    })

    test('leaves search undefined when it is not sent', async () => {
      const result = await transform({ page: '1' })
      expect(result.search).toBeUndefined()
    })
  })
})
