import { ConflictException, Injectable, Logger } from '@nestjs/common'
import { ICourierCreate } from './interfaces/ICourierCreate'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import { ICourierUpdate } from './interfaces/ICourierUpdate'
import { ICourierUpdateLocation } from './interfaces/ICourierUpdateLocation'
import { ICourierFindNearestArgs } from './interfaces/ICourierFindNearestArgs'
import { ICourierFindBySeniorityArgs } from './interfaces/ICourierFindBySeniorityArgs'
import { EnumCourierDeliverySetting, EnumCourierStatus, Prisma } from '@prisma/types'

// The 409 a phone gets for a position sent while Offline with no job (spec 0038, AC-14).
export const OFFLINE_POSITION_REFUSED_MESSAGE = 'You are Offline, so no position is stored'

@Injectable()
export class CourierDomainService {
  private readonly logger = new Logger(CourierDomainService.name)
  constructor(private courierRepository: CourierRepository) {}

  async create(input: ICourierCreate) {
    const { userId, firstName, lastName } = input

    const courier = await this.courierRepository.create({
      userId,
      firstName,
      lastName,
    })

    return courier
  }

  // Spec 0038 (AC-15): an admin setting a rider Offline goes through the same statement as the rider's
  // own switch, which erases the stored position when they hold no job. The other fields follow.
  async update(id: string, input: ICourierUpdate) {
    if (input.status === EnumCourierStatus.OFFLINE) {
      await this.courierRepository.setOfflineAndClearLocationIfFree(id)
      const { status: _status, ...rest } = input
      return this.courierRepository.updateById(id, rest)
    }
    const courier = await this.courierRepository.updateById(id, input)

    return courier
  }

  async getNearestAvailableCourier(args: ICourierFindNearestArgs) {
    const courier = await this.courierRepository.findNearestAvailableCourier(args)

    return courier
  }

  async getNearestAvailableCandidates(args: ICourierFindNearestArgs, limit: number) {
    return this.courierRepository.findNearestAvailableCandidates(args, limit)
  }

  async getMostSeniorAvailableCourier(args: ICourierFindBySeniorityArgs) {
    const courier = await this.courierRepository.findMostSeniorAvailableCourier(args)

    return courier
  }

  async getManyCouriers(where: Prisma.CourierWhereInput, page?: number, perPage?: number) {
    const couriers = await this.courierRepository.findManyPaginated(where, page, perPage)

    return couriers
  }

  async getByIdOrThrow(id: string) {
    const courier = await this.courierRepository.findByIdOrThrow(id)

    return courier
  }

  async getByIdWithSettings(id: string) {
    const courierWithSettings = await this.courierRepository.findByIdWithSettings(id)

    return courierWithSettings
  }

  async getByUserId(id: string) {
    const courier = await this.courierRepository.findByUserId(id)

    return courier
  }

  // Spec 0038 (AC-14): a position from a rider who is Offline and holds no job is refused, and nothing
  // is stored. The app stops sending positions when it goes Offline (row 67); this is the server's own
  // guarantee.
  async updateCurrentLocation(id: string, input: ICourierUpdateLocation): Promise<void> {
    const stored = await this.courierRepository.updateCurrentLocationById(id, input)
    if (!stored) throw new ConflictException(OFFLINE_POSITION_REFUSED_MESSAGE)
  }

  async getCurrentLocation(id: string) {
    const courier = await this.courierRepository.getCurrentLocation(id)

    return courier
  }

  async updateStatus(id: string, status: EnumCourierStatus) {
    const result = await this.courierRepository.updateStatus(id, status)

    return result
  }

  async updateDeliverySetting(id: string, deliverySetting: EnumCourierDeliverySetting) {
    const result = await this.courierRepository.updateDeliverySetting(id, deliverySetting)

    return result
  }
}
