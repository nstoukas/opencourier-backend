import { BadRequestException } from 'src/errors'
import {
  readSavedCustomerListArgs,
  SAVED_CUSTOMER_PAGE_SIZE_DEFAULT,
  SAVED_CUSTOMER_PAGE_SIZE_MAX,
} from './saved-customer-list.args'

describe('readSavedCustomerListArgs (AC-3)', () => {
  it('throws BadRequestException (400) when search text is under 2 characters', () => {
    expect(() => readSavedCustomerListArgs({ q: 'a' })).toThrow(BadRequestException)
    expect(() => readSavedCustomerListArgs({ q: 'a' })).toThrow('Search with 2 characters or more')
    expect(() => readSavedCustomerListArgs({ q: '' })).toThrow(BadRequestException)
    expect(() => readSavedCustomerListArgs({ q: '   ' })).toThrow(BadRequestException)
  })

  it('trims search query and accepts 2 or more characters', () => {
    const result = readSavedCustomerListArgs({ q: '  Nik  ' })
    expect(result.search).toBe('Nik')
  })

  it('returns search: null when q is omitted', () => {
    const result = readSavedCustomerListArgs({})
    expect(result.search).toBeNull()
  })

  it('defaults page to 1 and clamps to minimum of 1', () => {
    expect(readSavedCustomerListArgs({}).page).toBe(1)
    expect(readSavedCustomerListArgs({ page: 0 }).page).toBe(1)
    expect(readSavedCustomerListArgs({ page: -5 }).page).toBe(1)
    expect(readSavedCustomerListArgs({ page: 3 }).page).toBe(3)
  })

  it('defaults perPage to 20 and clamps to range 1..50', () => {
    expect(readSavedCustomerListArgs({}).perPage).toBe(SAVED_CUSTOMER_PAGE_SIZE_DEFAULT)
    expect(readSavedCustomerListArgs({ perPage: 0 }).perPage).toBe(1)
    expect(readSavedCustomerListArgs({ perPage: -10 }).perPage).toBe(1)
    expect(readSavedCustomerListArgs({ perPage: 25 }).perPage).toBe(25)
    expect(readSavedCustomerListArgs({ perPage: 100 }).perPage).toBe(SAVED_CUSTOMER_PAGE_SIZE_MAX)
  })
})
