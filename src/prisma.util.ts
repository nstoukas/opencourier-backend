// The generated client's class (prisma/client, reached as `@prisma/types`). The copy in
// `@prisma/client/runtime/library` is a different class, so `instanceof` against it was always false for a
// real error (row 121). The by name and code checks below stay, for errors built in tests or by another copy.
import { Prisma } from '@prisma/types'

const { PrismaClientKnownRequestError } = Prisma

export const PRISMA_RECORD_NOT_FOUND_ERROR = 'P2025'
export const PRISMA_UNIQUE_CONSTRAINT_ERROR = 'P2002'
// A transaction Postgres aborted for a write conflict or a deadlock (spec 0036, decision 109.6).
export const PRISMA_TRANSACTION_CONFLICT_ERROR = 'P2034'

export function isRecordNotFoundError(error: Error): boolean {
  if (error instanceof PrismaClientKnownRequestError && error.code === PRISMA_RECORD_NOT_FOUND_ERROR) {
    return true
  }
  if (error?.name === 'NotFoundError') {
    return true
  }
  // Recognised by name and code too, like isUniqueConstraintError, so a P2025 from any copy of the class
  // still answers 404 (row 121).
  return (
    error.name === 'PrismaClientKnownRequestError' &&
    (error as { code?: unknown }).code === PRISMA_RECORD_NOT_FOUND_ERROR
  )
}

export function isUniqueConstraintError(error: Error): boolean {
  if (error instanceof PrismaClientKnownRequestError && error.code === PRISMA_UNIQUE_CONSTRAINT_ERROR) {
    return true
  }
  // Found on 2026-10-26: `instanceof` was false for a real P2002 while the class came from
  // `@prisma/client/runtime/library` (fixed in row 121). Kept: recognise it by name and code as well.
  return (
    error.name === 'PrismaClientKnownRequestError' &&
    (error as { code?: unknown }).code === PRISMA_UNIQUE_CONSTRAINT_ERROR
  )
}

// True when Postgres aborted the transaction for a write conflict or a deadlock: nothing in it was
// written. Recognised by name and code as well, for the same reason as isUniqueConstraintError.
export function isTransactionConflictError(error: unknown): boolean {
  if (error instanceof PrismaClientKnownRequestError && error.code === PRISMA_TRANSACTION_CONFLICT_ERROR) {
    return true
  }
  return (
    error instanceof Error &&
    error.name === 'PrismaClientKnownRequestError' &&
    (error as { code?: unknown }).code === PRISMA_TRANSACTION_CONFLICT_ERROR
  )
}
