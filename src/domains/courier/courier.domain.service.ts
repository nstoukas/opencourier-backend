import { ConflictException, Injectable, Logger } from '@nestjs/common'
import { ICourierCreate } from './interfaces/ICourierCreate'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import { ICourierUpdate } from './interfaces/ICourierUpdate'
import { ICourierUpdateLocation } from './interfaces/ICourierUpdateLocation'
import { ICourierFindNearestArgs } from './interfaces/ICourierFindNearestArgs'
import { ICourierFindBySeniorityArgs } from './interfaces/ICourierFindBySeniorityArgs'
import { EnumCourierDeliverySetting, EnumCourierStatus, EnumCourierStatusChangeCause, Prisma } from '@prisma/types'
import { ICourierStatusChangeResult } from './interfaces/ICourierStatusChangeResult'

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

  // Every field but the status, which only changeStatus writes (spec 0040, AC-1).
  async update(id: string, input: ICourierUpdate) {
    return this.courierRepository.updateById(id, input)
  }

  // Spec 0040 (AC-1): the one way to change a rider's status, with why it changed and, on an admin's
  // edit or a password change an admin made, which admin. Offline also erases the stored position when
  // the rider holds no job (spec 0038, AC-15).
  async changeStatus(
    id: string,
    status: EnumCourierStatus,
    cause: EnumCourierStatusChangeCause,
    adminUserId?: string | null
  ): Promise<ICourierStatusChangeResult> {
    return this.courierRepository.changeStatus(id, status, cause, adminUserId)
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

  async updateDeliverySetting(id: string, deliverySetting: EnumCourierDeliverySetting) {
    const result = await this.courierRepository.updateDeliverySetting(id, deliverySetting)

    return result
  }
}
