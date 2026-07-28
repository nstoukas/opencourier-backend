import { BadRequestException, InternalServerErrorException } from '@nestjs/common'
import { roundMoney } from 'src/core/utils/money'

// Pure function: given the votable menu, the votable default, the admin's (optional)
// choice and the delivery's piece-rate, returns which policy applies and the amount in
// cents. Throws BadRequestException when a requested policy is invalid, or
// InternalServerErrorException when stored instance configuration is broken.
export function resolveReassignmentPayout(
  menu: Record<string, number>,
  defaultPolicyKey: string,
  requestedPolicyKey: string | undefined,
  totalCompensation: number | null
): { policy: string; amount: number } {
  // Where the policy key came from decides who is at fault — and therefore the HTTP status.
  // requestedPolicyKey === undefined means nobody asked for a policy, so we fell back to the
  // stored default, and any problem with it is server-side config, not bad admin input.
  const policyCameFromRequest = requestedPolicyKey !== undefined
  const policy = requestedPolicyKey ?? defaultPolicyKey
  const percent = menu[policy]
  const allowedKeys = Object.keys(menu).join(', ')

  if (!Object.prototype.hasOwnProperty.call(menu, policy)) {
    if (policyCameFromRequest) {
      throw new BadRequestException(
        `Invalid payout policy '${policy}'. Allowed policies: ${allowedKeys}`
      )
    }
    throw new InternalServerErrorException(
      `Instance config error: the configured default reassignment payout policy '${policy}' is not on the votable menu. Allowed policies: ${allowedKeys}. An admin must fix reassignmentPayoutDefaultPolicy in the instance config.`
    )
  }

  // Co-op policy: payout is capped at 100% of the piece-rate.
  // Members who want >100% must restructure as a separate payment, not a reassignment policy.
  if (
    typeof percent !== 'number' ||
    !Number.isFinite(percent) ||
    percent < 0 ||
    percent > 100
  ) {
    throw new InternalServerErrorException(
      `Instance config error: payout policy '${policy}' has an invalid percentage value '${percent}'. Each policy value must be a finite number between 0 and 100.`
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
