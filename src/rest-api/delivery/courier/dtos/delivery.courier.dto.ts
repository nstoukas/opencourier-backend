import { ApiProperty } from '@nestjs/swagger'
import { EnumDeliverableAction, EnumDeliveryStatus, EnumUndeliverableAction, Prisma } from '@prisma/types'
import { DeliveryWithLocationsEntity } from 'src/domains/delivery/entities/delivery-with-locations.entity'
import { DeliveryEntity } from 'src/domains/delivery/entities/delivery.entity'
import { LocationEntity } from 'src/domains/location/entities/location.entity'

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

  @ApiProperty({ type: String })
  dropoffName: string

  // The customer's number, only while this rider holds the delivery (row 33): from ACCEPTED until
  // they reach the drop off. Left out of the response (undefined, so not in the JSON at all) in an
  // offer and once it is dropped off, cancelled or failed.
  @ApiProperty({ type: String, required: false })
  dropoffPhoneNumber?: string

  @ApiProperty({ type: Object, nullable: true })
  dropoffBusinessName: string | null

  @ApiProperty({ type: String, nullable: true })
  dropoffNotes: string | null

  @ApiProperty({ type: String, nullable: true })
  dropoffSellerNotes: string | null

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

  @ApiProperty({ type: [Object], nullable: true })
  orderItems: Prisma.JsonValue | null

  @ApiProperty({ enum: EnumDeliveryStatus })
  status: EnumDeliveryStatus

  @ApiProperty({ type: [String] })
  customerNotes: string[]

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

    this.dropoffName = data.dropoffName
    this.dropoffPhoneNumber = CUSTOMER_PHONE_VISIBLE_STATUSES.includes(data.status) ? data.dropoffPhoneNumber : undefined
    this.dropoffBusinessName = data.dropoffBusinessName
    this.dropoffNotes = data.dropoffNotes
    this.dropoffSellerNotes = data.dropoffSellerNotes
    const holdsDelivery = CUSTOMER_PHONE_VISIBLE_STATUSES.includes(data.status)
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
    this.orderItems = data.orderItems
    this.status = data.status
    this.customerNotes = data.customerNotes
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
