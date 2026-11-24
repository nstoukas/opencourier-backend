import { EnumUserRole } from '@prisma/types'
import { Injectable, Logger } from '@nestjs/common'
import * as errors from 'src/errors'
import { hashApiKey, makeApiKey } from 'src/domains/auth/api-key'
import { PasswordService } from 'src/domains/auth/password.service'
import { LocationDomainService } from 'src/domains/location/location.domain.service'
import { ILocationCreate } from 'src/domains/location/interfaces/ILocationCreate'
import { LocationEntity } from 'src/domains/location/entities/location.entity'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { IPartnerUpdate } from 'src/domains/partner/interfaces/IPartnerRepository'
import { PartnerDomainService } from 'src/domains/partner/partner.domain.service'
import { UserDomainService } from 'src/domains/user/user.domain.service'
import { PartnerCreateAdminInput } from './queries/partner-create.admin.input'
import { PartnerUpdateAdminInput } from './queries/partner-update.admin.input'
import { PickupAddressAdminInput } from './queries/pickup-address.admin.input'

@Injectable()
export class PartnerAdminRestApiService {
  private readonly logger = new Logger(PartnerAdminRestApiService.name)

  constructor(
    private partnerDomainService: PartnerDomainService,
    private locationDomainService: LocationDomainService,
    private userDomainService: UserDomainService,
    private passwordService: PasswordService,
  ) {}

  async createRestaurant(input: PartnerCreateAdminInput): Promise<PartnerEntity> {
    const email = input.email.trim().toLowerCase()
    const userExists = await this.userDomainService.findUserWithEmail(email)
    if (userExists) {
      throw new errors.UserExistsException('A partner with this email already exists')
    }

    const hashedPassword = await this.passwordService.hash(input.password)
    // Spec 0037, AC-8: a new restaurant has no API key until an admin makes one.

    let locationId: string | null = null
    if (input.pickupAddress) {
      const location = await this.locationDomainService.create(this.toLocationCreate(input.pickupAddress))
      locationId = location.id
    }

    return this.partnerDomainService.createWithLogin({
      name: input.name.trim(),
      phoneNumber: input.phoneNumber ?? null,
      pickupLocationId: locationId,
      // `?? undefined`: a null from the client counts as not sent, since the column cannot hold null.
      usualPrepMinutes: input.usualPrepMinutes ?? undefined,
      login: {
        email,
        hashedPassword,
      },
    })
  }

  async updateRestaurant(partnerId: string, input: PartnerUpdateAdminInput): Promise<PartnerEntity> {
    const partner = await this.partnerDomainService.getByIdOrThrow(partnerId)
    let pickupLocationId = partner.pickupLocationId

    // Row 150: a changed pickup address gets a Location row of its own, and the restaurant points at it. The
    // old row is never written: a Location can be shared (quotes and deliveries find or create one by address
    // and point), so an update in place would move every quote and delivery on it too, as row 102 found for
    // drop offs. An edit that changes nothing keeps the row.
    if (input.pickupAddress) {
      const current = partner.pickupLocationId
        ? await this.locationDomainService.getById(partner.pickupLocationId)
        : null
      if (!current || !this.isSamePickup(current, input.pickupAddress)) {
        const newLocation = await this.locationDomainService.create(this.toLocationCreate(input.pickupAddress))
        pickupLocationId = newLocation.id
      }
    }

    const updateData: IPartnerUpdate = {}
    if (input.name !== undefined) updateData.name = input.name.trim()
    if (input.phoneNumber !== undefined) updateData.phoneNumber = input.phoneNumber
    if (input.logo !== undefined) updateData.logo = input.logo
    if (input.webhookUrl !== undefined) updateData.webhookUrl = input.webhookUrl
    if (input.usualPrepMinutes !== undefined && input.usualPrepMinutes !== null) updateData.usualPrepMinutes = input.usualPrepMinutes
    if (pickupLocationId !== partner.pickupLocationId) updateData.pickupLocationId = pickupLocationId

    if (Object.keys(updateData).length > 0) {
      return this.partnerDomainService.update(partnerId, updateData)
    }
    return this.partnerDomainService.getByIdOrThrow(partnerId)
  }

  // Answers the restaurant's new API key when it had one, else null (spec 0037, AC-1).
  async rotatePassword(partnerId: string, newPassword: string, adminUserId: string): Promise<string | null> {
    const userId = await this.restaurantLoginNotAdmin(partnerId)

    const hashedPassword = await this.passwordService.hash(newPassword)
    // Spec 0037: a password change also replaces the restaurant's API key, if it has one, so whoever
    // had the old password loses the key too. The key is made first and kept only if it was stored.
    const apiKey = makeApiKey()
    // The time is set with the password, so every older restaurant session is refused (spec 0013,
    // AC-9). `new Date()` is Node's clock, the one that signs each token's issue time.
    const { apiKeyReplaced } = await this.userDomainService.setPasswordAndReplaceApiKey(
      userId,
      hashedPassword,
      new Date(),
      hashApiKey(apiKey)
    )
    // Ids only, never the password or the key (spec 0013, AC-10; spec 0037, AC-12).
    this.logger.log(
      `Admin ${adminUserId} set a new password for partner ${partnerId}${apiKeyReplaced ? ' and replaced its API key' : ''}`
    )
    return apiKeyReplaced ? apiKey : null
  }

  // An admin's New API key (spec 0037, AC-3): a new key, shown once in the answer; any earlier key of
  // this restaurant stops working in the same write.
  async createApiKey(partnerId: string, adminUserId: string): Promise<{ apiKey: string; apiKeyCreatedAt: Date }> {
    const userId = await this.restaurantLoginNotAdmin(partnerId)
    const apiKey = makeApiKey()
    const apiKeyCreatedAt = new Date()
    const { replaced } = await this.userDomainService.replaceApiKeyHash(userId, hashApiKey(apiKey), apiKeyCreatedAt)
    // Ids only, never the key or its hash (AC-12).
    this.logger.log(
      replaced
        ? `Admin ${adminUserId} replaced the API key of partner ${partnerId}`
        : `Admin ${adminUserId} made a new API key for partner ${partnerId}`
    )
    return { apiKey, apiKeyCreatedAt }
  }

  // An admin's Remove key (spec 0037, AC-4). Allowed for any login, even one that is also an admin:
  // removing a key signs nobody out, and a key must always be removable (AC-11).
  async removeApiKey(partnerId: string, adminUserId: string): Promise<void> {
    const partner = await this.partnerDomainService.getByIdOrThrow(partnerId)
    if (!partner.userId) {
      throw new errors.NotFoundException('This partner has no login user')
    }
    const { removed } = await this.userDomainService.removeApiKey(partner.userId)
    // Only when there was a key; a removal with nothing to remove logs nothing (AC-12).
    if (removed) {
      this.logger.log(`Admin ${adminUserId} removed the API key of partner ${partnerId}`)
    }
  }

  // The restaurant's login id, refusing a restaurant with no login (404) and a login that is also an
  // admin (403). A password change ends every older session (spec 0013) and these routes never sign
  // an admin out (AC-10); a key is never made for an admin login either (spec 0037, AC-11).
  private async restaurantLoginNotAdmin(partnerId: string): Promise<string> {
    const partner = await this.partnerDomainService.getByIdOrThrow(partnerId)
    if (!partner.userId) {
      throw new errors.NotFoundException('This partner has no login user')
    }
    const user = await this.userDomainService.findById(partner.userId)
    if (user.role.includes(EnumUserRole.ADMIN)) {
      throw new errors.ForbiddenException('This login also belongs to an admin.')
    }
    return partner.userId
  }

  // AIFLOW-NOTE: countryCode is included in formattedAddress for multi-country compatibility across the backend
  private buildFormattedAddress(input: PickupAddressAdminInput): string {
    if (input.formattedAddress && input.formattedAddress.trim() !== '') {
      return input.formattedAddress.trim()
    }
    const streetWithNumber = [input.street, input.houseNumber].filter(Boolean).join(' ')
    const parts = [streetWithNumber, input.city, input.state, input.zipCode, input.countryCode].filter(Boolean)
    return parts.join(', ')
  }

  private toLocationCreate(input: PickupAddressAdminInput): ILocationCreate {
    return {
      street: input.street,
      houseNumber: input.houseNumber,
      city: input.city,
      state: input.state,
      stateCode: input.state,
      zipCode: input.zipCode,
      countryCode: input.countryCode,
      latitude: input.latitude,
      longitude: input.longitude,
      formattedAddress: this.buildFormattedAddress(input),
    }
  }

  // Row 150: whether the saved row already holds this address and point, every field the edit writes.
  private isSamePickup(current: LocationEntity, input: PickupAddressAdminInput): boolean {
    const wanted = this.toLocationCreate(input)
    // `?? null` on both sides: a field left out of the input (undefined) and an empty column (null) match.
    const same = (saved: unknown, sent: unknown) => (saved ?? null) === (sent ?? null)
    return (
      same(current.street, wanted.street) &&
      same(current.houseNumber, wanted.houseNumber) &&
      same(current.city, wanted.city) &&
      same(current.state, wanted.state) &&
      same(current.zipCode, wanted.zipCode) &&
      same(current.countryCode, wanted.countryCode) &&
      same(current.latitude, wanted.latitude) &&
      same(current.longitude, wanted.longitude) &&
      same(current.formattedAddress, wanted.formattedAddress)
    )
  }
}
