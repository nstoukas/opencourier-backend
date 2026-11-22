import {
  EnumComplaintAbout,
  EnumComplaintCategory,
  EnumComplaintFiledBy,
  EnumComplaintStatus,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  Prisma,
} from '@prisma/types'
import { PrismaService } from '../../services/prisma/prisma.service'
import { ComplaintRepository, CreateComplaintInput } from './complaint.repository'

describe('ComplaintRepository (Spec 0052, AC-1, AC-3, AC-5, AC-6, AC-7)', () => {
  let repository: ComplaintRepository
  let mockPrisma: any

  const deliveryId = 'del-101'
  const courierId = 'courier-c1'
  const partnerId = 'partner-p1'
  const complaintId = 'comp-1'

  beforeEach(() => {
    mockPrisma = {
      delivery: {
        findUnique: jest.fn(),
      },
      deliveryEvent: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      courier: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      complaint: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    }

    repository = new ComplaintRepository(mockPrisma as unknown as PrismaService)
  })

  describe('findDeliveryFacts', () => {
    it('queries delivery with id, partnerId, status, createdAt, courierId', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValue({
        id: deliveryId,
        partnerId,
        status: EnumDeliveryStatus.DROPPED_OFF,
        createdAt: new Date(),
        courierId,
      })

      const facts = await repository.findDeliveryFacts(deliveryId)

      expect(facts).toBeDefined()
      expect(facts?.id).toBe(deliveryId)
      expect(mockPrisma.delivery.findUnique).toHaveBeenCalledWith({
        where: { id: deliveryId },
        select: { id: true, partnerId: true, status: true, createdAt: true, courierId: true },
      })
    })
  })

  describe('findAcceptTimes', () => {
    it('queries successful ACCEPTED delivery events for courier ordered by occurredAt asc', async () => {
      const d1 = new Date('2026-11-20T10:00:00Z')
      const d2 = new Date('2026-11-20T11:00:00Z')
      mockPrisma.deliveryEvent.findMany.mockResolvedValue([
        { occurredAt: d1 },
        { occurredAt: d2 },
      ])

      const times = await repository.findAcceptTimes(deliveryId, courierId)

      expect(times).toEqual([d1, d2])
      expect(mockPrisma.deliveryEvent.findMany).toHaveBeenCalledWith({
        where: {
          deliveryId,
          courierId,
          type: EnumDeliveryEventType.ACCEPTED,
          transitionSuccessful: true,
        },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        select: { occurredAt: true },
      })
    })
  })

  describe('findRidersWhoAccepted (cross check 3)', () => {
    it('returns unique courier IDs who accepted delivery newest first', async () => {
      mockPrisma.deliveryEvent.findMany.mockResolvedValue([
        { courierId: 'c2' },
        { courierId: 'c1' },
        { courierId: 'c2' }, // duplicate should be filtered
      ])

      const riders = await repository.findRidersWhoAccepted(deliveryId)

      expect(riders).toEqual(['c2', 'c1'])
      expect(mockPrisma.deliveryEvent.findMany).toHaveBeenCalledWith({
        where: {
          deliveryId,
          type: EnumDeliveryEventType.ACCEPTED,
          transitionSuccessful: true,
          courierId: { not: null },
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        select: { courierId: true },
      })
    })
  })

  describe('findRiderNames', () => {
    it('returns empty array when courierIds is empty without querying database', async () => {
      const names = await repository.findRiderNames([])
      expect(names).toEqual([])
      expect(mockPrisma.courier.findMany).not.toHaveBeenCalled()
    })

    it('returns mapped names in the order of the given ids', async () => {
      mockPrisma.courier.findMany.mockResolvedValue([
        { id: 'c1', firstName: 'Nikos', lastName: 'A' },
        { id: 'c2', firstName: 'Kostas', lastName: 'B' },
      ])

      const result = await repository.findRiderNames(['c2', 'c1'])
      expect(result).toEqual([
        { id: 'c2', name: 'Kostas B' },
        { id: 'c1', name: 'Nikos A' },
      ])
    })
  })

  describe('create', () => {
    const input: CreateComplaintInput = {
      deliveryId,
      filedBy: EnumComplaintFiledBy.RIDER,
      about: EnumComplaintAbout.RESTAURANT,
      category: EnumComplaintCategory.LONG_WAIT,
      text: 'Long wait',
      status: EnumComplaintStatus.OPEN,
      openFor: `RIDER:${courierId}:${deliveryId}:RESTAURANT`,
      filerCourierId: courierId,
    }

    it('creates row and returns complaint record on success', async () => {
      mockPrisma.complaint.create.mockResolvedValue({ id: complaintId, ...input })

      const record = await repository.create(input)

      expect(record).toBeDefined()
      expect(record?.id).toBe(complaintId)
      expect(mockPrisma.complaint.create).toHaveBeenCalledWith({
        data: input,
        include: expect.any(Object),
      })
    })

    it('returns null on Prisma unique constraint error (openFor collision)', async () => {
      const uniqueError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.3.1',
      })
      mockPrisma.complaint.create.mockRejectedValue(uniqueError)

      const record = await repository.create(input)
      expect(record).toBeNull()
    })
  })

  describe('reply (AC-5)', () => {
    it('conditionally updates row where status is AWAITING_REPLY and riderReply is null', async () => {
      mockPrisma.complaint.updateMany.mockResolvedValue({ count: 1 })

      const success = await repository.reply(complaintId, 'My explanation', null)

      expect(success).toBe(true)
      expect(mockPrisma.complaint.updateMany).toHaveBeenCalledWith({
        where: { id: complaintId, status: EnumComplaintStatus.AWAITING_REPLY, riderReply: null },
        data: {
          riderReply: 'My explanation',
          repliedAt: expect.any(Date),
          replyEnteredByUserId: null,
          status: EnumComplaintStatus.OPEN,
        },
      })
    })

    it('returns false when conditional update matches 0 rows', async () => {
      mockPrisma.complaint.updateMany.mockResolvedValue({ count: 0 })

      const success = await repository.reply(complaintId, 'My explanation', null)
      expect(success).toBe(false)
    })
  })

  describe('decide (AC-5)', () => {
    it('conditionally updates row where status is OPEN and clears openFor', async () => {
      mockPrisma.complaint.updateMany.mockResolvedValue({ count: 1 })

      const success = await repository.decide(complaintId, 'Outcome decided', 'admin-1')

      expect(success).toBe(true)
      expect(mockPrisma.complaint.updateMany).toHaveBeenCalledWith({
        where: { id: complaintId, status: EnumComplaintStatus.OPEN },
        data: {
          status: EnumComplaintStatus.DECIDED,
          outcome: 'Outcome decided',
          decidedAt: expect.any(Date),
          decidedByUserId: 'admin-1',
          openFor: null,
        },
      })
    })
  })

  describe('withdraw (AC-5, cross check 6)', () => {
    it('conditionally updates row where status is OPEN or AWAITING_REPLY', async () => {
      mockPrisma.complaint.updateMany.mockResolvedValue({ count: 1 })

      const success = await repository.withdraw(complaintId, 'Withdraw reason', 'admin-1')

      expect(success).toBe(true)
      expect(mockPrisma.complaint.updateMany).toHaveBeenCalledWith({
        where: {
          id: complaintId,
          status: { in: [EnumComplaintStatus.OPEN, EnumComplaintStatus.AWAITING_REPLY] },
        },
        data: {
          status: EnumComplaintStatus.WITHDRAWN,
          withdrawnReason: 'Withdraw reason',
          withdrawnAt: expect.any(Date),
          withdrawnByUserId: 'admin-1',
          openFor: null,
        },
      })
    })
  })

  describe('pagination & listings (AC-6, AC-7)', () => {
    it('findPageForCourier queries where filerCourierId OR aboutCourierId matches courier with take = perPage + 1 and no count (AC-8)', async () => {
      // Mock 16 items for perPage: 15 (indicates hasMore: true)
      const fakeRows = Array.from({ length: 16 }, (_, i) => ({ id: `comp-${i}` }))
      mockPrisma.complaint.findMany.mockResolvedValue(fakeRows)

      const result = await repository.findPageForCourier(courierId, { page: 2, perPage: 15 })

      // Queries 1 extra item to check whether older page exists
      expect(mockPrisma.complaint.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { OR: [{ filerCourierId: courierId }, { aboutCourierId: courierId }] },
          take: 16,
          skip: 15,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        })
      )

      // AC-8: Never counts complaints per rider
      expect(mockPrisma.complaint.count).not.toHaveBeenCalled()

      // Truncates 16th item and reports hasMore: true
      expect(result.data).toHaveLength(15)
      expect(result.data[0]).toEqual({ id: 'comp-0' })
      expect(result.data[14]).toEqual({ id: 'comp-14' })
      expect(result.page).toBe(2)
      expect(result.perPage).toBe(15)
      expect(result.hasMore).toBe(true)
      // Must not return total or totalItems
      expect((result as any).total).toBeUndefined()
      expect((result as any).totalItems).toBeUndefined()
    })

    it('findPageForCourier returns hasMore: false when items do not exceed perPage', async () => {
      const fakeRows = [{ id: 'comp-1' }, { id: 'comp-2' }]
      mockPrisma.complaint.findMany.mockResolvedValue(fakeRows)

      const result = await repository.findPageForCourier(courierId, { page: 1, perPage: 20 })

      expect(mockPrisma.complaint.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 21,
          skip: 0,
        })
      )
      expect(result.data).toHaveLength(2)
      expect(result.hasMore).toBe(false)
      expect(result.page).toBe(1)
      expect(result.perPage).toBe(20)
    })

    it('findPageForCourier uses default page 1 and perPage 20 when options are empty', async () => {
      mockPrisma.complaint.findMany.mockResolvedValue([])

      const result = await repository.findPageForCourier(courierId, {})

      expect(mockPrisma.complaint.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 21,
          skip: 0,
        })
      )
      expect(result.page).toBe(1)
      expect(result.perPage).toBe(20)
      expect(result.hasMore).toBe(false)
    })

    it('findPageForPartner queries by filerPartnerId and optional deliveryId', async () => {
      await repository.findPageForPartner(partnerId, deliveryId, { page: 1, perPage: 20 })

      expect(mockPrisma.complaint.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { filerPartnerId: partnerId, deliveryId },
          take: 20,
          skip: 0,
        })
      )
    })

    it('findPageForAdmin queries by status and about filters (AC-6)', async () => {
      await repository.findPageForAdmin(
        { status: EnumComplaintStatus.AWAITING_REPLY, about: EnumComplaintAbout.RIDER },
        { page: 1, perPage: 10 }
      )

      expect(mockPrisma.complaint.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: EnumComplaintStatus.AWAITING_REPLY, about: EnumComplaintAbout.RIDER },
          take: 10,
          skip: 0,
        })
      )
    })
  })
})
