import { Injectable, Logger } from '@nestjs/common'
import { EnumDeliveryEventType } from '@prisma/types'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { RIDER_BOX_UNITS } from 'src/domains/delivery/box'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { StackSequence, bestStackSequence, stackPairBlockKey, stackRefusal } from 'src/domains/delivery/stack'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import { DeliveryEventRepository } from 'src/persistence/repositories/delivery-event.repository'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { CacheService } from 'src/services/cache/cache.service'
import { CacheHelpers } from 'src/services/cache/cache.helpers'
import { OsrmRoutingService } from 'src/services/osrm/osrm-routing.service'
import { EnumTwoOrderPolicy } from 'src/shared-types/stacking'

// How many waiting orders are tried as the second order of a stack, the longest waiting first. Each one
// costs one road table, so the offer is never held up by a long list.
const STACK_CANDIDATE_LIMIT = 5

// A stack ready to be offered: the second delivery and the order of the four stops (spec 0048, AC-4).
export interface StackPlan {
  partner: DeliveryEntity
  sequence: StackSequence
}

// Spec 0048 (Decision): the pairing logic, beside the matcher. DeliveryEventService asks it, once the
// matcher has chosen a free rider for a delivery, whether a second waiting delivery should go to the same
// rider in one offer. It reads and decides; it writes nothing (the claim does, under the rider's lock).
// Slice 1: orders of the same restaurant only.
@Injectable()
export class TwoOrderService {
  private readonly logger = new Logger(TwoOrderService.name)

  constructor(
    private readonly configDomainService: ConfigDomainService,
    private readonly deliveryRepository: DeliveryRepository,
    private readonly deliveryEventRepository: DeliveryEventRepository,
    private readonly courierRepository: CourierRepository,
    private readonly cacheService: CacheService,
    private readonly osrmRoutingService: OsrmRoutingService
  ) {}

  // The second delivery for a stack with `first`, offered to `courierId`, or null for a single offer.
  // `isDue`: whether the candidate's own offer would go out now (spec 0031, cross check 11: a stack is
  // offered only when both are due). Never throws: anything it cannot read means a single offer, so a
  // delivery is never held back by the stacking rules (value 4: the first order still goes out).
  async findStackPartner(
    first: DeliveryEntity,
    courierId: string,
    isDue: (candidate: DeliveryEntity) => Promise<boolean>
  ): Promise<StackPlan | null> {
    try {
      const config = this.configDomainService.instanceConfig
      if (!(await config.getStackingEnabled())) return null
      const [policy, delayLimitMinutes] = await Promise.all([config.getTwoOrderPolicy(), config.getTwoOrderDelayLimitMinutes()])

      // The rider already holds nothing else (key invariants: two at most), and what room is left once the
      // first order is in. A free rider may still carry food back from a cancellation (spec 0043).
      if ((await this.courierRepository.heldDeliveryCount(courierId, first.id)) > 0) return null
      const room = RIDER_BOX_UNITS - first.boxUnits - (await this.courierRepository.heldBoxUnits(courierId))
      if (room < 1) return null

      const candidates = await this.deliveryRepository.findStackPartnerCandidates(first, room, STACK_CANDIDATE_LIMIT)
      if (candidates.length === 0) return null

      const riderAt = await this.courierRepository.getCurrentLocation(courierId)
      if (!riderAt) return null
      const firstPlaces = await this.deliveryRepository.findByIdOrThrowWithLocations(first.id)
      if (!firstPlaces.pickupLocation || !firstPlaces.dropoffLocation) return null

      for (const candidate of candidates) {
        const refusal = stackRefusal(first, candidate)
        if (refusal) continue
        // Cross check 9: the two were stacked, and the stack was declined or missed, in the last 20 minutes.
        if (await this.cacheService.get<boolean>(stackPairBlockKey(first.id, candidate.id))) continue
        // Cross check 4: the second order's own filters apply to the rider. Its skip list; its distance is the
        // first order's, since both are picked up at the same point (stackRefusal).
        const skipped = await this.cacheService.getOrDefault<string[]>(
          CacheHelpers.getDeliveryRejectedCouriersKey(candidate.id),
          []
        )
        if (skipped.includes(courierId)) continue
        if (policy === EnumTwoOrderPolicy.SHORTAGE_ONLY && !(await this.hadNoFreeRider(candidate.id))) continue
        if (!(await isDue(candidate))) continue

        const places = await this.deliveryRepository.findByIdOrThrowWithLocations(candidate.id)
        if (!places.pickupLocation || !places.dropoffLocation) continue

        let seconds: (number | null)[][]
        try {
          seconds = await this.osrmRoutingService.getDurationMatrix([
            riderAt,
            firstPlaces.pickupLocation,
            places.pickupLocation,
            firstPlaces.dropoffLocation,
            places.dropoffLocation,
          ])
        } catch (error) {
          // Cross check 5: with OSRM down, no stack is offered at all.
          this.logger.warn(`No road times for a stack with delivery ${first.id}; offering it alone`)
          return null
        }

        const sequence = bestStackSequence({
          firstId: first.id,
          secondId: candidate.id,
          seconds,
          firstReadyAtMs: readyAtMs(first),
          secondReadyAtMs: readyAtMs(candidate),
          nowMs: Date.now(),
          delayLimitSeconds: delayLimitMinutes * 60,
        })
        if (sequence) return { partner: candidate, sequence }
      }
      return null
    } catch (error) {
      this.logger.error(`Looking for a stack with delivery ${first.id} failed; offering it alone: ${error}`)
      return null
    }
  }

  // AC-3, cross check 12: the delivery found no free rider at its last matching attempt, that is, its newest
  // NO_COURIER_AVAILABLE is newer than its newest OFFERED (or it was never offered and has one since it was
  // created). The same reading recordNoCourierAvailable uses for a waiting spell.
  private async hadNoFreeRider(deliveryId: string): Promise<boolean> {
    const latest = await this.deliveryEventRepository.findLatestOfTypes(deliveryId, [
      EnumDeliveryEventType.OFFERED,
      EnumDeliveryEventType.NO_COURIER_AVAILABLE,
    ])
    return latest?.type === EnumDeliveryEventType.NO_COURIER_AVAILABLE
  }
}

// When the food is ready: the restaurant's tap, else its promise (as offer timing reads it, spec 0031).
function readyAtMs(delivery: { foodReadyAt: Date | null; readyAt: Date | null }): number | null {
  return (delivery.foodReadyAt ?? delivery.readyAt)?.getTime() ?? null
}
