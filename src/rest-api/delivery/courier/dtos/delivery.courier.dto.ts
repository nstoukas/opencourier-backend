import { ApiProperty } from '@nestjs/swagger'
import { EnumDeliverableAction, EnumDeliveryStatus, EnumUndeliverableAction, Prisma } from '@prisma/types'
import { DeliveryWithLocationsEntity } from 'src/domains/delivery/entities/delivery-with-locations.entity'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { LocationEntity } from 'src/domains/location/entities/location.entity'
import { OFFER_EXPIRY_GRACE_SECONDS } from 'src/constants'

const formatAddress = (address: LocationEntity) => {
  const { street, city, state } = address
  let formattedAddress = ''
  if (street) formattedAddress += `${street}, `
  if (city) formattedAddress += `${city}, `
  if (state) formattedAddress += state
  return formattedAddress
}


// Row 33 (wishlist item 17): riders call customers from their own phones, so the number reaches the
// app only while the rider holds the delivery. Every courier response and socket message is built
// through this DTO, so the rule holds everywhere at once.
const CUSTOMER_PHONE_VISIBLE_STATUSES: EnumDeliveryStatus[] = [
  EnumDeliveryStatus.ACCEPTED,
  EnumDeliveryStatus.DISPATCHED,
  EnumDeliveryStatus.COURIER_ARRIVED_AT_PICKUP_LOCATION,
  EnumDeliveryStatus.PICKED_UP,
  EnumDeliveryStatus.ON_THE_WAY,
  EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
]

export class DeliveryCourierDto implements Partial<DeliveryEntity> {
  @ApiProperty({ type: String })
  id!: string

  @ApiProperty({ type: String })
  pickupName: string

  @ApiProperty({ type: String })
  pickupPhoneNumber: string

  @ApiProperty({ type: String })
  pickupBusinessName: string

  @ApiProperty({ type: String, nullable: true })
  pickupNotes: string | null

  @ApiProperty({ type: String, nullable: true })
  pickupVerification: Prisma.JsonValue | null

  @ApiProperty({ type: String })
  pickupLocationId: string

  @ApiProperty({ type: Date })
  pickupReadyAt?: Date | null

  @ApiProperty({ type: Date })
  pickupDeadlineAt?: Date | null

  // Row 101: the customer's name, items and notes are sent only once this rider has accepted (the
  // phone's statuses, row 33), left out of the JSON in an offer and after the drop off. A rider who
  // declines never held them; the offer card shows none of them (spec 0019).
  @ApiProperty({ type: String, required: false })
  dropoffName?: string

  // The customer's number, only while this rider holds the delivery (row 33): from ACCEPTED until
  // they reach the drop off. Left out of the response (undefined, so not in the JSON at all) in an
  // offer and once it is dropped off, cancelled or failed.
  @ApiProperty({ type: String, required: false })
  dropoffPhoneNumber?: string

  @ApiProperty({ type: Object, nullable: true })
  dropoffBusinessName: string | null

  // Row 101: `dropoffNotes` holds the composed "Floor: · Doorbell:" line, and both notes are the
  // customer's instructions, so they follow the same rule as the floor and the doorbell.
  @ApiProperty({ type: String, nullable: true, required: false })
  dropoffNotes?: string | null

  @ApiProperty({ type: String, nullable: true, required: false })
  dropoffSellerNotes?: string | null

  // Spec 0016 (AC-7): the floor and the doorbell name are personal details like the customer's
  // phone, so they follow the same rule (row 33): sent only while the rider holds the delivery,
  // left out of the JSON otherwise.
  @ApiProperty({ type: String, nullable: true, required: false })
  dropoffFloor?: string | null

  @ApiProperty({ type: String, nullable: true, required: false })
  dropoffDoorbell?: string | null

  // Spec 0016 (AC-8): set once the rider moved the drop off pin; the app then hides the button.
  @ApiProperty({ type: Date, nullable: true })
  dropoffPointCorrectedAt: Date | null

  @ApiProperty({ type: Object, nullable: true })
  dropoffVerification: Prisma.JsonValue | null

  @ApiProperty({ type: Date })
  dropoffReadyAt?: Date | null

  @ApiProperty({ type: Date, nullable: true })
  dropoffEta: Date | null

  @ApiProperty({ type: Date })
  dropoffDeadlineAt?: Date | null

  @ApiProperty({ enum: EnumDeliverableAction })
  deliverableAction: EnumDeliverableAction

  @ApiProperty({ enum: EnumUndeliverableAction, nullable: true })
  undeliverableAction: EnumUndeliverableAction | null

  @ApiProperty({ type: String, nullable: true })
  undeliverableReason: string | null

  @ApiProperty({ type: String })
  dropoffLocationId: string

  @ApiProperty({ type: [String] })
  deliveryTypes: string[]

  @ApiProperty({ type: Boolean })
  requiresDropoffSignature: boolean

  @ApiProperty({ type: Boolean })
  requiresId: boolean

  @ApiProperty({ type: String, nullable: true })
  orderReference: string | null

  @ApiProperty({ type: Number, nullable: true })
  orderTotalValue: number | null

  @ApiProperty({ type: [Object], nullable: true, required: false })
  orderItems?: Prisma.JsonValue | null

  @ApiProperty({ enum: EnumDeliveryStatus })
  status: EnumDeliveryStatus

  @ApiProperty({ type: [String], required: false })
  customerNotes?: string[]

  @ApiProperty({ type: String })
  currencyCode: string

  @ApiProperty({ type: Number, nullable: true })
  totalCost: number | null

  @ApiProperty({ type: Number, nullable: true })
  fee: number | null

  @ApiProperty({ type: Number, nullable: true })
  pay: number | null

  @ApiProperty({ type: Number })
  tips: number

  @ApiProperty({ type: Number, nullable: true })
  totalCompensation: number | null

  @ApiProperty({ type: [String] })
  pickupTypes: string[]

  @ApiProperty({ type: String, nullable: true })
  imageType: string | null

  @ApiProperty({ type: String, nullable: true })
  imageName: string | null

  @ApiProperty({ type: Buffer, nullable: true })
  imageData: Buffer | null

  @ApiProperty({ type: String, nullable: true })
  idempotencyKey: string | null

  @ApiProperty({ type: String, nullable: true })
  externalStoreId: string | null

  @ApiProperty({ type: Object, nullable: true })
  returnVerification: Prisma.JsonValue | null

  @ApiProperty({ type: Object, nullable: true })
  externalUserInfo: Prisma.JsonValue | null

  @ApiProperty({ type: String, nullable: true })
  externalId: string | null

  @ApiProperty({ type: String, nullable: true })
  courierId: string | null

  @ApiProperty({ type: String, nullable: true })
  partnerId: string | null

  @ApiProperty({ type: String })
  deliveryQuoteId: string

  @ApiProperty({ type: String })
  customerName: string

  @ApiProperty({ type: String, nullable: true })
  customerPhoneNumber: string | null

  @ApiProperty({ type: Date })
  createdAt: Date

  // Spec 0002. When the offer to this rider went out, and when it ends on its own. offerExpiresAt
  // null means no countdown: expiry is off, or an admin made the offer.
  @ApiProperty({ type: Date, nullable: true })
  offeredAt: Date | null

  @ApiProperty({ type: Date, nullable: true })
  offerExpiresAt: Date | null

  // Spec 0020: until when the rider may hand this order back for free; null when they cannot.
  @ApiProperty({ type: Date, nullable: true })
  handBackUntil: Date | null

  @ApiProperty({ type: String, nullable: true })
  dropoffLocationFormattedAddress: string | null

  @ApiProperty({ type: String, nullable: true })
  pickupLocationFormattedAddress: string | null

  constructor(data: DeliveryEntity | DeliveryWithLocationsEntity) {
    this.id = data.id
    this.pickupName = data.pickupName
    this.pickupPhoneNumber = data.pickupPhoneNumber
    this.pickupBusinessName = data.pickupBusinessName
    this.pickupNotes = data.pickupNotes
    this.pickupVerification = data.pickupVerification
    this.pickupLocationId = data.pickupLocationId
    this.pickupReadyAt = data.pickupReadyAt
    this.pickupDeadlineAt = data.pickupDeadlineAt

    // Spec 0020 (AC-3): the end of the free hand back, while it is still ahead and the rider has not
    // reached the restaurant; null otherwise.
    const handBackUntil = data.handBackUntil ?? null
    const inHandBackWindow =
      handBackUntil !== null &&
      handBackUntil.getTime() > Date.now() &&
      (data.status === EnumDeliveryStatus.ACCEPTED || data.status === EnumDeliveryStatus.DISPATCHED)
    this.handBackUntil = inHandBackWindow ? handBackUntil : null
    // The details stay hidden through the hand back's grace too (row 71 review): the server still
    // takes a hand back for OFFER_EXPIRY_GRACE_SECONDS after handBackUntil, so a rider who fetched
    // in those seconds could otherwise read them and still give the order back.
    const inHandBackGrace =
      handBackUntil !== null &&
      handBackUntil.getTime() + OFFER_EXPIRY_GRACE_SECONDS * 1000 > Date.now() &&
      (data.status === EnumDeliveryStatus.ACCEPTED || data.status === EnumDeliveryStatus.DISPATCHED)
    // Row 33 and spec 0016: the customer's details only while the rider holds the delivery. Spec 0020
    // (AC-4, decision 71.10): not during the free hand back either, so a rider who gives the order back
    // has not been given the customer's phone, floor or doorbell.
    const holdsDelivery = CUSTOMER_PHONE_VISIBLE_STATUSES.includes(data.status) && !inHandBackGrace
    this.dropoffPhoneNumber = holdsDelivery ? data.dropoffPhoneNumber : undefined
    this.dropoffBusinessName = data.dropoffBusinessName
    // Row 101 (decisions 101.1, 101.2): the customer's name, items and notes once the rider has
    // accepted, never in an offer or after the drop off. Unlike the phone, floor and doorbell they are
    // sent during the free hand back too (decision 71.12 keeps the item list there): the app hides the
    // name on that card, and nothing refetches when the window closes, so withholding them would leave
    // the pickup card without the bag label and the items.
    const accepted = CUSTOMER_PHONE_VISIBLE_STATUSES.includes(data.status)
    this.dropoffName = accepted ? data.dropoffName : undefined
    this.dropoffNotes = accepted ? data.dropoffNotes : undefined
    this.dropoffSellerNotes = accepted ? data.dropoffSellerNotes : undefined
    this.dropoffFloor = holdsDelivery ? data.dropoffFloor : undefined
    this.dropoffDoorbell = holdsDelivery ? data.dropoffDoorbell : undefined
    this.dropoffPointCorrectedAt = data.dropoffPointCorrectedAt
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
    this.orderItems = accepted ? data.orderItems : undefined
    this.status = data.status
    this.customerNotes = accepted ? data.customerNotes : undefined
    this.currencyCode = data.currencyCode
    this.totalCost = data.totalCost
    this.fee = data.fee
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

    this.createdAt = data.createdAt
    this.offeredAt = data.offeredAt
    this.offerExpiresAt = data.offerExpiresAt

    if ('pickupLocation' in data && data.pickupLocation) {
      this.pickupLocationFormattedAddress = formatAddress(data.pickupLocation)
    }

    if ('dropoffLocation' in data && data.dropoffLocation) {
      this.dropoffLocationFormattedAddress = formatAddress(data.dropoffLocation)
    }
  }
}
