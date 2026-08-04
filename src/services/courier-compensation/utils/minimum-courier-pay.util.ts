/**
 * The floor under a courier's piece rate for one delivery, in minor currency units.
 *
 * `minimumCourierPay` is the Config value `defaultMinimumCourierPay`, which is nullable —
 * an instance that has never set it gets no floor rather than a crash.
 */
export function applyMinimumCourierPay(compensation: number, minimumCourierPay: number | null): number {
  if (minimumCourierPay === null || !Number.isFinite(minimumCourierPay) || minimumCourierPay <= 0) {
    return compensation
  }

  return Math.max(compensation, minimumCourierPay)
}
