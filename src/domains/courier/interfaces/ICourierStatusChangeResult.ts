import { EnumCourierStatus } from '@prisma/types'

// What CourierRepository.changeStatus did (spec 0040): whether the status moved, and from what.
export interface ICourierStatusChangeResult {
  changed: boolean
  fromStatus: EnumCourierStatus
}
