import { Injectable, Logger } from '@nestjs/common'
import { PartnerRepository } from 'src/persistence/repositories/partner.repository'
import { IPartnerCreate, IPartnerCreateWithLogin, IPartnerUpdate } from './interfaces/IPartnerRepository'

@Injectable()
export class PartnerDomainService {
  private readonly logger = new Logger(PartnerDomainService.name)
  constructor(private partnerRepository: PartnerRepository) {}

  async getById(id: string) {
    const partner = await this.partnerRepository.findById(id)

    return partner
  }

  async getByIdOrThrow(id: string) {
    return this.partnerRepository.findByIdOrThrow(id)
  }

  async getByUserId(userId: string) {
    const partner = await this.partnerRepository.findByUserIdOrThrow(userId)

    return partner
  }

  async getFirst() {
    return this.partnerRepository.findFirst()
  }

  async getMany(page?: number, perPage?: number) {
    return this.partnerRepository.findManyPaginated(page, perPage)
  }

  async create(data: IPartnerCreate) {
    return this.partnerRepository.create(data)
  }

  async createWithLogin(data: IPartnerCreateWithLogin) {
    return this.partnerRepository.createWithLogin(data)
  }

  async update(id: string, data: IPartnerUpdate) {
    return this.partnerRepository.update(id, data)
  }
}
