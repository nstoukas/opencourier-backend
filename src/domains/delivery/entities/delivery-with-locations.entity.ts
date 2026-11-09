import {
  EnumDeliveryStatus,
  EnumCancelledBy,
  EnumFoodOutcome,
  Delivery,
  Prisma,
  EnumUndeliverableAction,
  EnumDeliverableAction,
  Location,
} from '@prisma/types'
import { LocationEntity } from 'src/domains/location/entities/location.entity'

export class DeliveryWithLocationsEntity implements Delivery {
  id: string
  pickupName: string
  pickupPhoneNumber: string
  pickupBusinessName: string
  pickupNotes: string | null
  pickupVerification: Prisma.JsonValue | null
  pickupLocationId: string
  pickupReadyAt: Date | null
  pickupDeadlineAt: Date | null
  dropoffName: string
  dropoffPhoneNumber: string
  dropoffBusinessName: string | null
  dropoffNotes: string | null
  dropoffSellerNotes: string | null
  dropoffFloor: string | null
  dropoffDoorbell: string | null
  dropoffPointCorrectedAt: Date | null
  // Spec 0020: when the rider accepted, and the end of the free hand back.
  acceptedAt: Date | null
  // Spec 0033: the first promise, the rider's arrival, leaving after a wait, and an owed wait.
  promisedReadyAt: Date | null
  arrivedAtPickupAt: Date | null
  undispatchedAt: Date | null
  waitPayOwedAt: Date | null
  handBackUntil: Date | null
  // Spec 0023: the restaurant's ready promise, and when it marked the food ready.
  readyAt: Date | null
  foodReadyAt: Date | null
  dropoffVerification: Prisma.JsonValue | null
  dropoffReadyAt: Date | null
  dropoffEta: Date | null
  dropoffDeadlineAt: Date | null
  deliverableAction: EnumDeliverableAction
  undeliverableAction: EnumUndeliverableAction | null
  undeliverableReason: string | null
  dropoffLocationId: string
  deliveryTypes: string[]
  requiresDropoffSignature: boolean
  requiresId: boolean
  orderReference: string | null
  orderTotalValue: number | null
  orderItems: Prisma.JsonValue | null
  status: EnumDeliveryStatus
  customerNotes: string[]
  currencyCode: string
  totalCost: number | null
  fee: number | null
  feePercentage: number | null
  pay: number | null
  tips: number
  totalCompensation: number | null
  pickupTypes: string[]
  imageType: string | null
  imageName: string | null
  imageData: Buffer | null
  idempotencyKey: string | null
  externalStoreId: string | null
  returnVerification: Prisma.JsonValue | null
  externalUserInfo: Prisma.JsonValue | null
  externalId: string | null
  courierId: string | null
  partnerId: string | null
  deliveryQuoteId: string

  rejectedByCouriers: string[]
  matchedCourierId: string | null
  // The open offer's start and end (spec 0002); null when there is no open offer, or it never expires.
  offeredAt: Date | null
  offerExpiresAt: Date | null
  // A cancellation and the food outcome after it (spec 0015).
  cancelledBy: EnumCancelledBy | null
  cancelledFromStatus: EnumDeliveryStatus | null
  cancelledAt: Date | null
  // The cancelled job pay rule in force when it was cancelled (decision 32.18).
  cancellationPayoutPolicy: string | null
  foodOutcome: EnumFoodOutcome | null
  foodOutcomeAt: Date | null

  pickupLocation: LocationEntity | null
  dropoffLocation: LocationEntity | null

  // Spec 0025: the admin search's folded copy of the searched fields. Declared because the Prisma
  // model has it, never copied from the row: folded personal data stops at the repository.
  // `declare` emits nothing at runtime, so a serialised entity (the partner webhook posts whole
  // entities) never gains a "searchFold" key (row 98 review, decision 98.3).
  declare searchFold: string | null

  createdAt: Date
  updatedAt: Date

  // Omit: the entity never reads searchFold (spec 0025), so callers need not have it.
  constructor(data: Omit<Delivery, 'searchFold'> & { pickupLocation: Location | null; dropoffLocation: Location | null }) {
    this.id = data.id
    this.pickupName = data.pickupName
    this.pickupPhoneNumber = data.pickupPhoneNumber
    this.pickupBusinessName = data.pickupBusinessName
    this.pickupNotes = data.pickupNotes
    this.pickupVerification = data.pickupVerification
    this.pickupLocationId = data.pickupLocationId
    this.pickupReadyAt = data.pickupReadyAt
    this.pickupDeadlineAt = data.pickupDeadlineAt

    this.pickupLocation = data.pickupLocation ? new LocationEntity(data.pickupLocation) : null
    this.dropoffLocation = data.dropoffLocation ? new LocationEntity(data.dropoffLocation) : null

    this.dropoffName = data.dropoffName
    this.dropoffPhoneNumber = data.dropoffPhoneNumber
    this.dropoffBusinessName = data.dropoffBusinessName
    this.dropoffNotes = data.dropoffNotes
    this.dropoffSellerNotes = data.dropoffSellerNotes
    this.dropoffFloor = data.dropoffFloor
    this.dropoffDoorbell = data.dropoffDoorbell
    this.dropoffPointCorrectedAt = data.dropoffPointCorrectedAt
    this.acceptedAt = data.acceptedAt
    this.promisedReadyAt = data.promisedReadyAt
    this.arrivedAtPickupAt = data.arrivedAtPickupAt
    this.undispatchedAt = data.undispatchedAt
    this.waitPayOwedAt = data.waitPayOwedAt
    this.handBackUntil = data.handBackUntil
    this.readyAt = data.readyAt
    this.foodReadyAt = data.foodReadyAt
    this.dropoffVerification = data.dropoffVerification
    this.dropoffReadyAt = data.dropoffReadyAt
    this.dropoffEta = data.dropoffEta
    this.dropoffDeadlineAt = data.dropoffDeadlineAt

    this.deliverableAction = data.deliverableAction
    this.undeliverableAction = data.undeliverableAction
    this.undeliverableReason = data.undeliverableReason
    this.dropoffLocationId = data.dropoffLocationId
    this.deliveryTypes = data.deliveryTypes
    this.requiresDropoffSignature = data.requiresDropoffSignature
    this.requiresId = data.requiresId
    this.orderReference = data.orderReference
    this.orderTotalValue = data.orderTotalValue
    this.orderItems = data.orderItems
    this.status = data.status
    this.customerNotes = data.customerNotes
    this.currencyCode = data.currencyCode
    this.totalCost = data.totalCost
    this.fee = data.fee
    this.feePercentage = data.feePercentage
    this.pay = data.pay
    this.tips = data.tips
    this.totalCompensation = data.totalCompensation
    this.pickupTypes = data.pickupTypes
    this.imageType = data.imageType
    this.imageName = data.imageName
    this.imageData = data.imageData
    this.idempotencyKey = data.idempotencyKey
    this.externalStoreId = data.externalStoreId
    this.returnVerification = data.returnVerification
    this.externalUserInfo = data.externalUserInfo
    this.externalId = data.externalId
    this.courierId = data.courierId
    this.partnerId = data.partnerId
    this.deliveryQuoteId = data.deliveryQuoteId
    this.rejectedByCouriers = data.rejectedByCouriers
    this.matchedCourierId = data.matchedCourierId
    this.offeredAt = data.offeredAt
    this.offerExpiresAt = data.offerExpiresAt
    this.cancelledBy = data.cancelledBy
    this.cancelledFromStatus = data.cancelledFromStatus
    this.cancelledAt = data.cancelledAt
    this.cancellationPayoutPolicy = data.cancellationPayoutPolicy
    this.foodOutcome = data.foodOutcome
    this.foodOutcomeAt = data.foodOutcomeAt

    this.createdAt = data.createdAt
    this.updatedAt = data.updatedAt
  }
}
