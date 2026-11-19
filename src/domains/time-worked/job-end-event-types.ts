import { EnumDeliveryEventType } from '@prisma/types'

// Spec 0040 (AC-4, decision 36.22): every successful event that ends a rider's job on a delivery.
// It holds each type that moves a delivery from a status in DELIVERY_ONGOING_STATUSES to one
// outside it in STATE_MACHINE (DROPPED_OFF, CANCELED, FAILED and the four that hand the delivery back
// to matching), plus the end types recorded outside STATE_MACHINE, plus a later ACCEPTED by anyone
// (the delivery changed hands). A guard test walks STATE_MACHINE and fails if a type that leaves the
// ongoing statuses is missing here: a new way to end a job must be added to this list, or the job
// would run on until the delivery's last event.
export const JOB_END_EVENT_TYPES: ReadonlySet<EnumDeliveryEventType> = new Set<EnumDeliveryEventType>([
  EnumDeliveryEventType.DROPPED_OFF,
  EnumDeliveryEventType.CANCELED,
  EnumDeliveryEventType.FAILED,
  EnumDeliveryEventType.REASSIGNED,
  EnumDeliveryEventType.RETURNED_TO_WAITING,
  EnumDeliveryEventType.HANDED_BACK,
  EnumDeliveryEventType.WAIT_UNDISPATCHED,
  EnumDeliveryEventType.REMOVAL_APPROVED,
  EnumDeliveryEventType.ACCEPTED,
])

// After a CANCELED from PICKED_UP or later the rider still carries the food back, so the job runs on
// to one of these, if one follows (AC-4).
export const RETURN_TRIP_END_EVENT_TYPES: ReadonlySet<EnumDeliveryEventType> = new Set<EnumDeliveryEventType>([
  EnumDeliveryEventType.FOOD_RETURNED,
  EnumDeliveryEventType.FOOD_NOT_RETURNED,
])
