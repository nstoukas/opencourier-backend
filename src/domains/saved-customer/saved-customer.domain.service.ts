import { Injectable, Logger } from '@nestjs/common'
import { SavedCustomer } from '@prisma/types'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { NotFoundException, SavedCustomerPhoneClashException, SavedCustomerRefusedException } from 'src/errors'
import { SavedCustomerFields, SavedCustomerRepository } from 'src/persistence/repositories/saved-customer.repository'
import { isUniqueConstraintError } from 'src/prisma.util'
import { isPositionInRegion } from 'src/utils/geoJsonUtils'
import { normalisePhone } from 'src/utils/phone'

// What a caller sends for a saved customer, before it is checked. Optional texts may be left out,
// sent empty or sent null; empty and null both store as "none".
export type SavedCustomerInput = {
  name: string
  phone: string
  notes?: string | null
  addressLine1: string
  addressLine2?: string | null
  city: string
  zipCode?: string | null
  latitude: number
  longitude: number
  formattedAddress?: string | null
}

// What to do when the restaurant already has a customer with this phone: `refuse` (adding one by
// hand on the Customers page) or `update` (saving from an order, AC-1).
export type PhoneClashRule = 'refuse' | 'update'

export const OUTSIDE_SERVICE_AREA_MESSAGE = 'This address is outside the area the co-op serves'
export const INVALID_PHONE_MESSAGE = 'This phone number does not look right'

// A restaurant's saved customers (spec 0005). Personal data, so three rules hold everywhere here:
// the restaurant always comes from the login (never from the request), every read and write is
// scoped to it, and no name, phone or address ever goes into a log line or an error message (AC-9).
@Injectable()
export class SavedCustomerDomainService {
  private readonly logger = new Logger(SavedCustomerDomainService.name)

  constructor(
    private readonly savedCustomerRepository: SavedCustomerRepository,
    private readonly configDomainService: ConfigDomainService
  ) {}

  async list(partnerId: string, search: string | null, page: number, perPage: number) {
    return this.savedCustomerRepository.list(partnerId, search, page, perPage)
  }

  // Adds a customer, or with `update` saves over the one with the same phone. `markUsed` (an order
  // just used it) moves its last used date to now; a refused save touches nothing.
  async create(
    partnerId: string,
    input: SavedCustomerInput,
    onPhoneClash: PhoneClashRule,
    markUsed: boolean
  ): Promise<{ customer: SavedCustomer; created: boolean }> {
    const fields = await this.checkAll(input)

    if (onPhoneClash === 'update') {
      return this.savedCustomerRepository.upsertByPhone(partnerId, fields, markUsed)
    }

    // A new row's lastUsedAt starts at now, so `markUsed` needs nothing more here.
    try {
      const customer = await this.savedCustomerRepository.create(partnerId, fields)
      return { customer, created: true }
    } catch (error) {
      throw await this.phoneClashOr(error, partnerId, fields.phone)
    }
  }

  // Changes the fields sent (left out = unchanged). The phone may change, but not to another
  // customer's phone (AC-4). 404 when the id is not this restaurant's (AC-5).
  async update(
    partnerId: string,
    id: string,
    input: Partial<SavedCustomerInput>,
    markUsed: boolean
  ): Promise<SavedCustomer> {
    const existing = await this.savedCustomerRepository.findOwned(partnerId, id)
    if (!existing) {
      throw new NotFoundException('Saved customer not found')
    }

    const fields: Partial<SavedCustomerFields> = {}
    if (input.name !== undefined) fields.name = this.checkRequiredText(input.name, 'name')
    if (input.phone !== undefined) fields.phone = this.checkPhone(input.phone)
    if (input.notes !== undefined) fields.notes = optionalText(input.notes)
    if (input.addressLine1 !== undefined) fields.addressLine1 = this.checkRequiredText(input.addressLine1, 'street')
    if (input.addressLine2 !== undefined) fields.addressLine2 = optionalText(input.addressLine2)
    if (input.city !== undefined) fields.city = this.checkRequiredText(input.city, 'city')
    if (input.zipCode !== undefined) fields.zipCode = optionalText(input.zipCode)
    if (input.formattedAddress !== undefined) fields.formattedAddress = optionalText(input.formattedAddress)
    if (input.latitude !== undefined || input.longitude !== undefined) {
      // A point moved by half is still a point: check where the customer ends up.
      const latitude = input.latitude ?? existing.latitude
      const longitude = input.longitude ?? existing.longitude
      await this.checkInsideServiceArea(latitude, longitude)
      fields.latitude = latitude
      fields.longitude = longitude
    }

    let updated: SavedCustomer | null
    try {
      updated = await this.savedCustomerRepository.update(partnerId, id, fields, markUsed)
    } catch (error) {
      throw await this.phoneClashOr(error, partnerId, fields.phone)
    }
    // Deleted between the read above and the write.
    if (!updated) {
      throw new NotFoundException('Saved customer not found')
    }
    return updated
  }

  // An order used this customer without saving its details again (AC-3, the tick off).
  async markUsed(partnerId: string, id: string): Promise<void> {
    const found = await this.savedCustomerRepository.markUsed(partnerId, id)
    if (!found) {
      throw new NotFoundException('Saved customer not found')
    }
  }

  async delete(partnerId: string, id: string): Promise<void> {
    const found = await this.savedCustomerRepository.delete(partnerId, id)
    if (!found) {
      throw new NotFoundException('Saved customer not found')
    }
  }

  // An admin's edit and delete (AC-6), logged by ids only: who, which restaurant, which customer.
  async updateAsAdmin(
    adminUserId: string,
    partnerId: string,
    id: string,
    input: Partial<SavedCustomerInput>
  ): Promise<SavedCustomer> {
    // An admin edit is a correction, not an order, so it never counts as use.
    const customer = await this.update(partnerId, id, input, false)
    this.logger.log(`Admin user ${adminUserId} edited saved customer ${id} of restaurant ${partnerId}`)
    return customer
  }

  async deleteAsAdmin(adminUserId: string, partnerId: string, id: string): Promise<void> {
    await this.delete(partnerId, id)
    this.logger.log(`Admin user ${adminUserId} deleted saved customer ${id} of restaurant ${partnerId}`)
  }

  // The daily retention job (AC-7). Logs only how many it deleted.
  async deleteUnused(): Promise<number> {
    const months = await this.configDomainService.instanceConfig.getSavedCustomerRetentionMonths()
    const deleted = await this.savedCustomerRepository.deleteUnusedForMonths(months)
    this.logger.log(`Saved customer retention (${months} months): deleted ${deleted}`)
    return deleted
  }

  private async checkAll(input: SavedCustomerInput): Promise<SavedCustomerFields> {
    const fields: SavedCustomerFields = {
      name: this.checkRequiredText(input.name, 'name'),
      phone: this.checkPhone(input.phone),
      notes: optionalText(input.notes),
      addressLine1: this.checkRequiredText(input.addressLine1, 'street'),
      addressLine2: optionalText(input.addressLine2),
      city: this.checkRequiredText(input.city, 'city'),
      zipCode: optionalText(input.zipCode),
      latitude: input.latitude,
      longitude: input.longitude,
      formattedAddress: optionalText(input.formattedAddress),
    }
    await this.checkInsideServiceArea(fields.latitude, fields.longitude)
    return fields
  }

  private checkRequiredText(value: string, what: string): string {
    const trimmed = value.trim()
    if (trimmed === '') {
      throw new SavedCustomerRefusedException(`The customer's ${what} cannot be empty`)
    }
    return trimmed
  }

  private checkPhone(value: string): string {
    const phone = normalisePhone(value)
    if (phone === null) {
      throw new SavedCustomerRefusedException(INVALID_PHONE_MESSAGE)
    }
    return phone
  }

  // The same region test quotes use, so a saved customer never fails later at quote time (AC-10).
  private async checkInsideServiceArea(latitude: number, longitude: number): Promise<void> {
    const details = await this.configDomainService.instanceConfig.getDetails()
    const inside = isPositionInRegion(details.region, { latitude, longitude }, (type) =>
      this.logger.warn(`Unsupported region type in instance config: ${type}`)
    )
    if (!inside) {
      throw new SavedCustomerRefusedException(OUTSIDE_SERVICE_AREA_MESSAGE)
    }
  }

  // A unique error on (partnerId, phone) becomes the 409 that names the other customer by id.
  // Anything else is returned unchanged, for the caller to throw.
  private async phoneClashOr(error: unknown, partnerId: string, phone: string | undefined): Promise<unknown> {
    if (phone !== undefined && error instanceof Error && isUniqueConstraintError(error)) {
      const conflictingCustomerId = await this.savedCustomerRepository.findIdByPhone(partnerId, phone)
      if (conflictingCustomerId !== null) {
        return new SavedCustomerPhoneClashException(conflictingCustomerId)
      }
    }
    return error
  }
}

// Trimmed text, or null when nothing is left (or nothing was sent).
function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}
