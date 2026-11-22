import { Injectable } from '@nestjs/common'
import { EnumLocationNoteReactionType, LocationNote, Prisma } from '@prisma/types'

import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'
import { createPaginator } from '../../rest-api/Paginator'
import { LocationNoteWhereArgs } from 'src/domains/location-note/types/location-note-where-args.type'
import { ILocationNoteRepository } from 'src/domains/location-note/interfaces/ILocationNoteRepository'
import { LocationNoteEntity } from 'src/domains/location-note/entities/location-note.entity'
import { LocationNoteWhereUniqueArgs } from 'src/domains/location-note/types/location-note-where-unique-args.type'
import { ILocationNoteCreate } from 'src/domains/location-note/interfaces/ILocationNoteCreate'
import { PaginatedResult } from 'src/core/models/Pagination'
import { isUniqueConstraintError } from 'src/prisma.util'
import { LatLngBox, Point } from 'src/domains/location-note/address-note-point'

// Spec 0053 (AC-7): what the admin Address notes page shows of a note, author included (admin only).
export type AddressNoteForAdmin = LocationNote & {
  locations: {
    formattedAddress: string | null
    addressLine1: string | null
    street: string | null
    houseNumber: string | null
    city: string | null
  } | null
  couriers: { id: string; firstName: string; lastName: string } | null
  flags: { id: string; reason: string | null; createdAt: Date }[]
}

const ADMIN_NOTE_INCLUDE = {
  locations: { select: { formattedAddress: true, addressLine1: true, street: true, houseNumber: true, city: true } },
  couriers: { select: { id: true, firstName: true, lastName: true } },
  // Only the reason and the date: who flagged a note is not needed to judge it.
  flags: { select: { id: true, reason: true, createdAt: true }, orderBy: { createdAt: 'desc' as const } },
}

// Row 82 review: one upvote per rider per note. The reaction table has no unique index (upstream), so
// a quick double tap can leave two rows; each rider counts once however many rows they have.
type UpvoteRow = { locationNoteId: string; courierId: string }
function distinctRiders(reactions: UpvoteRow[]): UpvoteRow[] {
  const seen = new Set<string>()
  return reactions.filter((reaction) => {
    const key = `${reaction.locationNoteId} ${reaction.courierId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

@Injectable()
export class LocationNoteRepository extends EntityRepository implements ILocationNoteRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  async create(input: ILocationNoteCreate) {
    const locationNote = await this.prisma.locationNote.create({
      data: input,
    })

    return this.toDomain(locationNote)
  }

  async update(noteId: string, note: string) {
    const locationNote = await this.prisma.locationNote.update({
      where: {
        id: noteId,
      },
      data: {
        note: note,
      },
    })

    return this.toDomain(locationNote)
  }

  async findByIdOrThrow(locationNoteId: string, otherFilters?: LocationNoteWhereArgs) {
    const locationNote = await this.prisma.locationNote.findUniqueOrThrow({
      where: {
        id: locationNoteId,
        ...otherFilters,
      } as LocationNoteWhereUniqueArgs,
    })

    return this.toDomain(locationNote)
  }

  async findManyPaginated(
    args: LocationNoteWhereArgs,
    page?: number,
    perPage?: number
  ): Promise<PaginatedResult<LocationNoteEntity>> {
    const paginator = createPaginator<LocationNote, Prisma.LocationNoteFindManyArgs, Prisma.LocationNoteDelegate>()

    const result = await paginator(
      this.prisma.locationNote,
      {
        where: {
          ...args,
        },
        orderBy: { createdAt: 'desc' },
      },
      { page, perPage }
    )

    return {
      ...result,
      data: this.toDomainMany(result.data),
    }
  }

  async delete(locationNoteId: string) {
    const result = await this.prisma.locationNote.delete({
      where: {
        id: locationNoteId,
      },
    })

    return result
  }

  // Spec 0053 (cross check 11): every note inside any of the boxes; the caller checks the exact distance.
  // Row 82 review: only notes confirmed at or after `confirmedSince`, so a note past the retention period
  // never shows even on a night the deletion job did not run (the job deletes those before the cutoff).
  async findInsideBoxes(boxes: LatLngBox[], confirmedSince: Date): Promise<LocationNoteEntity[]> {
    if (boxes.length === 0) return []
    const notes = await this.prisma.locationNote.findMany({
      where: {
        lastConfirmedAt: { gte: confirmedSince },
        OR: boxes.map((box) => ({
          latitude: { gte: box.minLatitude, lte: box.maxLatitude },
          longitude: { gte: box.minLongitude, lte: box.maxLongitude },
        })),
      },
      orderBy: { lastConfirmedAt: 'desc' },
    })
    return this.toDomainMany(notes)
  }

  // Cross check 2: the points earlier riders moved this address's pin to, newest first, so the next
  // rider sent to the original pin still sees a note left at the real door.
  async findCorrectedPointsForDropoffLocations(
    locationIds: string[],
    limit: number
  ): Promise<(Point & { dropoffLocationId: string })[]> {
    if (locationIds.length === 0) return []
    const rows = await this.prisma.delivery.findMany({
      where: {
        dropoffLocationId: { in: locationIds },
        dropoffCorrectedLatitude: { not: null },
        dropoffCorrectedLongitude: { not: null },
      },
      select: { dropoffLocationId: true, dropoffCorrectedLatitude: true, dropoffCorrectedLongitude: true },
      orderBy: { dropoffPointCorrectedAt: 'desc' },
      take: limit * locationIds.length,
    })
    return rows.map((row) => ({
      dropoffLocationId: row.dropoffLocationId,
      latitude: row.dropoffCorrectedLatitude as number,
      longitude: row.dropoffCorrectedLongitude as number,
    }))
  }

  // AC-3, AC-5 (cross check 7): each note's upvotes, the author's own left out, and this rider's
  // own upvotes and flags. Downvotes are not counted any more.
  async findCourierFacingCounts(
    notes: { id: string; courierId: string | null }[],
    courierId: string
  ): Promise<{ upvotes: Map<string, number>; upvotedByMe: Set<string>; flaggedByMe: Set<string> }> {
    const ids = notes.map((note) => note.id)
    const authorOf = new Map(notes.map((note) => [note.id, note.courierId]))
    const upvotes = new Map<string, number>()
    const upvotedByMe = new Set<string>()
    const flaggedByMe = new Set<string>()
    if (ids.length === 0) return { upvotes, upvotedByMe, flaggedByMe }
    const [reactions, flags] = await Promise.all([
      this.prisma.locationNoteReaction.findMany({
        where: { locationNoteId: { in: ids }, reaction: EnumLocationNoteReactionType.UPVOTE },
        select: { locationNoteId: true, courierId: true },
      }),
      this.prisma.locationNoteFlag.findMany({
        where: { locationNoteId: { in: ids }, courierId },
        select: { locationNoteId: true },
      }),
    ])
    for (const reaction of distinctRiders(reactions)) {
      if (reaction.courierId === courierId) upvotedByMe.add(reaction.locationNoteId)
      if (reaction.courierId === authorOf.get(reaction.locationNoteId)) continue
      upvotes.set(reaction.locationNoteId, (upvotes.get(reaction.locationNoteId) ?? 0) + 1)
    }
    for (const flag of flags) flaggedByMe.add(flag.locationNoteId)
    return { upvotes, upvotedByMe, flaggedByMe }
  }

  // AC-5: an upvote by someone other than the author restarts the retention clock.
  // Raw SQL on purpose: Prisma's @updatedAt would also move `updatedAt`, and the admin page reads
  // that as "edited" (row 82 live check).
  async markConfirmed(noteId: string, at: Date): Promise<void> {
    await this.prisma.$executeRaw`UPDATE "LocationNote" SET "lastConfirmedAt" = ${at} WHERE "id" = ${noteId}`
  }

  // AC-6: deletes every note last confirmed before the cutoff, in one statement. Returns the count only.
  async deleteConfirmedBefore(cutoff: Date): Promise<number> {
    const result = await this.prisma.locationNote.deleteMany({ where: { lastConfirmedAt: { lt: cutoff } } })
    return result.count
  }

  // AC-7: once per rider. A second flag by the same rider keeps the first (and its reason).
  async flagOnce(noteId: string, courierId: string, reason: string | null): Promise<void> {
    try {
      await this.prisma.locationNoteFlag.create({ data: { locationNoteId: noteId, courierId, reason } })
    } catch (error) {
      if (error instanceof Error && isUniqueConstraintError(error)) return
      throw error
    }
  }

  // AC-7: flagged notes first, the newest flag first.
  async findFlaggedForAdmin(): Promise<AddressNoteForAdmin[]> {
    const notes = await this.prisma.locationNote.findMany({
      where: { flags: { some: {} } },
      include: ADMIN_NOTE_INCLUDE,
    })
    const newestFlag = (note: AddressNoteForAdmin) => note.flags[0]?.createdAt.getTime() ?? 0
    return (notes as AddressNoteForAdmin[]).sort((a, b) => newestFlag(b) - newestFlag(a))
  }

  // AC-7, cross check 9: every note, newest confirmed first, for the admin search to filter by address
  // text. Notes are few (they expire), so the search runs over them in code.
  async findAllForAdmin(limit: number): Promise<AddressNoteForAdmin[]> {
    const notes = await this.prisma.locationNote.findMany({
      include: ADMIN_NOTE_INCLUDE,
      orderBy: { lastConfirmedAt: 'desc' },
      take: limit,
    })
    return notes as AddressNoteForAdmin[]
  }

  async findUpvoteCountsForAdmin(notes: { id: string; courierId: string | null }[]): Promise<Map<string, number>> {
    const ids = notes.map((note) => note.id)
    const authorOf = new Map(notes.map((note) => [note.id, note.courierId]))
    const counts = new Map<string, number>()
    if (ids.length === 0) return counts
    const reactions = await this.prisma.locationNoteReaction.findMany({
      where: { locationNoteId: { in: ids }, reaction: EnumLocationNoteReactionType.UPVOTE },
      select: { locationNoteId: true, courierId: true },
    })
    for (const reaction of distinctRiders(reactions)) {
      if (reaction.courierId === authorOf.get(reaction.locationNoteId)) continue
      counts.set(reaction.locationNoteId, (counts.get(reaction.locationNoteId) ?? 0) + 1)
    }
    return counts
  }

  // AC-7: the note goes (its reactions and flags with it) and the admin action row is written in
  // the same transaction; the text is not kept. False when there was no such note.
  async deleteByAdmin(noteId: string, adminUserId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.locationNote.deleteMany({ where: { id: noteId } })
      if (deleted.count === 0) return false
      await tx.addressNoteDeletion.create({ data: { adminUserId, locationNoteId: noteId } })
      return true
    })
  }

  // Cross check 8: Dismiss deletes the flag rows; a rider may flag the note again later.
  async dismissFlags(noteId: string): Promise<number> {
    const result = await this.prisma.locationNoteFlag.deleteMany({ where: { locationNoteId: noteId } })
    return result.count
  }

  async exists(noteId: string): Promise<boolean> {
    const note = await this.prisma.locationNote.findUnique({ where: { id: noteId }, select: { id: true } })
    return note !== null
  }

  private toDomain(data: LocationNote) {
    return new LocationNoteEntity(data)
  }

  private toDomainMany(data: LocationNote[]) {
    return data.map((d) => this.toDomain(d))
  }
}
