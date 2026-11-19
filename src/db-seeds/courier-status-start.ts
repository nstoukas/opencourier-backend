import { EnumCourierStatus, EnumCourierStatusChangeCause, PrismaClient } from '@prisma/types'

// Spec 0040 (AC-1): a seed or dev script that creates a rider who is not Offline also writes the
// SYSTEM_START row that opens their record, so the rider's last status change always matches their
// status. Seeds run alone, so the row's own default time is enough here.
export const recordSystemStart = async (
  prisma: PrismaClient,
  courier: { id: string; status: EnumCourierStatus }
): Promise<void> => {
  if (courier.status === EnumCourierStatus.OFFLINE) return
  await prisma.courierStatusChange.create({
    data: {
      courierId: courier.id,
      fromStatus: EnumCourierStatus.OFFLINE,
      toStatus: courier.status,
      cause: EnumCourierStatusChangeCause.SYSTEM_START,
    },
  })
}
