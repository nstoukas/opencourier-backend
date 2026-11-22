import { Injectable, Logger } from '@nestjs/common'
import { AddressNoteForAdmin, LocationNoteRepository } from 'src/persistence/repositories/location-note.repository'
import { foldSearchText, searchWords } from 'src/rest-api/common/search-fold'
import { LocationNoteWhereArgs } from './types/location-note-where-args.type'
import { LocationNoteReactionRepository } from 'src/persistence/repositories/location-note-reaction.repository'
import { EnumLocationNoteActor, EnumLocationNoteReactionType } from '@prisma/types'
import * as errors from 'src/errors'
import { PERSONAL_DATA_WARNING_MESSAGE, looksLikePersonalData } from './personal-data-check'
import {
  ADDRESS_NOTE_MAX_EARLIER_CORRECTIONS,
  Point,
  boxAround,
  currentDropoffPoint,
  notesForStop,
} from './address-note-point'
import { LocationNoteEntity } from './entities/location-note.entity'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { DEFAULT_ADDRESS_NOTE_RETENTION_DAYS } from 'src/constants'

// Spec 0053 (cross check 3): which stop of the job a note is about.
export const ADDRESS_NOTE_STOPS = ['PICKUP', 'DROPOFF'] as const
export type AddressNoteStop = (typeof ADDRESS_NOTE_STOPS)[number]

// What a job card shows of a note (AC-3, cross check 5): the text, the upvotes and this rider's own
// marks. Never the author: `mine` only tells the rider which notes they may edit or delete.
export type AddressNoteForCourier = {
  id: string
  note: string
  upvotes: number
  upvotedByMe: boolean
  flaggedByMe: boolean
  mine: boolean
}

// The parts of a delivery the notes need: its two Locations and the rider's moved pin.
export type DeliveryForNotes = {
  id: string
  pickupLocationId: string
  dropoffLocationId: string
  pickupLocation: Point
  dropoffLocation: Point
  dropoffCorrectedLatitude: number | null
  dropoffCorrectedLongitude: number | null
}

const DAY_MS = 24 * 60 * 60 * 1000

// The admin search reads at most this many notes (newest confirmed first) and filters them in code.
// Notes expire, so a town's notes stay well under it.
const ADMIN_SEARCH_READ_LIMIT = 5000

// AC-7: a note as the admin page shows it, author included (admin only), with its address line and
// its upvotes from riders other than the author.
export type AddressNoteAdminView = AddressNoteForAdmin & { address: string | null; upvotes: number }

// The linked Location's address as one line, or null for a note with no Location.
function addressLineOf(note: AddressNoteForAdmin): string | null {
  const location = note.locations
  if (!location) return null
  const street = [location.street, location.houseNumber].filter(Boolean).join(' ')
  const line = location.formattedAddress || location.addressLine1 || [street, location.city].filter(Boolean).join(', ')
  return line || null
}

// What the search matches: the address line where there is one, and the coordinates always.
function addressTextOf(note: AddressNoteForAdmin): string {
  const parts = [
    note.locations?.formattedAddress,
    note.locations?.addressLine1,
    note.locations?.street,
    note.locations?.city,
  ]
  return [...parts.filter(Boolean), `${note.latitude.toFixed(5)}, ${note.longitude.toFixed(5)}`].join(' ')
}

// A delivery read with its Locations, as the notes need it; null when a Location is missing (the
// relation is required in the schema, so only a broken row could do that).
export function toDeliveryForNotes(
  delivery: Omit<DeliveryForNotes, 'pickupLocation' | 'dropoffLocation'> & {
    pickupLocation: Point | null
    dropoffLocation: Point | null
  }
): DeliveryForNotes | null {
  const { pickupLocation, dropoffLocation } = delivery
  if (!pickupLocation || !dropoffLocation) return null
  return { ...delivery, pickupLocation, dropoffLocation }
}

@Injectable()
export class LocationNoteDomainService {
  private readonly logger = new Logger(LocationNoteDomainService.name)
  constructor(
    private locationNoteRepository: LocationNoteRepository,
    private locationNoteReactionRepository: LocationNoteReactionRepository,
    // Row 82 review: the retention period, so job cards leave out expired notes. Optional for the tests
    // that build this service by hand (they get the default period); Nest always injects it.
    private configDomainService?: ConfigDomainService
  ) {}

  // The oldest `lastConfirmedAt` a note may have and still show: now minus the co-op's retention period.
  private async retentionCutoff(now: Date = new Date()): Promise<Date> {
    const days =
      (await this.configDomainService?.instanceConfig.getAddressNoteRetentionDays()) ??
      DEFAULT_ADDRESS_NOTE_RETENTION_DAYS
    return new Date(now.getTime() - days * DAY_MS)
  }

  // AC-4: refuses text that looks like it holds a name, phone or email unless the rider confirmed it.
  // The answer carries the fixed sentence only, never the text.
  refuseIfPersonalData(text: string, confirmed: boolean | undefined): void {
    if (confirmed !== true && looksLikePersonalData(text)) {
      throw new errors.PersonalDataWarningException(PERSONAL_DATA_WARNING_MESSAGE)
    }
  }

  // AC-2, cross check 3: a note on one stop of a job, at that stop's point: the restaurant's Location
  // for the pickup, the current drop off point (the rider's moved pin, else the Location) for the drop
  // off. The note keeps the stop's Location id so the admin page can search it by address.
  async createForStop(input: {
    delivery: DeliveryForNotes
    stop: AddressNoteStop
    note: string
    courierId: string | null
    actor: EnumLocationNoteActor
    confirmed?: boolean
  }): Promise<LocationNoteEntity> {
    this.refuseIfPersonalData(input.note, input.confirmed)
    const point =
      input.stop === 'PICKUP'
        ? { latitude: input.delivery.pickupLocation.latitude, longitude: input.delivery.pickupLocation.longitude }
        : currentDropoffPoint(input.delivery)
    return this.locationNoteRepository.create({
      note: input.note,
      actor: input.actor,
      courierId: input.courierId,
      deliveryId: input.delivery.id,
      locationId: input.stop === 'PICKUP' ? input.delivery.pickupLocationId : input.delivery.dropoffLocationId,
      latitude: point.latitude,
      longitude: point.longitude,
    })
  }

  // Cross check 7: an edit runs the check again and does not restart the retention clock.
  async update(noteId: string, note: string, confirmed?: boolean) {
    this.refuseIfPersonalData(note, confirmed)
    const locationNote = await this.locationNoteRepository.update(noteId, note)

    return locationNote
  }

  async findByIdOrThrow(noteId: string) {
    const locationNote = await this.locationNoteRepository.findByIdOrThrow(noteId)

    return locationNote
  }

  // An upvote toggles: a second press takes it back. AC-5 (cross check 7): a new upvote by someone
  // other than the author restarts the retention clock; taking an upvote back never rolls it back.
  async addOrRemoveReaction(locationNoteId: string, courierId: string, reactionType: EnumLocationNoteReactionType) {
    const note = await this.locationNoteRepository.findByIdOrThrow(locationNoteId)
    const reactionByCourier = await this.locationNoteReactionRepository.getNoteFromCourier(locationNoteId, courierId)

    if (reactionByCourier) {
      if (reactionByCourier.reaction === reactionType) {
        return await this.locationNoteReactionRepository.delete(reactionByCourier.id)
      }

      const updatedReaction = await this.locationNoteReactionRepository.update(reactionByCourier.id, {
        reaction: reactionType,
      })
      await this.confirmIfUpvoteByOther(note, courierId, reactionType)

      return updatedReaction
    }

    const reaction = await this.locationNoteReactionRepository.create({
      locationNoteId,
      courierId,
      reaction: reactionType,
    })
    await this.confirmIfUpvoteByOther(note, courierId, reactionType)

    return reaction
  }

  private async confirmIfUpvoteByOther(
    note: LocationNoteEntity,
    courierId: string,
    reactionType: EnumLocationNoteReactionType
  ): Promise<void> {
    if (reactionType === EnumLocationNoteReactionType.UPVOTE && note.courierId !== courierId) {
      await this.locationNoteRepository.markConfirmed(note.id, new Date())
    }
  }

  // AC-7: any rider can flag a note once; the note stays visible until an admin acts (cross check 8).
  async flag(noteId: string, courierId: string, reason: string | null): Promise<void> {
    if (!(await this.locationNoteRepository.exists(noteId))) {
      throw new errors.NotFoundException('Location note not found')
    }
    await this.locationNoteRepository.flagOnce(noteId, courierId, reason)
  }

  // AC-3: the notes each job's two stops show this rider, keyed by delivery id. One database read for
  // every stop's square, then the exact 30 m check, the order and the limit in code.
  async notesForJobs(
    deliveries: DeliveryForNotes[],
    courierId: string
  ): Promise<Map<string, { pickup: AddressNoteForCourier[]; dropoff: AddressNoteForCourier[] }>> {
    const result = new Map<string, { pickup: AddressNoteForCourier[]; dropoff: AddressNoteForCourier[] }>()
    if (deliveries.length === 0) return result

    // Cross check 2: the pins earlier riders moved for the same drop off addresses.
    const earlier = await this.locationNoteRepository.findCorrectedPointsForDropoffLocations(
      Array.from(new Set(deliveries.map((delivery) => delivery.dropoffLocationId))),
      ADDRESS_NOTE_MAX_EARLIER_CORRECTIONS
    )
    const stops = deliveries.map((delivery) => ({
      delivery,
      pickupPoints: [delivery.pickupLocation],
      dropoffPoints: [
        currentDropoffPoint(delivery),
        ...earlier
          .filter((point) => point.dropoffLocationId === delivery.dropoffLocationId)
          .slice(0, ADDRESS_NOTE_MAX_EARLIER_CORRECTIONS),
      ],
    }))

    const boxes = stops.flatMap((stop) =>
      [...stop.pickupPoints, ...stop.dropoffPoints].map((point) => boxAround(point))
    )
    const candidates = await this.locationNoteRepository.findInsideBoxes(boxes, await this.retentionCutoff())

    const shown = stops.map((stop) => ({
      deliveryId: stop.delivery.id,
      pickup: notesForStop(candidates, stop.pickupPoints),
      dropoff: notesForStop(candidates, stop.dropoffPoints),
    }))
    const shownNotes = new Map<string, LocationNoteEntity>()
    for (const entry of shown) {
      for (const note of [...entry.pickup, ...entry.dropoff]) {
        shownNotes.set(note.id, note)
      }
    }
    const counts = await this.locationNoteRepository.findCourierFacingCounts(Array.from(shownNotes.values()), courierId)

    const forCourier = (note: LocationNoteEntity): AddressNoteForCourier => ({
      id: note.id,
      note: note.note ?? '',
      upvotes: counts.upvotes.get(note.id) ?? 0,
      upvotedByMe: counts.upvotedByMe.has(note.id),
      flaggedByMe: counts.flaggedByMe.has(note.id),
      mine: note.courierId !== null && note.courierId === courierId,
    })
    for (const entry of shown) {
      result.set(entry.deliveryId, { pickup: entry.pickup.map(forCourier), dropoff: entry.dropoff.map(forCourier) })
    }
    return result
  }

  // AC-6: deletes the notes no rider confirmed within the retention period. Returns the count only;
  // nothing here reads or logs a note's text.
  async deleteExpired(retentionDays: number, now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - retentionDays * DAY_MS)
    return this.locationNoteRepository.deleteConfirmedBefore(cutoff)
  }

  // AC-7: the admin Address notes page. Flagged notes first, with their flags.
  async adminFlagged(): Promise<AddressNoteAdminView[]> {
    const notes = await this.locationNoteRepository.findFlaggedForAdmin()
    return this.withUpvotes(notes)
  }

  // AC-7, cross check 9: a search by the linked Location's address text, else the coordinates, every
  // typed word matching on its own, ignoring case and accents. No filter by author.
  async adminSearch(
    search: string,
    page: number,
    perPage: number
  ): Promise<{ data: AddressNoteAdminView[]; total: number }> {
    const words = searchWords(search)
    const notes = await this.locationNoteRepository.findAllForAdmin(ADMIN_SEARCH_READ_LIMIT)
    const matching = notes.filter((note) => {
      const text = foldSearchText(addressTextOf(note))
      return words.every((word) => text.includes(word))
    })
    const pageOf = matching.slice((page - 1) * perPage, page * perPage)
    return { data: await this.withUpvotes(pageOf), total: matching.length }
  }

  // AC-7: deletes the note and writes who deleted which note and when (the text is not kept).
  async adminDelete(noteId: string, adminUserId: string): Promise<void> {
    const deleted = await this.locationNoteRepository.deleteByAdmin(noteId, adminUserId)
    if (!deleted) throw new errors.NotFoundException('Location note not found')
    this.logger.log(`ADDRESS_NOTE_DELETED_BY_ADMIN note ${noteId} by admin ${adminUserId}`)
  }

  // Cross check 8: Dismiss deletes the note's flags; the note stays.
  async adminDismissFlags(noteId: string): Promise<void> {
    if (!(await this.locationNoteRepository.exists(noteId))) {
      throw new errors.NotFoundException('Location note not found')
    }
    await this.locationNoteRepository.dismissFlags(noteId)
  }

  private async withUpvotes(notes: AddressNoteForAdmin[]): Promise<AddressNoteAdminView[]> {
    const upvotes = await this.locationNoteRepository.findUpvoteCountsForAdmin(notes)
    return notes.map((note) => ({ ...note, address: addressLineOf(note), upvotes: upvotes.get(note.id) ?? 0 }))
  }

  async getById(locationNoteId: string) {
    const locationNote = await this.locationNoteRepository.findByIdOrThrow(locationNoteId)

    return locationNote
  }

  async getMany(args: LocationNoteWhereArgs, page?: number, perPage?: number) {
    const locationNotes = await this.locationNoteRepository.findManyPaginated(args, page, perPage)

    return locationNotes
  }

  async delete(locationNoteId: string) {
    const result = await this.locationNoteRepository.delete(locationNoteId)

    return result
  }
}
