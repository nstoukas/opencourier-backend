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

// Which failure path produced the log line. Each one implies a different recovery action,
// so the stage is part of the message rather than something the reader has to infer.
export type ReassignmentFailureStage =
  | 'AWARD_WRITE_FAILED'
  | 'REASSIGNMENT_DID_NOT_TAKE_EFFECT'
  | 'REASSIGNMENT_OUTCOME_UNKNOWN'
  | 'AWARD_ROLLBACK_FAILED'
  | 'REJECTED_LIST_ROLLBACK_FAILED'

export interface ReassignmentAwardLogContext {
  deliveryId: string
  droppedCourierId: string
  amount: number
  currencyCode: string
  policy: string
  compensationId: string | null
  stage: ReassignmentFailureStage
}

const REASSIGNMENT_FAILURE_CONSEQUENCES: Record<ReassignmentFailureStage, string> = {
  AWARD_WRITE_FAILED:
    'no award was written and the delivery was NOT reassigned; the admin can safely retry',
  REASSIGNMENT_DID_NOT_TAKE_EFFECT:
    'the reassignment did not take effect; the award row is being removed and the delivery still belongs to the dropped courier',
  REASSIGNMENT_OUTCOME_UNKNOWN:
    'the award row was KEPT because the reassignment outcome could not be read; check the delivery status and delete the award only if the delivery was not reassigned',
  AWARD_ROLLBACK_FAILED:
    'an award row remains for a delivery that was NOT reassigned; delete it manually',
  REJECTED_LIST_ROLLBACK_FAILED:
    'the award row was removed correctly, but the dropped courier is still excluded from re-offers of this delivery for up to 20 minutes; no action needed unless the delivery goes back to matching in that window',
}

// One grep-able line per failure, carrying everything needed to recreate a lost award by
// hand: which delivery, which rider, how much, under which votable policy.
export function formatReassignmentAwardFailure(context: ReassignmentAwardLogContext): string {
  const consequence = REASSIGNMENT_FAILURE_CONSEQUENCES[context.stage]

  return (
    `REASSIGNMENT_AWARD ${context.stage} ` +
    `deliveryId=${context.deliveryId} ` +
    `droppedCourierId=${context.droppedCourierId} ` +
    `amount=${context.amount} ` +
    `currencyCode=${context.currencyCode} ` +
    `policy=${context.policy} ` +
    `compensationId=${context.compensationId ?? 'none'} — ${consequence}`
  )
}
