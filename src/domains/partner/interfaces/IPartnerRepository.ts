import { PaginatedResult } from 'src/core/models/Pagination'
import { PartnerEntity } from '../entities/partner.entity'

export interface IPartnerCreate {
  name: string
  userId: string
  logo?: string | null
  phoneNumber?: string | null
  webhookUrl?: string | null
  pickupLocationId?: string | null
}

export interface IPartnerUpdate {
  name?: string
  phoneNumber?: string | null
  logo?: string | null
  webhookUrl?: string | null
  pickupLocationId?: string | null
}

export interface IPartnerCreateWithLogin {
  name: string
  phoneNumber?: string | null
  pickupLocationId?: string | null
  login: {
    email: string
    hashedPassword: string
    apiKey: string
  }
}

export interface IPartnerRepository {
  findById(partnerId: string): Promise<PartnerEntity | null>
  findByUserIdOrThrow(userId: string): Promise<PartnerEntity>
  findByIdOrThrow(partnerId: string): Promise<PartnerEntity>
  create(data: IPartnerCreate): Promise<PartnerEntity>
  createWithLogin(data: IPartnerCreateWithLogin): Promise<PartnerEntity>
  update(partnerId: string, data: IPartnerUpdate): Promise<PartnerEntity>
  findManyPaginated(page?: number, perPage?: number): Promise<PaginatedResult<PartnerEntity>>
}
