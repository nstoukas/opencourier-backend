export type TaskName =
  | 'scheduled-orders'
  | 'scheduled-calls'
  | 'cancel-order-payment'
  | 'schedule-force-pickup-fulfillment'
  // Spec 0002: ends one unanswered offer at its deadline, and retries a delivery nobody could take.
  | 'offer-expiry'
  | 'no-courier-retry'
  // Spec 0003: pushes an offer with no deadline again, louder, after 2 minutes unanswered.
  | 'offer-insist'
  // Spec 0005: every day, deletes saved customers unused for savedCustomerRetentionMonths.
  | 'saved-customer-retention'
  // Every minute: start and end dispatch stops whose time came (spec 0014).
  | 'dispatch-stop-tick'

export abstract class TaskBusScheduler {
  abstract scheduleTask<T>(taskName: TaskName, scheduleAt: Date, payload: T): Promise<void>
  abstract cancelPendingTasks<T>(taskName: TaskName, payload: T): Promise<void[]>
}
