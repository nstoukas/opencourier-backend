import * as fs from 'fs'
import * as path from 'path'
import { DeliveryEventRepository } from './delivery-event.repository'
import { PrismaService } from '../../services/prisma/prisma.service'
import { DeliveryEventEntity } from 'src/domains/delivery-event/entities/delivery-event.entity'
import { TAP_FLOOR_EVENT_TYPES } from 'src/domains/delivery-event/utils/occurred-at.util'
import {
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
} from '@prisma/types'

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

  describe('Earnings queries with occurredAt (Spec 0009, AC-5)', () => {
    const from = new Date('2026-10-31T00:00:00.000Z')
    const to = new Date('2026-10-31T23:59:59.999Z')

    // Key case: occurredAt is earlier than createdAt (tapped at 23:50, received at 00:20)
    const mockOccurredAt = new Date('2026-10-31T23:50:00.000Z')
    const mockCreatedAt = new Date('2026-11-01T00:20:00.000Z')

    describe('findSuccessfulDropOffRowsForCourier', () => {
      test('filters by occurredAt in window, orders by occurredAt asc, and reports droppedOffAt = occurredAt', async () => {
        mockPrisma.deliveryEvent.findMany.mockResolvedValue([
          {
            deliveryId: 'del-1',
            occurredAt: mockOccurredAt,
            createdAt: mockCreatedAt, // Deliberately different from occurredAt
            delivery: {
              totalCompensation: 500,
              tips: 100,
            },
          },
        ])

        const rows = await repository.findSuccessfulDropOffRowsForCourier(mockCourierId, from, to)

        expect(mockPrisma.deliveryEvent.findMany).toHaveBeenCalledWith({
          where: {
            transitionSuccessful: true,
            newStatus: EnumDeliveryStatus.DROPPED_OFF,
            occurredAt: {
              gte: from,
              lte: to,
            },
            delivery: {
              is: {
                courierId: mockCourierId,
              },
            },
          },
          select: {
            deliveryId: true,
            occurredAt: true,
            delivery: {
              select: {
                totalCompensation: true,
                tips: true,
              },
            },
          },
          orderBy: {
            occurredAt: 'asc',
          },
        })

        expect(rows).toHaveLength(1)
        expect(rows[0]?.deliveryId).toBe('del-1')
        // CRITICAL: droppedOffAt must be occurredAt, NOT createdAt
        expect(rows[0]?.droppedOffAt).toEqual(mockOccurredAt)
        expect(rows[0]?.droppedOffAt).not.toEqual(mockCreatedAt)
        expect(rows[0]?.totalCompensation).toBe(500)
        expect(rows[0]?.tips).toBe(100)
      })
    })

    describe('findCompletedDeliveryRowsForCourier', () => {
      test('filters by occurredAt in window, orders by occurredAt asc, and reports droppedOffAt = occurredAt', async () => {
        mockPrisma.deliveryEvent.findMany.mockResolvedValue([
          {
            deliveryId: 'del-2',
            occurredAt: mockOccurredAt,
            createdAt: mockCreatedAt, // Deliberately different from occurredAt
            delivery: {
              totalCompensation: 650,
              tips: 50,
              pickupBusinessName: 'Pizza Bistro',
              dropoffLocation: {
                formattedAddress: 'Iasonos 12, Volos',
                street: 'Iasonos 12',
                city: 'Volos',
                state: null,
              },
            },
          },
        ])

        const rows = await repository.findCompletedDeliveryRowsForCourier(mockCourierId, from, to)

        expect(mockPrisma.deliveryEvent.findMany).toHaveBeenCalledWith({
          where: {
            transitionSuccessful: true,
            newStatus: EnumDeliveryStatus.DROPPED_OFF,
            occurredAt: {
              gte: from,
              lte: to,
            },
            delivery: {
              is: {
                courierId: mockCourierId,
              },
            },
          },
          select: {
            deliveryId: true,
            occurredAt: true,
            delivery: {
              select: {
                totalCompensation: true,
                tips: true,
                pickupBusinessName: true,
                dropoffLocation: {
                  select: {
                    formattedAddress: true,
                    street: true,
                    city: true,
                    state: true,
                  },
                },
              },
            },
          },
          orderBy: {
            occurredAt: 'asc',
          },
        })

        expect(rows).toHaveLength(1)
        expect(rows[0]?.deliveryId).toBe('del-2')
        // CRITICAL: droppedOffAt must be occurredAt, NOT createdAt
        expect(rows[0]?.droppedOffAt).toEqual(mockOccurredAt)
        expect(rows[0]?.droppedOffAt).not.toEqual(mockCreatedAt)
        expect(rows[0]?.totalCompensation).toBe(650)
        expect(rows[0]?.tips).toBe(50)
        expect(rows[0]?.pickupBusinessName).toBe('Pizza Bistro')
        expect(rows[0]?.dropoffAddress).toBe('Iasonos 12, Volos')
      })
    })

    describe('findCompletedDeliveryRowForCourierDelivery', () => {
      test('filters by deliveryId, orders by occurredAt asc, and reports droppedOffAt = occurredAt', async () => {
        mockPrisma.deliveryEvent.findMany.mockResolvedValue([
          {
            deliveryId: 'del-3',
            occurredAt: mockOccurredAt,
            createdAt: mockCreatedAt, // Deliberately different from occurredAt
            delivery: {
              totalCompensation: 450,
              tips: 0,
              pickupBusinessName: 'Souvlaki Corner',
              dropoffLocation: {
                formattedAddress: 'Ermou 45, Volos',
                street: 'Ermou 45',
                city: 'Volos',
                state: null,
              },
            },
          },
        ])

        const row = await repository.findCompletedDeliveryRowForCourierDelivery(mockCourierId, 'del-3')

        expect(mockPrisma.deliveryEvent.findMany).toHaveBeenCalledWith({
          where: {
            transitionSuccessful: true,
            newStatus: EnumDeliveryStatus.DROPPED_OFF,
            deliveryId: 'del-3',
            delivery: {
              is: {
                courierId: mockCourierId,
              },
            },
          },
          select: {
            deliveryId: true,
            occurredAt: true,
            delivery: {
              select: {
                totalCompensation: true,
                tips: true,
                pickupBusinessName: true,
                dropoffLocation: {
                  select: {
                    formattedAddress: true,
                    street: true,
                    city: true,
                    state: true,
                  },
                },
              },
            },
          },
          orderBy: {
            occurredAt: 'asc',
          },
          take: 1,
        })

        expect(row).not.toBeNull()
        // CRITICAL: droppedOffAt must be occurredAt, NOT createdAt
        expect(row?.droppedOffAt).toEqual(mockOccurredAt)
        expect(row?.droppedOffAt).not.toEqual(mockCreatedAt)
        expect(row?.deliveryId).toBe('del-3')
        expect(row?.totalCompensation).toBe(450)
      })

      test('returns null when no completed delivery row is found', async () => {
        mockPrisma.deliveryEvent.findMany.mockResolvedValue([])

        const row = await repository.findCompletedDeliveryRowForCourierDelivery(mockCourierId, 'del-unknown')

        expect(row).toBeNull()
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
      expect(sql).toMatch(/ALTER TABLE "DeliveryEvent" ADD COLUMN "occurredAt" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP;/i)
      // Assert backfill copies createdAt so old events stay on their day
      expect(sql).toMatch(/UPDATE "DeliveryEvent" SET "occurredAt" = "createdAt";/i)
      // Assert index for earnings queries
      expect(sql).toMatch(/CREATE INDEX "DeliveryEvent_newStatus_occurredAt_idx" ON "DeliveryEvent"\("newStatus", "occurredAt"\);/i)
    })
  })
})
