import { isRecordNotFoundError } from './prisma.util'
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
