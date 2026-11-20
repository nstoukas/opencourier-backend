import { BoxSize, Prisma } from '@prisma/types'

// What the repository writes: every column of a new delivery.
export type IDeliveryCreateRow = Omit<Prisma.DeliveryUncheckedCreateInput, 'id' | 'createdAt' | 'updatedAt'>

// What a caller of DeliveryDomainService.create passes. Spec 0043: the box columns are not the
// caller's to set. It sends the size the restaurant picked (or none), and create copies the units
// from the co-op's settings and marks a missing size as assumed.
export type IDeliveryCreate = Omit<IDeliveryCreateRow, 'boxSize' | 'boxUnits' | 'boxSizeAssumed'> & {
  boxSize?: BoxSize | null
}
