export type TaskName =
  | 'scheduled-orders'
  | 'scheduled-calls'
  | 'cancel-order-payment'
  | 'schedule-force-pickup-fulfillment'
  // Spec 0002: ends one unanswered offer at its deadline, and retries a delivery nobody could take.
  | 'offer-expiry'
  | 'no-courier-retry'

export abstract class TaskBusScheduler {
  abstract scheduleTask<T>(taskName: TaskName, scheduleAt: Date, payload: T): Promise<void>
  abstract cancelPendingTasks<T>(taskName: TaskName, payload: T): Promise<void[]>
}
