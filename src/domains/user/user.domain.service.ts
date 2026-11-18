import { Injectable, Logger } from '@nestjs/common'
import { UserRepository } from 'src/persistence/repositories/user.repository'
import { UserEntity } from './entities/user.entity'
import { IUserUpdate } from './interfaces/IUserUpdate'
import { IUserCreate } from './interfaces/IUserCreate'

@Injectable()
export class UserDomainService {
  private readonly logger = new Logger(UserDomainService.name)
  constructor(private userRepository: UserRepository) {}

  async create(data: IUserCreate) {
    return await this.userRepository.create(data)
  }

  async findById(userId: string) {
    return await this.userRepository.findById(userId)
  }

  // Spec 0037: lookups and writes of a restaurant's API key go by its hash only (see api-key.ts).
  async findByApiKeyHash(apiKeyHash: string) {
    return await this.userRepository.findByApiKeyHash(apiKeyHash)
  }

  async replaceApiKeyHash(userId: string, apiKeyHash: string, apiKeyCreatedAt: Date) {
    return this.userRepository.replaceApiKeyHash(userId, apiKeyHash, apiKeyCreatedAt)
  }

  async removeApiKey(userId: string) {
    return this.userRepository.removeApiKey(userId)
  }

  async setPasswordAndReplaceApiKey(userId: string, password: string, credentialsChangedAt: Date, apiKeyHash: string) {
    return this.userRepository.setPasswordAndReplaceApiKey(userId, password, credentialsChangedAt, apiKeyHash)
  }

  async findByIdWithCourier(userId: string) {
    return await this.userRepository.findByIdWithCourier(userId)
  }

  async findUserWithEmail(email: string) {
    return await this.userRepository.findUserWithEmail(email)
  }

  async findUserWithEmailIgnoringCase(email: string) {
    return await this.userRepository.findUserWithEmailIgnoringCase(email)
  }

  async findByEmail(email: string) {
    return await this.userRepository.findByEmail(email)
  }

  async findByUsername(username: string) {
    return await this.userRepository.findByUsername(username)
  }

  async update(userId: string, data: IUserUpdate) {
    return this.userRepository.updateById(userId, data)
  }

  async updateMe(user: UserEntity, data: IUserUpdate) {
    return this.userRepository.updateById(user.id, data)
  }

  async deleteMe(user: UserEntity) {
    return this.userRepository.deleteById(user.id)
  }

  async countAll() {
    return this.userRepository.countAll()
  }
}
