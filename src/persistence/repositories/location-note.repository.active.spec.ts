import { EnumLocationNoteReactionType, Prisma } from '@prisma/types'
import { PrismaService } from '../../services/prisma/prisma.service'
import { LocationNoteRepository } from './location-note.repository'
import { LatLngBox } from 'src/domains/location-note/address-note-point'

describe('LocationNoteRepository (Spec 0053, Row 82 review fixes)', () => {
  let repository: LocationNoteRepository
  let mockPrisma: any

  beforeEach(() => {
    mockPrisma = {
      locationNote: {
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      locationNoteReaction: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      locationNoteFlag: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      delivery: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((callback) => callback(mockPrisma)),
      $executeRaw: jest.fn().mockResolvedValue(1),
    }

    repository = new LocationNoteRepository(mockPrisma as unknown as PrismaService)
  })

  describe('findInsideBoxes (Row 82 review: filter notes older than retention cutoff)', () => {
    it('returns empty array without querying when boxes array is empty', async () => {
      const result = await repository.findInsideBoxes([], new Date())
      expect(result).toEqual([])
      expect(mockPrisma.locationNote.findMany).not.toHaveBeenCalled()
    })

    it('queries with lastConfirmedAt gte confirmedSince and OR bounding boxes', async () => {
      const confirmedSince = new Date('2026-05-24T00:00:00Z')
      const boxes: LatLngBox[] = [
        { minLatitude: 39.36, maxLatitude: 39.37, minLongitude: 22.94, maxLongitude: 22.95 },
      ]

      mockPrisma.locationNote.findMany.mockResolvedValue([
        {
          id: 'note-1',
          note: 'Valid note',
          latitude: 39.365,
          longitude: 22.945,
          lastConfirmedAt: new Date('2026-10-01T10:00:00Z'),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ])

      const result = await repository.findInsideBoxes(boxes, confirmedSince)

      expect(mockPrisma.locationNote.findMany).toHaveBeenCalledWith({
        where: {
          lastConfirmedAt: { gte: confirmedSince },
          OR: [
            {
              latitude: { gte: 39.36, lte: 39.37 },
              longitude: { gte: 22.94, lte: 22.95 },
            },
          ],
        },
        orderBy: { lastConfirmedAt: 'desc' },
      })
      expect(result).toHaveLength(1)
      expect(result[0]?.id).toBe('note-1')
    })
  })

  describe('findCourierFacingCounts (Row 82 review: distinct riders per note upvote)', () => {
    it('counts duplicate upvotes by the same rider as only 1 upvote per note', async () => {
      const notes = [
        { id: 'note-1', courierId: 'author-alice' },
        { id: 'note-2', courierId: 'author-bob' },
      ]

      // courier-bob upvoted note-1 TWICE (e.g. rapid double tap leaving two rows in reaction table)
      // courier-charlie upvoted note-1 ONCE
      // courier-alice (author) upvoted note-1 (must be skipped in upvote count)
      // courier-david upvoted note-2 TWICE
      mockPrisma.locationNoteReaction.findMany.mockResolvedValue([
        { locationNoteId: 'note-1', courierId: 'courier-bob' },
        { locationNoteId: 'note-1', courierId: 'courier-bob' }, // duplicate
        { locationNoteId: 'note-1', courierId: 'courier-charlie' },
        { locationNoteId: 'note-1', courierId: 'author-alice' }, // author
        { locationNoteId: 'note-2', courierId: 'courier-david' },
        { locationNoteId: 'note-2', courierId: 'courier-david' }, // duplicate
      ])
      mockPrisma.locationNoteFlag.findMany.mockResolvedValue([
        { locationNoteId: 'note-1' },
      ])

      const result = await repository.findCourierFacingCounts(notes, 'courier-bob')

      // note-1: bob (1) + charlie (1) = 2 upvotes (author alice skipped, bob's duplicate ignored)
      expect(result.upvotes.get('note-1')).toBe(2)
      // note-2: david (1) = 1 upvote (david's duplicate ignored)
      expect(result.upvotes.get('note-2')).toBe(1)
      // calling courier was courier-bob, who upvoted note-1
      expect(result.upvotedByMe.has('note-1')).toBe(true)
      expect(result.upvotedByMe.has('note-2')).toBe(false)
      // calling courier flagged note-1
      expect(result.flaggedByMe.has('note-1')).toBe(true)
    })
  })

  describe('findUpvoteCountsForAdmin (Row 82 review: distinct riders per note upvote)', () => {
    it('counts duplicate upvotes by the same rider as only 1 upvote for admin count', async () => {
      const notes = [
        { id: 'note-1', courierId: 'author-alice' },
      ]

      // courier-bob upvoted note-1 three times
      // author-alice upvoted note-1 once (author skipped)
      mockPrisma.locationNoteReaction.findMany.mockResolvedValue([
        { locationNoteId: 'note-1', courierId: 'courier-bob' },
        { locationNoteId: 'note-1', courierId: 'courier-bob' },
        { locationNoteId: 'note-1', courierId: 'courier-bob' },
        { locationNoteId: 'note-1', courierId: 'author-alice' },
      ])

      const counts = await repository.findUpvoteCountsForAdmin(notes)

      // Only 1 upvote counted from courier-bob
      expect(counts.get('note-1')).toBe(1)
    })

    it('returns empty map when notes list is empty without querying database', async () => {
      const counts = await repository.findUpvoteCountsForAdmin([])
      expect(counts.size).toBe(0)
      expect(mockPrisma.locationNoteReaction.findMany).not.toHaveBeenCalled()
    })
  })
})
