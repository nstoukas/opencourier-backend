import { isRecordNotFoundError, isTransactionConflictError, isUniqueConstraintError } from './prisma.util'
import { PrismaClientKnownRequestError as LibraryPrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import { Prisma } from '@prisma/types'

describe('isRecordNotFoundError (Row 121, AC-3)', () => {
  test('returns true for Prisma NotFoundError by name', () => {
    const err = Object.assign(new Error('No Config found'), { name: 'NotFoundError' })
    expect(isRecordNotFoundError(err)).toBe(true)
  })

  test('returns true for real generated client Prisma.NotFoundError', () => {
    // Prisma 5's ...OrThrow methods throw NotFoundError from the generated client
    const err = new Prisma.NotFoundError('No Delivery found', '5.3.1')
    expect(isRecordNotFoundError(err)).toBe(true)
  })

  test('returns true for real generated client Prisma.PrismaClientKnownRequestError with P2025', () => {
    const err = new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: '5.3.1',
    })
    expect(isRecordNotFoundError(err)).toBe(true)
  })

  test('returns true for library PrismaClientKnownRequestError with P2025 (backward compatibility)', () => {
    // Existing tests and code might construct errors from @prisma/client/runtime/library
    const err = new LibraryPrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: '5.3.1',
    })
    expect(isRecordNotFoundError(err)).toBe(true)
  })

  test('returns true for a P2025 error named PrismaClientKnownRequestError that is not an instance of any imported class', () => {
    // Matches by name and code P2025 even if constructed across different package copies
    const err = Object.assign(new Error('Record to update not found.'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2025',
    })
    expect(err instanceof Prisma.PrismaClientKnownRequestError).toBe(false)
    expect(err instanceof LibraryPrismaClientKnownRequestError).toBe(false)
    expect(isRecordNotFoundError(err)).toBe(true)
  })

  test('returns false for an error named PrismaClientKnownRequestError with a code other than P2025 (e.g. P2002)', () => {
    const err = Object.assign(new Error('Unique constraint failed'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
    })
    expect(isRecordNotFoundError(err)).toBe(false)
  })

  test('returns false for real generated client Prisma.PrismaClientKnownRequestError with code other than P2025', () => {
    const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.3.1',
    })
    expect(isRecordNotFoundError(err)).toBe(false)
  })

  test('returns false for an error with code P2025 but a different name', () => {
    const err = Object.assign(new Error('Custom not found'), {
      name: 'CustomNotFoundError',
      code: 'P2025',
    })
    expect(isRecordNotFoundError(err)).toBe(false)
  })

  test('returns false for generic errors', () => {
    expect(isRecordNotFoundError(new Error('Some unexpected database error'))).toBe(false)
  })
})

describe('isUniqueConstraintError (AC-4, Decision 26.2)', () => {
  test('returns true for real runtime PrismaClientKnownRequestError with P2002', () => {
    const err = new LibraryPrismaClientKnownRequestError('Unique constraint failed', {
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
    const err = new LibraryPrismaClientKnownRequestError('Record not found', {
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

describe('isTransactionConflictError (Spec 0036, Decision 109.6)', () => {
  test('returns true for real runtime PrismaClientKnownRequestError with P2034', () => {
    const err = new LibraryPrismaClientKnownRequestError('Transaction failed due to a write conflict or a deadlock', {
      code: 'P2034',
      clientVersion: '5.3.1',
    })
    expect(isTransactionConflictError(err)).toBe(true)
  })

  test('returns true for generated client shaped P2034 (matched by name and code, not runtime class instance)', () => {
    const err = Object.assign(new Error('Transaction failed due to a write conflict or a deadlock'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2034',
    })
    expect(isTransactionConflictError(err)).toBe(true)
  })

  test('returns false for PrismaClientKnownRequestError with code other than P2034 (e.g. P2002)', () => {
    const err = new LibraryPrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.3.1',
    })
    expect(isTransactionConflictError(err)).toBe(false)
  })

  test('returns false for generated client error with code other than P2034 (e.g. P2002)', () => {
    const err = Object.assign(new Error('Unique constraint failed'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
    })
    expect(isTransactionConflictError(err)).toBe(false)
  })

  test('returns false for a plain Error', () => {
    expect(isTransactionConflictError(new Error('Standard unexpected error'))).toBe(false)
  })

  test('returns false for undefined', () => {
    expect(isTransactionConflictError(undefined)).toBe(false)
  })

  test('returns false for a string', () => {
    expect(isTransactionConflictError('P2034')).toBe(false)
  })
})
