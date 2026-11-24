import * as fs from 'fs'
import * as path from 'path'
import { DeliveryEventRepository } from './delivery-event.repository'
import { PrismaService } from '../../services/prisma/prisma.service'
import { DeliveryEventEntity } from 'src/domains/delivery-event/entities/delivery-event.entity'
import { TAP_FLOOR_EVENT_TYPES } from 'src/domains/delivery-event/utils/occurred-at.util'
import { EnumDeliveryEventSource, EnumDeliveryEventType, EnumDeliveryStatus, EnumEventActor } from '@prisma/types'

describe('DeliveryEventRepository', () => {
  let repository: DeliveryEventRepository
  let mockPrisma: {
    deliveryEvent: {
      findMany: jest.Mock
      findFirst: jest.Mock
    }
  }

  const mockDeliveryId = 'cms57718o0007np9uq4ayigd4'
  const mockCourierId = 'courier-42'

  beforeEach(() => {
    // Construct hand-rolled fake PrismaService with mocked deliveryEvent methods
    mockPrisma = {
      deliveryEvent: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    }

    repository = new DeliveryEventRepository(mockPrisma as unknown as PrismaService)
  })

  describe('findManyByDeliveryId', () => {
    test('queries by delivery, ordered oldest first with a deterministic tie-break', async () => {
      await repository.findManyByDeliveryId(mockDeliveryId)

      // Assert Prisma findMany query parameters pin delivery filtering and deterministic ordering
      expect(mockPrisma.deliveryEvent.findMany).toHaveBeenCalledTimes(1)
      expect(mockPrisma.deliveryEvent.findMany).toHaveBeenCalledWith({
        where: { deliveryId: mockDeliveryId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    })

    test('rows come back as DeliveryEventEntity instances', async () => {
      // Setup raw Prisma database records returned by query
      const rawRows = [
        {
          id: 'evt-1',
          deliveryId: mockDeliveryId,
          type: EnumDeliveryEventType.CREATED,
          actor: EnumEventActor.PARTNER,
          eventSource: EnumDeliveryEventSource.PARTNER_APP,
          oldStatus: EnumDeliveryStatus.CREATED,
          newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          transitionSuccessful: true,
          message: null,
          occurredAt: new Date('2026-07-28T21:58:51.940Z'),
          createdAt: new Date('2026-07-28T21:58:51.940Z'),
          updatedAt: new Date('2026-07-28T21:58:51.940Z'),
        },
        {
          id: 'evt-2',
          deliveryId: mockDeliveryId,
          type: EnumDeliveryEventType.DISPATCHED,
          actor: EnumEventActor.ADMIN,
          eventSource: EnumDeliveryEventSource.OPENCOURIER,
          oldStatus: EnumDeliveryStatus.DISPATCHED,
          newStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          transitionSuccessful: false,
          message: 'Courier ID is required for dispatching',
          occurredAt: new Date('2026-07-28T22:00:00.000Z'),
          createdAt: new Date('2026-07-28T22:00:00.000Z'),
          updatedAt: new Date('2026-07-28T22:00:00.000Z'),
        },
      ]

      mockPrisma.deliveryEvent.findMany.mockResolvedValue(rawRows)

      const result = await repository.findManyByDeliveryId(mockDeliveryId)

      // Assert returned objects are instance of DeliveryEventEntity domain class
      expect(result).toHaveLength(2)
      expect(result[0]).toBeInstanceOf(DeliveryEventEntity)
      expect(result[0]?.eventSource).toBe(EnumDeliveryEventSource.PARTNER_APP)
      expect(result[0]?.transitionSuccessful).toBe(true)

      expect(result[1]).toBeInstanceOf(DeliveryEventEntity)
      expect(result[1]?.transitionSuccessful).toBe(false)
      expect(result[1]?.message).toBe('Courier ID is required for dispatching')
    })
  })

  describe('findLatestJobStepOccurredAt (Spec 0009, AC-7)', () => {
    test('queries latest successful job step event ordered by occurredAt desc, returning its occurredAt', async () => {
      const stepOccurredAt = new Date('2026-10-31T11:45:00.000Z')
      mockPrisma.deliveryEvent.findFirst.mockResolvedValue({
        occurredAt: stepOccurredAt,
      })

      const result = await repository.findLatestJobStepOccurredAt(mockDeliveryId)

      expect(mockPrisma.deliveryEvent.findFirst).toHaveBeenCalledWith({
        where: {
          deliveryId: mockDeliveryId,
          transitionSuccessful: true,
          type: { in: TAP_FLOOR_EVENT_TYPES },
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        select: { occurredAt: true },
      })
      expect(result).toEqual(stepOccurredAt)
    })

    test('returns null when no successful job step event exists', async () => {
      mockPrisma.deliveryEvent.findFirst.mockResolvedValue(null)

      const result = await repository.findLatestJobStepOccurredAt(mockDeliveryId)

      expect(result).toBeNull()
    })
  })

  describe('Removal & Reassignment queries (Spec 0035, AC-18, AC-23)', () => {
    describe('hasSuccessfulReassignedWithMessage (AC-23)', () => {
      test('queries findFirst with transitionSuccessful true and the exact message', async () => {
        mockPrisma.deliveryEvent.findFirst.mockResolvedValue({ id: 'evt-reassign-1' })

        const result = await repository.hasSuccessfulReassignedWithMessage('del-1', 'Reassigned to rider 2')

        expect(mockPrisma.deliveryEvent.findFirst).toHaveBeenCalledWith({
          where: {
            deliveryId: 'del-1',
            type: EnumDeliveryEventType.REASSIGNED,
            transitionSuccessful: true,
            message: 'Reassigned to rider 2',
          },
          select: { id: true },
        })
        expect(result).toBe(true)
      })

      test('returns false when no matching row is found', async () => {
        mockPrisma.deliveryEvent.findFirst.mockResolvedValue(null)

        const result = await repository.hasSuccessfulReassignedWithMessage('del-1', 'Different message')

        expect(result).toBe(false)
      })
    })

    describe('hasSuccessfulRemovalApprovedSince (AC-18)', () => {
      test('queries findFirst with transitionSuccessful true and createdAt gte since', async () => {
        const since = new Date('2026-11-09T10:00:00.000Z')
        mockPrisma.deliveryEvent.findFirst.mockResolvedValue({ id: 'evt-approved-1' })

        const result = await repository.hasSuccessfulRemovalApprovedSince('del-1', since)

        expect(mockPrisma.deliveryEvent.findFirst).toHaveBeenCalledWith({
          where: {
            deliveryId: 'del-1',
            type: EnumDeliveryEventType.REMOVAL_APPROVED,
            transitionSuccessful: true,
            createdAt: { gte: since },
          },
          select: { id: true },
        })
        expect(result).toBe(true)
      })

      test('returns false when no matching row is found', async () => {
        mockPrisma.deliveryEvent.findFirst.mockResolvedValue(null)

        const result = await repository.hasSuccessfulRemovalApprovedSince('del-1', new Date())

        expect(result).toBe(false)
      })
    })

    describe('findMessagesOfType', () => {
      test('queries findMany matching deliveryId and type with message selected, mapping null messages to empty string', async () => {
        mockPrisma.deliveryEvent.findMany.mockResolvedValueOnce([{ message: 'first' }, { message: null }])

        const result = await repository.findMessagesOfType('del-1', EnumDeliveryEventType.COURIER_PAID_FOR_REMOVAL)

        expect(mockPrisma.deliveryEvent.findMany).toHaveBeenCalledWith({
          where: {
            deliveryId: 'del-1',
            type: EnumDeliveryEventType.COURIER_PAID_FOR_REMOVAL,
          },
          select: { message: true },
        })
        expect(result).toEqual(['first', ''])
      })
    })
  })

  describe('Row 149: Add on left queries (findLatestAddOnJoinOf, hasAddOnLeftSince)', () => {
    describe('findLatestAddOnJoinOf', () => {
      test('queries findFirst with type ADD_ON_JOINED and messageParams addOnId, ordered newest first', async () => {
        const rawRow = {
          id: 'evt-join-1',
          deliveryId: 'job-1',
          type: EnumDeliveryEventType.ADD_ON_JOINED,
          courierId: 'courier-1',
          actor: EnumEventActor.SYSTEM,
          eventSource: EnumDeliveryEventSource.OPENCOURIER,
          oldStatus: EnumDeliveryStatus.ACCEPTED,
          newStatus: EnumDeliveryStatus.ACCEPTED,
          transitionSuccessful: true,
          message: 'Delivery del-addon-1 was added to this job',
          messageCode: 'ADD_ON_JOINED',
          messageParams: { courierId: 'courier-1', addOnId: 'del-addon-1' },
          occurredAt: new Date('2026-11-24T10:00:00.000Z'),
          createdAt: new Date('2026-11-24T10:00:00.000Z'),
          updatedAt: new Date('2026-11-24T10:00:00.000Z'),
        }
        mockPrisma.deliveryEvent.findFirst.mockResolvedValue(rawRow)

        const result = await repository.findLatestAddOnJoinOf('del-addon-1')

        expect(mockPrisma.deliveryEvent.findFirst).toHaveBeenCalledWith({
          where: {
            type: EnumDeliveryEventType.ADD_ON_JOINED,
            messageParams: { path: ['addOnId'], equals: 'del-addon-1' },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        })
        expect(result).toBeInstanceOf(DeliveryEventEntity)
        expect(result?.id).toBe('evt-join-1')
        expect(result?.deliveryId).toBe('job-1')
        expect(result?.courierId).toBe('courier-1')
      })

      test('returns null when no matching ADD_ON_JOINED event exists', async () => {
        mockPrisma.deliveryEvent.findFirst.mockResolvedValue(null)

        const result = await repository.findLatestAddOnJoinOf('del-never-joined')

        expect(mockPrisma.deliveryEvent.findFirst).toHaveBeenCalledWith({
          where: {
            type: EnumDeliveryEventType.ADD_ON_JOINED,
            messageParams: { path: ['addOnId'], equals: 'del-never-joined' },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        })
        expect(result).toBeNull()
      })
    })

    describe('hasAddOnLeftSince', () => {
      test('queries findFirst with deliveryId, type ADD_ON_LEFT, addOnId path, and createdAt gte since', async () => {
        const since = new Date('2026-11-24T10:00:00.000Z')
        mockPrisma.deliveryEvent.findFirst.mockResolvedValue({ id: 'evt-left-1' })

        const result = await repository.hasAddOnLeftSince('job-1', 'del-addon-1', since)

        expect(mockPrisma.deliveryEvent.findFirst).toHaveBeenCalledWith({
          where: {
            deliveryId: 'job-1',
            type: EnumDeliveryEventType.ADD_ON_LEFT,
            messageParams: { path: ['addOnId'], equals: 'del-addon-1' },
            createdAt: { gte: since },
          },
          select: { id: true },
        })
        expect(result).toBe(true)
      })

      test('returns false when no ADD_ON_LEFT event exists since that time', async () => {
        const since = new Date('2026-11-24T10:00:00.000Z')
        mockPrisma.deliveryEvent.findFirst.mockResolvedValue(null)

        const result = await repository.hasAddOnLeftSince('job-1', 'del-addon-1', since)

        expect(mockPrisma.deliveryEvent.findFirst).toHaveBeenCalledWith({
          where: {
            deliveryId: 'job-1',
            type: EnumDeliveryEventType.ADD_ON_LEFT,
            messageParams: { path: ['addOnId'], equals: 'del-addon-1' },
            createdAt: { gte: since },
          },
          select: { id: true },
        })
        expect(result).toBe(false)
      })
    })
  })

  describe('Migration 20261031200000_add_delivery_event_occurred_at (Spec 0009, AC-4, AC-9)', () => {
    test('backfills occurredAt from createdAt and creates index on (newStatus, occurredAt)', () => {
      const migrationFilePath = path.resolve(
        __dirname,
        '../../../prisma/migrations/20261031200000_add_delivery_event_occurred_at/migration.sql'
      )
      const sql = fs.readFileSync(migrationFilePath, 'utf8')

      // Assert column added with default
      expect(sql).toMatch(
        /ALTER TABLE "DeliveryEvent" ADD COLUMN "occurredAt" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP;/i
      )
      // Assert backfill copies createdAt so old events stay on their day
      expect(sql).toMatch(/UPDATE "DeliveryEvent" SET "occurredAt" = "createdAt";/i)
      // Assert index for earnings queries
      expect(sql).toMatch(
        /CREATE INDEX "DeliveryEvent_newStatus_occurredAt_idx" ON "DeliveryEvent"\("newStatus", "occurredAt"\);/i
      )
    })
  })
})
