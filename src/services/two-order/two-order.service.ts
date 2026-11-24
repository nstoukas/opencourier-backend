import { Injectable, Logger } from '@nestjs/common'
import { EnumDeliveryEventType, EnumDeliveryStatus } from '@prisma/types'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { RIDER_BOX_UNITS } from 'src/domains/delivery/box'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { StackSequence, bestStackSequence, isSameRestaurant, stackPairBlockKey, stackRefusal } from 'src/domains/delivery/stack'
import { EnumCourierMatcherType } from 'src/shared-types/courier-matching'
import { GeoPosition } from 'src/shared-types'
import {
  AddOnSequence,
  addOnJobStatuses,
  addOnMomentAllows,
  addOnRefusal,
  bestAddOnSequence,
  isCarryingFood,
} from 'src/domains/delivery/add-on'
import { OfferReasonStrategy } from 'src/domains/matching/offer-reason'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import { DeliveryEventRepository } from 'src/persistence/repositories/delivery-event.repository'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { CacheService } from 'src/services/cache/cache.service'
import { CacheHelpers } from 'src/services/cache/cache.helpers'
import { OsrmRoutingService } from 'src/services/osrm/osrm-routing.service'
import { EnumAddOnMoment, EnumTwoOrderPolicy } from 'src/shared-types/stacking'
import { errorSummaryForLog } from 'src/utils/errorForLog'

// How many waiting orders are tried as the second order of a stack, the longest waiting first. Each one
// costs one road table, so the offer is never held up by a long list.
const STACK_CANDIDATE_LIMIT = 5

// Row 81 (cross check 3): how many riders on a job are compared for an add on, the nearest first. The same
// reason as above: each one costs a road table.
const ADD_ON_CANDIDATE_LIMIT = 5

// A stack ready to be offered: the second delivery and the order of the four stops (spec 0048, AC-4).
export interface StackPlan {
  partner: DeliveryEntity
  sequence: StackSequence
}

// Row 81: an add on ready to be offered: the rider on a job, that job, the stop order through both jobs
// and what it adds (AC-6), whether the rider carries food already (cross check 2: a calm offer then), how
// many riders were compared, and the co-op's matcher setting the reason records.
export interface AddOnPlan {
  courierId: string
  job: DeliveryEntity
  sequence: AddOnSequence
  carryingFood: boolean
  candidateCount: number
  strategy: OfferReasonStrategy
  // Review fix (value 1): the policy in force and whether the usual query found a free rider, so the
  // record says why the add on went to a rider on a job (under WHENEVER_FITS it can go before a free one).
  policy: EnumTwoOrderPolicy
  freeRiderFound: boolean
  // Review fix: the job statuses the co-op's moment allows, checked again under the lock at the claim.
  jobStatuses: EnumDeliveryStatus[]
}

// Spec 0048 (Decision): the pairing logic, beside the matcher. DeliveryEventService asks it, once the
// matcher has chosen a free rider for a delivery, whether a second waiting delivery should go to the same
// rider in one offer. It reads and decides; it writes nothing (the claim does, under the rider's lock).
// Orders of the same restaurant (slice 1), or of two restaurants when both are marked ready (slice 2).
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

      const riderAt = await this.courierRepository.getCurrentLocation(courierId)
      if (!riderAt) return null
      // Cross check 4: the second order's pickup must be within the co-op's distance of the rider, as for
      // any offer of it (the setting is in km; null means no limit).
      const maxKm = await config.getMaxAssignmentDistance()
      const candidates = await this.deliveryRepository.findStackPartnerCandidates(first, room, STACK_CANDIDATE_LIMIT, {
        rider: riderAt,
        maxMetres: maxKm ? maxKm * 1000 : null,
      })
      if (candidates.length === 0) return null
      const firstPlaces = await this.deliveryRepository.findByIdOrThrowWithLocations(first.id)
      if (!firstPlaces.pickupLocation || !firstPlaces.dropoffLocation) return null

      for (const candidate of candidates) {
        const refusal = stackRefusal(first, candidate)
        if (refusal) continue
        // Cross check 9: the two were stacked, and the stack was declined or missed, within the co-op's stackPairBlockMinutes (row 147).
        if (await this.cacheService.get<boolean>(stackPairBlockKey(first.id, candidate.id))) continue
        // Cross check 4: the second order's own filters apply to the rider. Its skip list here; its distance
        // from the rider in the candidate query above.
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
      this.logger.error(
        `Looking for a stack with delivery ${first.id} failed; offering it alone: ${errorSummaryForLog(error)}`
      )
      return null
    }
  }

  // Row 81 (AC-6, AC-3, cross check 3): the rider on a job who should be offered `delivery` as one more order
  // on the way, or null. `freeRiderFound`: the usual candidate query found a free rider. Under SHORTAGE_ONLY
  // an add on is looked for only when it did not; under WHENEVER_FITS at every matching, and a fitting add on
  // then goes before the free rider (decision 81.3). `isDue`: whether the offer would go out now for that
  // rider, given the seconds until they reach the pickup through both jobs and the pickup itself (timed
  // offers, spec 0031). The winner adds the fewest whole minutes; a tie goes to the shorter road time to the
  // new pickup. Never throws: anything it cannot read means no add on, and the delivery goes on exactly as
  // without add ons. Never under the STATIC matcher (review fix, below).
  async findAddOn(
    delivery: DeliveryEntity,
    freeRiderFound: boolean,
    isDue: (courierId: string, secondsToPickup: number, pickupLocation: GeoPosition) => Promise<boolean>
  ): Promise<AddOnPlan | null> {
    try {
      const config = this.configDomainService.instanceConfig
      if (!(await config.getAddOnOffersEnabled())) return null
      const [policy, delayLimitMinutes, moment, maxKm, strategy] = await Promise.all([
        config.getTwoOrderPolicy(),
        config.getTwoOrderDelayLimitMinutes(),
        config.getAddOnMoment(),
        config.getMaxAssignmentDistanceInKM(),
        config.getCourierMatcherTypeSetting(),
      ])
      // Review fix (AGENTS.md, locked: "STATIC matcher = the override"): while the matcher setting is STATIC,
      // every order goes to the rider the admin named, and nobody else, exactly as an ordinary offer does. An
      // add on would send it to some other rider on a job (under WHENEVER_FITS, or when the named rider is in
      // an SOS), so there is none.
      if (strategy === EnumCourierMatcherType.STATIC) return null
      if (freeRiderFound && policy === EnumTwoOrderPolicy.SHORTAGE_ONLY) return null
      const jobStatuses = addOnJobStatuses(moment)

      // agy review: under SAME_RESTAURANT only a job from this order's restaurant counts, so the query asks for
      // those jobs only (a rider on another restaurant's job never takes one of the five places). An order with
      // no restaurant can never be "the same restaurant" (isSameRestaurant), so there is no add on for it.
      const sameRestaurant = moment === EnumAddOnMoment.SAME_RESTAURANT
      if (sameRestaurant && !delivery.partnerId) return null

      const places = await this.deliveryRepository.findByIdOrThrowWithLocations(delivery.id)
      if (!places.pickupLocation || !places.dropoffLocation) return null
      // The delivery's own filters apply to the rider, as for any offer of it: its skip list, its distance.
      const skipped = await this.cacheService.getOrDefault<string[]>(CacheHelpers.getDeliveryRejectedCouriersKey(delivery.id), [])
      const candidates = await this.courierRepository.findAddOnCandidates(
        {
          location: places.pickupLocation,
          maxDistanceInKM: maxKm,
          excludeCourierIds: skipped,
          boxUnits: delivery.boxUnits,
          siblingOfDeliveryId: delivery.id,
          // `undefined` (left out) for the other two moments, where any restaurant's job may qualify.
          sameRestaurantAs:
            sameRestaurant && delivery.partnerId
              ? { partnerId: delivery.partnerId, pickupLocationId: delivery.pickupLocationId }
              : undefined,
        },
        ADD_ON_CANDIDATE_LIMIT,
        jobStatuses
      )

      const plans: AddOnPlan[] = []
      for (const candidate of candidates) {
        const job = await this.deliveryRepository.findByIdOrThrowWithLocations(candidate.jobId)
        if (!job.pickupLocation || !job.dropoffLocation) continue
        if (!addOnMomentAllows(moment, job.status, isSameRestaurant(job, delivery))) continue
        const carryingFood = isCarryingFood(job.status)
        if (addOnRefusal(job, delivery, carryingFood)) continue

        let table: { seconds: (number | null)[][]; metres: (number | null)[][] }
        try {
          table = await this.osrmRoutingService.getDurationAndDistanceMatrix([
            candidate.courierLocation,
            job.pickupLocation,
            places.pickupLocation,
            job.dropoffLocation,
            places.dropoffLocation,
          ])
        } catch (error) {
          // Cross check 5: with OSRM down, no add on is offered at all.
          this.logger.warn(`No road times for an add on of delivery ${delivery.id}; no add on`)
          return null
        }
        const sequence = bestAddOnSequence({
          currentId: job.id,
          newId: delivery.id,
          seconds: table.seconds,
          metres: table.metres,
          currentPickedUp: carryingFood,
          currentReadyAtMs: readyAtMs(job),
          newReadyAtMs: readyAtMs(delivery),
          nowMs: Date.now(),
          delayLimitSeconds: delayLimitMinutes * 60,
        })
        if (!sequence) continue
        if (!(await isDue(candidate.courierId, sequence.secondsToNewPickup, places.pickupLocation))) continue
        plans.push({
          courierId: candidate.courierId,
          job,
          sequence,
          carryingFood,
          candidateCount: candidates.length,
          strategy,
          policy,
          freeRiderFound,
          jobStatuses,
        })
      }
      if (plans.length === 0) return null

      // Cross check 3: the fewest extra minutes wins (whole minutes, as the rider reads them), then the shorter
      // road time to the new pickup: the factor every automatic matcher weighs (decision 81.4). In the compare
      // below, `x || y` means: when the minutes differ (x is not 0), they decide; when they are equal, x is 0
      // and the road time y decides.
      plans.sort(
        (a, b) =>
          Math.round(a.sequence.extraSeconds / 60) - Math.round(b.sequence.extraSeconds / 60) ||
          a.sequence.secondsToNewPickup - b.sequence.secondsToNewPickup
      )
      return plans[0] ?? null
    } catch (error) {
      this.logger.error(
        `Looking for an add on of delivery ${delivery.id} failed; no add on: ${errorSummaryForLog(error)}`
      )
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
