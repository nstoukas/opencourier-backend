import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'

export const PRISMA_RECORD_NOT_FOUND_ERROR = 'P2025'
export const PRISMA_UNIQUE_CONSTRAINT_ERROR = 'P2002'

export function isRecordNotFoundError(error: Error): boolean {
  if (error instanceof PrismaClientKnownRequestError && error.code === PRISMA_RECORD_NOT_FOUND_ERROR) {
    return true
  }
  if (error?.name === 'NotFoundError') {
    return true
  }
  return false
}

export function isUniqueConstraintError(error: Error): boolean {
  if (error instanceof PrismaClientKnownRequestError && error.code === PRISMA_UNIQUE_CONSTRAINT_ERROR) {
    return true
  }
  // The client is generated into prisma/client with its own copy of the runtime, so its errors are
  // not instances of the class imported above (found on 2026-10-26: `instanceof` was false for a real
  // P2002). Recognise it by name and code instead, as isRecordNotFoundError does by name.
  return (
    error.name === 'PrismaClientKnownRequestError' &&
    (error as { code?: unknown }).code === PRISMA_UNIQUE_CONSTRAINT_ERROR
  )
}

