import { Injectable, Logger } from '@nestjs/common'
import {
  LocationNoteDomainService,
  AddressNoteStop,
  toDeliveryForNotes,
} from 'src/domains/location-note/location-note.domain.service'
import { LocationNoteWhereArgs } from 'src/domains/location-note/types/location-note-where-args.type'
import * as errors from 'src/errors'
import { EnumLocationNoteActor, EnumLocationNoteReactionType } from '@prisma/types'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { DELIVERY_ONGOING_STATUSES } from 'src/shared-types'
import { isRecordNotFoundError } from 'src/prisma.util'

@Injectable()
export class LocationNoteRestApiCourierService {
  private readonly logger = new Logger(LocationNoteRestApiCourierService.name)
  constructor(
    private locationNoteDomainService: LocationNoteDomainService,
    private deliveryRepository: DeliveryRepository
  ) {}

  // Spec 0053 (AC-2): a rider adds a note only on a job they hold (accepted and not yet over); any
  // other delivery answers like a missing one. The point comes from the job, never from the phone.
  async create(
    input: { deliveryId: string; stop: AddressNoteStop; note: string; confirmed?: boolean },
    courierId: string
  ) {
    const delivery = await this.findHeldDeliveryWithLocations(input.deliveryId, courierId)
    return this.locationNoteDomainService.createForStop({
      delivery,
      stop: input.stop,
      note: input.note,
      confirmed: input.confirmed,
      courierId,
      actor: EnumLocationNoteActor.COURIER,
    })
  }

  private async findHeldDeliveryWithLocations(deliveryId: string, courierId: string) {
    try {
      const delivery = toDeliveryForNotes(
        await this.deliveryRepository.findByIdOrThrowWithLocations(deliveryId, {
          courierId,
          status: { in: DELIVERY_ONGOING_STATUSES },
        })
      )
      if (!delivery) throw new errors.DeliveryNotFoundException('Delivery not found')
      return delivery
    } catch (error) {
      if (error instanceof Error && isRecordNotFoundError(error)) {
        throw new errors.DeliveryNotFoundException('Delivery not found')
      }
      throw error
    }
  }

  async update(noteId: string, note: string, courierId: string, confirmed?: boolean) {
    const locationNote = await this.locationNoteDomainService.findByIdOrThrow(noteId)

    if (locationNote.courierId !== courierId) {
      throw new errors.NotFoundException('Location note not found')
    }

    const updatedNote = await this.locationNoteDomainService.update(locationNote.id, note, confirmed)

    return updatedNote
  }

  async addOrRemoveReaction(locationNoteId: string, courierId: string, reactionType: EnumLocationNoteReactionType) {
    const locationNote = await this.locationNoteDomainService.addOrRemoveReaction(
      locationNoteId,
      courierId,
      reactionType
    )

    return locationNote
  }

  // Spec 0053 (AC-7).
  async flag(locationNoteId: string, courierId: string, reason: string | null) {
    await this.locationNoteDomainService.flag(locationNoteId, courierId, reason)
  }

  // AC-3: only the rider's own note.
  async getById(noteId: string, courierId: string) {
    const locationNote = await this.locationNoteDomainService.getById(noteId)

    if (locationNote.courierId !== courierId) {
      throw new errors.NotFoundException('Location note not found')
    }

    return locationNote
  }

  async getMany(args: LocationNoteWhereArgs, page?: number, perPage?: number) {
    const locationNotes = await this.locationNoteDomainService.getMany(args, page, perPage)

    return locationNotes
  }

  async delete(noteId: string, courierId: string) {
    const locationNotes = await this.locationNoteDomainService.getById(noteId)

    if (locationNotes.courierId !== courierId) {
      throw new errors.NotFoundException('Location note not found')
    }

    return await this.locationNoteDomainService.delete(noteId)
  }
}
