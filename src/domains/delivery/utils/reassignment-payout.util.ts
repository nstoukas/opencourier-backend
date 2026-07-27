import { BadRequestException } from '@nestjs/common'
import { roundMoney } from 'src/core/utils/money'

// Pure function: given the votable menu, the votable default, the admin's (optional)
// choice and the delivery's piece-rate, returns which policy applies and the amount in
// cents. Throws on a policy that is not on the menu — the admin picks FROM the menu,
// they do not invent amounts.
export function resolveReassignmentPayout(
  menu: Record<string, number>,
  defaultPolicyKey: string,
  requestedPolicyKey: string | undefined,
  totalCompensation: number | null
): { policy: string; amount: number } {
  const policy = requestedPolicyKey ?? defaultPolicyKey
  const percent = menu[policy]

  // Co-op policy: payout is capped at 100% of the piece-rate.
  // Members who want >100% must restructure as a separate payment, not a reassignment policy.
  if (
    percent === undefined ||
    typeof percent !== 'number' ||
    !Number.isFinite(percent) ||
    percent < 0 ||
    percent > 100
  ) {
    const allowedKeys = Object.keys(menu).join(', ')
    throw new BadRequestException(
      `Invalid payout policy '${policy}'. Allowed policies: ${allowedKeys}`
    )
  }

  const baseCompensation = totalCompensation ?? 0
  const amount = roundMoney((baseCompensation * percent) / 100)

  return { policy, amount }
}
