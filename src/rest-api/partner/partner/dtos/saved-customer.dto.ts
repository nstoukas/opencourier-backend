import { ApiProperty } from '@nestjs/swagger'
import { SavedCustomer } from '@prisma/types'

// One saved customer as the restaurant and the admin see it (spec 0005): every stored field except
// partnerId, which the caller already knows.
export class SavedCustomerDto {
  @ApiProperty() id: string
  @ApiProperty() name: string
  @ApiProperty({ description: 'E.164, e.g. +306912345678' }) phone: string
  @ApiProperty({ type: String, nullable: true }) notes: string | null
  @ApiProperty() addressLine1: string
  @ApiProperty({ type: String, nullable: true }) addressLine2: string | null
  // Spec 0016: the floor and the name on the doorbell.
  @ApiProperty({ type: String, nullable: true }) floor: string | null
  @ApiProperty({ type: String, nullable: true }) doorbell: string | null
  @ApiProperty() city: string
  @ApiProperty({ type: String, nullable: true }) zipCode: string | null
  @ApiProperty() latitude: number
  @ApiProperty() longitude: number
  @ApiProperty({ type: String, nullable: true }) formattedAddress: string | null
  @ApiProperty() lastUsedAt: Date
  // Row 99: when a rider last moved this customer's pin, or null.
  @ApiProperty({ type: Date, nullable: true }) pinMovedByRiderAt: Date | null
  @ApiProperty() createdAt: Date
  @ApiProperty() updatedAt: Date

  constructor(customer: SavedCustomer) {
    this.id = customer.id
    this.name = customer.name
    this.phone = customer.phone
    this.notes = customer.notes
    this.addressLine1 = customer.addressLine1
    this.addressLine2 = customer.addressLine2
    this.floor = customer.floor
    this.doorbell = customer.doorbell
    this.city = customer.city
    this.zipCode = customer.zipCode
    this.latitude = customer.latitude
    this.longitude = customer.longitude
    this.formattedAddress = customer.formattedAddress
    this.lastUsedAt = customer.lastUsedAt
    this.pinMovedByRiderAt = customer.pinMovedByRiderAt ?? null
    this.createdAt = customer.createdAt
    this.updatedAt = customer.updatedAt
  }
}

export class SavedCustomerListDto {
  @ApiProperty({ type: () => [SavedCustomerDto] }) items: SavedCustomerDto[]
  @ApiProperty({ description: 'How many match the search (all of them without one)' }) total: number

  constructor(data: { items: SavedCustomer[]; total: number }) {
    this.items = data.items.map((customer) => new SavedCustomerDto(customer))
    this.total = data.total
  }
}

export class SavedCustomerResultDto {
  @ApiProperty({ type: () => SavedCustomerDto }) customer: SavedCustomerDto

  constructor(customer: SavedCustomer) {
    this.customer = new SavedCustomerDto(customer)
  }
}

export class SavedCustomerSaveResultDto extends SavedCustomerResultDto {
  @ApiProperty({ description: 'True when a new customer was made, false when one with this phone was updated' })
  created: boolean

  constructor(data: { customer: SavedCustomer; created: boolean }) {
    super(data.customer)
    this.created = data.created
  }
}
