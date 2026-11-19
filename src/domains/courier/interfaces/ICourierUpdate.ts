import { Courier } from '@prisma/types'

// `status` is left out on purpose (spec 0040, AC-1): a rider's status is written only by
// CourierRepository.changeStatus, which records each change. Typecheck stops any other write.
export type ICourierUpdate = Partial<
  Omit<Courier, 'id' | 'createdAt' | 'updatedAt' | 'userId' | 'rejectedOffers' | 'status'>
>
