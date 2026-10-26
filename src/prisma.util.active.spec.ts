import { isRecordNotFoundError, isUniqueConstraintError } from './prisma.util'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'

describe('isRecordNotFoundError', () => {
  test('returns true for Prisma NotFoundError by name', () => {
    const err = Object.assign(new Error('No Config found'), { name: 'NotFoundError' })
    expect(isRecordNotFoundError(err)).toBe(true)
  })

  test('returns true for PrismaClientKnownRequestError with P2025', () => {
    const err = new PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: '5.3.1',
    })
    expect(isRecordNotFoundError(err)).toBe(true)
  })

  test('returns false for any other error', () => {
    expect(isRecordNotFoundError(new Error('Some unexpected database error'))).toBe(false)
  })
})

describe('isUniqueConstraintError (AC-4, Decision 26.2)', () => {
  test('returns true for real runtime PrismaClientKnownRequestError with P2002', () => {
    const err = new PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.3.1',
    })
    expect(isUniqueConstraintError(err)).toBe(true)
  })

  test('returns true for generated client shaped P2002 (matched by name and code, not runtime class instance)', () => {
    // The generated client in prisma/client has its own copy of the class, so instanceof runtime class is false
    const err = Object.assign(new Error('Unique constraint failed on (partnerId, phone)'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
    })
    expect(isUniqueConstraintError(err)).toBe(true)
  })

  test('returns false for PrismaClientKnownRequestError with code other than P2002', () => {
    const err = new PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: '5.3.1',
    })
    expect(isUniqueConstraintError(err)).toBe(false)
  })

  test('returns false for generated client error with code other than P2002 (e.g. P2003)', () => {
    const err = Object.assign(new Error('Foreign key violation'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2003',
    })
    expect(isUniqueConstraintError(err)).toBe(false)
  })

  test('returns false for generic errors', () => {
    expect(isUniqueConstraintError(new Error('Standard unexpected error'))).toBe(false)
  })
})
