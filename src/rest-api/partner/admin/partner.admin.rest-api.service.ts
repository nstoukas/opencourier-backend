import { Injectable } from '@nestjs/common'
import * as errors from 'src/errors'
import { AuthDomainService } from 'src/domains/auth/auth.domain.service'
import { PasswordService } from 'src/domains/auth/password.service'
import { LocationDomainService } from 'src/domains/location/location.domain.service'
import { ILocationCreate } from 'src/domains/location/interfaces/ILocationCreate'
import { ILocationUpdate } from 'src/domains/location/interfaces/ILocationUpdate'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { IPartnerUpdate } from 'src/domains/partner/interfaces/IPartnerRepository'
import { PartnerDomainService } from 'src/domains/partner/partner.domain.service'
import { UserDomainService } from 'src/domains/user/user.domain.service'
import { PartnerCreateAdminInput } from './queries/partner-create.admin.input'
import { PartnerUpdateAdminInput } from './queries/partner-update.admin.input'
import { PickupAddressAdminInput } from './queries/pickup-address.admin.input'

@Injectable()
export class PartnerAdminRestApiService {
  constructor(
    private partnerDomainService: PartnerDomainService,
    private locationDomainService: LocationDomainService,
    private userDomainService: UserDomainService,
    private authDomainService: AuthDomainService,
    private passwordService: PasswordService,
  ) {}

  async createRestaurant(input: PartnerCreateAdminInput): Promise<PartnerEntity> {
    const email = input.email.trim().toLowerCase()
    const userExists = await this.userDomainService.findUserWithEmail(email)
    if (userExists) {
      throw new errors.UserExistsException('A partner with this email already exists')
    }

    const hashedPassword = await this.passwordService.hash(input.password)
    const apiKey = this.authDomainService.generateApiKey()

    let locationId: string | null = null
    if (input.pickupAddress) {
      const location = await this.locationDomainService.create(this.toLocationCreate(input.pickupAddress))
      locationId = location.id
    }

    return this.partnerDomainService.createWithLogin({
      name: input.name.trim(),
      phoneNumber: input.phoneNumber ?? null,
      pickupLocationId: locationId,
      login: {
        email,
        hashedPassword,
        apiKey,
      },
    })
  }

  async updateRestaurant(partnerId: string, input: PartnerUpdateAdminInput): Promise<PartnerEntity> {
    const partner = await this.partnerDomainService.getByIdOrThrow(partnerId)
    let pickupLocationId = partner.pickupLocationId

    if (input.pickupAddress) {
      if (partner.pickupLocationId) {
        await this.locationDomainService.update(partner.pickupLocationId, this.toLocationUpdate(input.pickupAddress))
      } else {
        const newLocation = await this.locationDomainService.create(this.toLocationCreate(input.pickupAddress))
        pickupLocationId = newLocation.id
      }
    }

    const updateData: IPartnerUpdate = {}
    if (input.name !== undefined) updateData.name = input.name.trim()
    if (input.phoneNumber !== undefined) updateData.phoneNumber = input.phoneNumber
    if (input.logo !== undefined) updateData.logo = input.logo
    if (input.webhookUrl !== undefined) updateData.webhookUrl = input.webhookUrl
    if (pickupLocationId !== partner.pickupLocationId) updateData.pickupLocationId = pickupLocationId

    if (Object.keys(updateData).length > 0) {
      return this.partnerDomainService.update(partnerId, updateData)
    }
    return this.partnerDomainService.getByIdOrThrow(partnerId)
  }

  async rotatePassword(partnerId: string, newPassword: string): Promise<void> {
    const partner = await this.partnerDomainService.getByIdOrThrow(partnerId)
    if (!partner.userId) {
      throw new errors.NotFoundException('This partner has no login user')
    }

    const hashedPassword = await this.passwordService.hash(newPassword)
    await this.userDomainService.update(partner.userId, { password: hashedPassword })
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

  private toLocationUpdate(input: PickupAddressAdminInput): ILocationUpdate {
    return {
      street: input.street,
      houseNumber: input.houseNumber,
      city: input.city,
      state: input.state,
      countryCode: input.countryCode,
      latitude: input.latitude,
      longitude: input.longitude,
      zipCode: input.zipCode,
      formattedAddress: this.buildFormattedAddress(input),
    }
  }
}
