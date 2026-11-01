import { roundMoney } from 'src/core/utils/money'
import { FALLBACK_CANCELLATION_PAYOUT_POLICY } from 'src/shared-types/index'

// Spec 0015. Which policy pays a rider whose job was cancelled, and how much, in cents.
// Same rounding and 100% cap as resolveReassignmentPayout, but it never throws: a broken setting
// must never cost the rider their pay (value 4). Each problem comes back as a warning to log.
export function resolveCancellationPayout(
  menu: Record<string, number>,
  storedPolicyKey: string,
  totalCompensation: number | null
): { policy: string; amount: number; warnings: string[] } {
  const warnings: string[] = []

  // The key's percentage when it is a usable one (on the menu, 0 to 100), else null.
  // hasOwnProperty: a key like 'constructor' is never a policy.
  const usablePercent = (key: string): number | null => {
    const percent = Object.prototype.hasOwnProperty.call(menu, key) ? menu[key] : undefined
    return typeof percent === 'number' && Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : null
  }

  let policy = storedPolicyKey
  let percent = usablePercent(policy)
  if (percent === null) {
    policy = FALLBACK_CANCELLATION_PAYOUT_POLICY
    percent = usablePercent(policy)
    if (percent !== null) {
      warnings.push(
        `cancellationPayoutPolicy '${storedPolicyKey}' is not a usable key of reassignmentPayoutPolicies; paid under '${FALLBACK_CANCELLATION_PAYOUT_POLICY}' instead`
      )
    } else {
      warnings.push(
        `cancellationPayoutPolicy '${storedPolicyKey}' is not a usable key of reassignmentPayoutPolicies, and neither is '${FALLBACK_CANCELLATION_PAYOUT_POLICY}'; paid in full`
      )
      percent = 100
    }
  }

  if (totalCompensation === null) {
    warnings.push('the delivery has no totalCompensation, so the cancellation pays 0')
  }
  const amount = roundMoney(((totalCompensation ?? 0) * percent) / 100)

  return { policy, amount, warnings }
}
