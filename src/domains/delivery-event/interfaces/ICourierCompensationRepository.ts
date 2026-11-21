import { EnumCourierCompensationReason, CourierCompensation } from '@prisma/types'

export interface ICourierCompensationCreateInput {
  amount: number
  currencyCode: string
  reason: EnumCourierCompensationReason
  policy: string
  message?: string
  courierId: string
  deliveryId: string
  // Set only on a CANCELLATION row, to the delivery id (spec 0015): the unique idempotency key.
  cancellationOf?: string
  // Set only on a WAITING row (spec 0033): one wait is paid once.
  waitOf?: string
  // Set only on a WAITING row (spec 0036): the minutes paid for.
  waitMinutes?: number
  // Set only on a REMOVAL row (spec 0035): the request's id.
  removalOf?: string
  // Set only on a RETURN_TRIP row (spec 0035): the delivery id.
  returnOf?: string
  // Set only on the WAITING row for a split wait (spec 0047): the split request's id.
  splitWaitOf?: string
}

export interface ICourierCompensationRepository {
  create(input: ICourierCompensationCreateInput): Promise<CourierCompensation>
  deleteById(id: string): Promise<void>
}
