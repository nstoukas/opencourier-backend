import { Prisma } from '@prisma/types'
import { PrismaService } from 'src/services/prisma/prisma.service'
import { ACTIVE_SOS_WHERE } from 'src/domains/sos/sos-incident-state'
import {
  NewSosPoint,
  SosIncidentRepository,
} from './sos-incident.repository'

describe('SosIncidentRepository', () => {
  let repository: SosIncidentRepository
  let mockPrisma: any
  let mockTx: any

  const courierId = 'courier-volos-1'
  const clientId = 'sos-client-uuid-1'
  const startedAt = new Date('2026-11-03T10:00:00.000Z')

  beforeEach(() => {
    mockTx = {
      $queryRaw: jest.fn(),
      sosIncident: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
        delete: jest.fn(),
      },
      sosLocationPoint: {
        createMany: jest.fn(),
        deleteMany: jest.fn(),
      },
    }

    mockPrisma = {
      $transaction: jest.fn(async (cb: (tx: any) => Promise<any>) => cb(mockTx)),
      $queryRaw: jest.fn(),
      sosIncident: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        updateMany: jest.fn(),
      },
      sosLocationPoint: {
        findMany: jest.fn(),
      },
    }

    repository = new SosIncidentRepository(mockPrisma as unknown as PrismaService)
  })

  describe('startOrReturn (Pin 2, AC-4, Spec 0022 Data model sketch)', () => {
    test('locks courier row first with SELECT ... FOR UPDATE before any incident check', async () => {
      mockTx.$queryRaw.mockResolvedValueOnce([])
      mockTx.sosIncident.findUnique.mockResolvedValueOnce(null)
      mockTx.sosIncident.findFirst.mockResolvedValueOnce(null)
      mockTx.sosIncident.create.mockResolvedValueOnce({
        id: 'sos-1',
        courierId,
        clientId,
        startedAt,
      })

      await repository.startOrReturn({
        courierId,
        clientId,
        deliveryId: null,
        startedAt,
      })

      expect(mockTx.$queryRaw).toHaveBeenCalledTimes(1)
      const [strings, ...values] = mockTx.$queryRaw.mock.calls[0]
      const rawText = Array.isArray(strings) ? strings.join('?') : (strings?.sql ?? '')
      expect(rawText).toContain('SELECT "id" FROM "Courier"')
      expect(rawText).toContain('FOR UPDATE')
      expect(values.length > 0 ? values : (strings?.values ?? [])).toContain(courierId)
    })

    test('returns existing incident with created: false when (courierId, clientId) matches, even if closed', async () => {
      mockTx.$queryRaw.mockResolvedValueOnce([])
      const closedIncident = {
        id: 'sos-closed',
        courierId,
        clientId,
        startedAt,
        closedAt: new Date('2026-11-03T10:05:00.000Z'),
      }
      mockTx.sosIncident.findUnique.mockResolvedValueOnce(closedIncident)

      const result = await repository.startOrReturn({
        courierId,
        clientId,
        deliveryId: null,
        startedAt,
      })

      expect(mockTx.sosIncident.findUnique).toHaveBeenCalledWith({
        where: { courierId_clientId: { courierId, clientId } },
      })
      expect(result).toEqual({ incident: closedIncident, created: false })
      expect(mockTx.sosIncident.findFirst).not.toHaveBeenCalled()
      expect(mockTx.sosIncident.create).not.toHaveBeenCalled()
    })

    test('returns active incident with created: false when clientId is new but courier has an active SOS', async () => {
      mockTx.$queryRaw.mockResolvedValueOnce([])
      mockTx.sosIncident.findUnique.mockResolvedValueOnce(null) // no clientId match
      const activeIncident = {
        id: 'sos-active',
        courierId,
        clientId: 'earlier-client-id',
        startedAt,
        closedAt: null,
        safeAt: null,
        falseAlarmAt: null,
      }
      mockTx.sosIncident.findFirst.mockResolvedValueOnce(activeIncident)

      const result = await repository.startOrReturn({
        courierId,
        clientId: 'new-client-id',
        deliveryId: null,
        startedAt,
      })

      expect(mockTx.sosIncident.findFirst).toHaveBeenCalledWith({
        where: { courierId, ...ACTIVE_SOS_WHERE },
        orderBy: { startedAt: 'desc' },
      })
      expect(result).toEqual({ incident: activeIncident, created: false })
      expect(mockTx.sosIncident.create).not.toHaveBeenCalled()
    })

    test('creates new incident with created: true when neither clientId nor active incident matches', async () => {
      mockTx.$queryRaw.mockResolvedValueOnce([])
      mockTx.sosIncident.findUnique.mockResolvedValueOnce(null)
      mockTx.sosIncident.findFirst.mockResolvedValueOnce(null)
      const createdRecord = {
        id: 'sos-new',
        courierId,
        clientId,
        deliveryId: 'del-1',
        startedAt,
      }
      mockTx.sosIncident.create.mockResolvedValueOnce(createdRecord)

      const result = await repository.startOrReturn({
        courierId,
        clientId,
        deliveryId: 'del-1',
        startedAt,
      })

      expect(mockTx.sosIncident.create).toHaveBeenCalledWith({
        data: {
          courierId,
          clientId,
          deliveryId: 'del-1',
          startedAt,
        },
      })
      expect(result).toEqual({ incident: createdRecord, created: true })
    })

    test('evaluates clientId match BEFORE active incident check (order matters)', async () => {
      mockTx.$queryRaw.mockResolvedValueOnce([])
      const matchingClientIdIncident = { id: 'sos-by-client', courierId, clientId }
      mockTx.sosIncident.findUnique.mockResolvedValueOnce(matchingClientIdIncident)

      await repository.startOrReturn({
        courierId,
        clientId,
        deliveryId: null,
        startedAt,
      })

      // findUnique was called first, and findFirst was bypassed
      expect(mockTx.sosIncident.findUnique).toHaveBeenCalled()
      expect(mockTx.sosIncident.findFirst).not.toHaveBeenCalled()
    })
  })

  describe('addPointsIfActive (Pin 4, AC-5, AC-6)', () => {
    const incidentId = 'sos-inc-1'
    const newPoints: NewSosPoint[] = [
      {
        latitude: 39.362,
        longitude: 22.945,
        accuracyMetres: 12.5,
        recordedAt: new Date('2026-11-03T10:00:10.000Z'),
      },
    ]

    test('locks incident row with FOR UPDATE and returns null without writing when incident is not active', async () => {
      mockTx.$queryRaw.mockResolvedValueOnce([])
      mockTx.sosIncident.findFirst.mockResolvedValueOnce(null) // not active or does not exist

      const result = await repository.addPointsIfActive(incidentId, newPoints)

      expect(mockTx.$queryRaw).toHaveBeenCalledTimes(1)
      const [strings, ...values] = mockTx.$queryRaw.mock.calls[0]
      const rawText = Array.isArray(strings) ? strings.join('?') : (strings?.sql ?? '')
      expect(rawText).toContain('SELECT "id" FROM "SosIncident"')
      expect(rawText).toContain('FOR UPDATE')
      expect(mockTx.sosIncident.findFirst).toHaveBeenCalledWith({
        where: { id: incidentId, ...ACTIVE_SOS_WHERE },
        select: { id: true },
      })
      expect(result).toBeNull()
      expect(mockTx.sosLocationPoint.createMany).not.toHaveBeenCalled()
    })

    test('stores points with incidentId and returns count when incident is active', async () => {
      mockTx.$queryRaw.mockResolvedValueOnce([])
      mockTx.sosIncident.findFirst.mockResolvedValueOnce({ id: incidentId })
      mockTx.sosLocationPoint.createMany.mockResolvedValueOnce({ count: 1 })

      const result = await repository.addPointsIfActive(incidentId, newPoints)

      expect(result).toBe(1)
      expect(mockTx.sosLocationPoint.createMany).toHaveBeenCalledWith({
        data: [
          {
            latitude: 39.362,
            longitude: 22.945,
            accuracyMetres: 12.5,
            recordedAt: new Date('2026-11-03T10:00:10.000Z'),
            incidentId,
          },
        ],
      })
    })
  })

  describe('endByRiderIfActive (Pin 5, AC-6)', () => {
    test('updates safeAt conditionally on ACTIVE_SOS_WHERE and returns true on success', async () => {
      mockPrisma.sosIncident.updateMany.mockResolvedValueOnce({ count: 1 })
      const at = new Date('2026-11-03T10:02:00.000Z')

      const result = await repository.endByRiderIfActive('sos-1', 'safeAt', at)

      expect(result).toBe(true)
      expect(mockPrisma.sosIncident.updateMany).toHaveBeenCalledWith({
        where: { id: 'sos-1', ...ACTIVE_SOS_WHERE },
        data: { safeAt: at },
      })
    })

    test('returns false when conditional update matched 0 rows (lost race with close or end)', async () => {
      mockPrisma.sosIncident.updateMany.mockResolvedValueOnce({ count: 0 })
      const at = new Date('2026-11-03T10:02:00.000Z')

      const result = await repository.endByRiderIfActive('sos-1', 'falseAlarmAt', at)

      expect(result).toBe(false)
      expect(mockPrisma.sosIncident.updateMany).toHaveBeenCalledWith({
        where: { id: 'sos-1', ...ACTIVE_SOS_WHERE },
        data: { falseAlarmAt: at },
      })
    })
  })

  describe('closeIfOpen (Pin 6, AC-10)', () => {
    test('updates closedAt conditionally on closedAt: null and returns true when successful', async () => {
      mockPrisma.sosIncident.updateMany.mockResolvedValueOnce({ count: 1 })
      const closeData = {
        closedAt: new Date('2026-11-03T10:10:00.000Z'),
        closedByUserId: 'admin-user-1',
        outcome: 'RIDER_SAFE' as any,
        note: 'Admin verified rider is safe',
      }

      const result = await repository.closeIfOpen('sos-1', closeData)

      expect(result).toBe(true)
      expect(mockPrisma.sosIncident.updateMany).toHaveBeenCalledWith({
        where: { id: 'sos-1', closedAt: null },
        data: closeData,
      })
    })

    test('returns false when conditional update matched 0 rows (already closed)', async () => {
      mockPrisma.sosIncident.updateMany.mockResolvedValueOnce({ count: 0 })

      const result = await repository.closeIfOpen('sos-1', {
        closedAt: new Date(),
        closedByUserId: 'admin-1',
        outcome: 'OTHER' as any,
        note: null,
      })

      expect(result).toBe(false)
    })
  })

  describe('findCurrentWithPeople and findClosedPageWithPeople (Pin 6, AC-9)', () => {
    test('findCurrentWithPeople queries closedAt: null without pagination, newest first', async () => {
      mockPrisma.sosIncident.findMany.mockResolvedValueOnce([])

      await repository.findCurrentWithPeople()

      expect(mockPrisma.sosIncident.findMany).toHaveBeenCalledWith({
        where: { closedAt: null },
        include: {
          courier: { select: { id: true, firstName: true, lastName: true } },
          closedBy: { select: { id: true, email: true, username: true } },
        },
        orderBy: { startedAt: 'desc' },
      })
    })

    test('findClosedPageWithPeople queries closedAt: not null with correct skip and take', async () => {
      mockPrisma.sosIncident.count.mockResolvedValueOnce(25)
      mockPrisma.sosIncident.findMany.mockResolvedValueOnce([{ id: 'sos-closed-1' }])

      const result = await repository.findClosedPageWithPeople(2, 10)

      expect(mockPrisma.sosIncident.count).toHaveBeenCalledWith({
        where: { closedAt: { not: null } },
      })
      expect(mockPrisma.sosIncident.findMany).toHaveBeenCalledWith({
        where: { closedAt: { not: null } },
        include: {
          courier: { select: { id: true, firstName: true, lastName: true } },
          closedBy: { select: { id: true, email: true, username: true } },
        },
        orderBy: { startedAt: 'desc' },
        skip: 10,
        take: 10,
      })
      expect(result).toEqual({ data: [{ id: 'sos-closed-1' }], total: 25 })
    })
  })

  describe('deleteOldPoints (Pin 8, AC-11)', () => {
    const cutoff = new Date('2026-10-04T04:00:00.000Z')
    const now = new Date('2026-11-03T04:00:00.000Z')

    test('returns 0 and performs no deletions or updates when no incidents have newest point older than cutoff', async () => {
      mockTx.$queryRaw.mockResolvedValueOnce([])

      const result = await repository.deleteOldPoints(cutoff, now)

      expect(result).toBe(0)
      expect(mockTx.sosLocationPoint.deleteMany).not.toHaveBeenCalled()
      expect(mockTx.sosIncident.updateMany).not.toHaveBeenCalled()
    })

    test('deletes points and stamps pointsDeletedAt on incidents whose MAX recordedAt < cutoff in one transaction', async () => {
      mockTx.$queryRaw.mockResolvedValueOnce([
        { incidentId: 'sos-old-1' },
        { incidentId: 'sos-old-2' },
      ])
      mockTx.sosLocationPoint.deleteMany.mockResolvedValueOnce({ count: 50 })
      mockTx.sosIncident.updateMany.mockResolvedValueOnce({ count: 2 })

      const result = await repository.deleteOldPoints(cutoff, now)

      expect(result).toBe(2)
      // Check query raw structure
      const [strings, ...values] = mockTx.$queryRaw.mock.calls[0]
      const rawText = Array.isArray(strings) ? strings.join('?') : (strings?.sql ?? '')
      expect(rawText).toContain('SELECT "incidentId"')
      expect(rawText).toContain('FROM "SosLocationPoint"')
      expect(rawText).toContain('GROUP BY "incidentId"')
      expect(rawText).toContain('HAVING MAX("recordedAt") <')
      expect(values.length > 0 ? values : (strings?.values ?? [])).toContain(cutoff)

      // Points deleted for those incidents
      expect(mockTx.sosLocationPoint.deleteMany).toHaveBeenCalledWith({
        where: { incidentId: { in: ['sos-old-1', 'sos-old-2'] } },
      })

      // Incidents stamped with pointsDeletedAt = now
      expect(mockTx.sosIncident.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['sos-old-1', 'sos-old-2'] } },
        data: { pointsDeletedAt: now },
      })

      // Never deletes the incident row itself (AC-11)
      expect(mockTx.sosIncident.delete).not.toHaveBeenCalled()
      expect(mockTx.sosIncident.deleteMany).not.toHaveBeenCalled()
    })
  })
})
