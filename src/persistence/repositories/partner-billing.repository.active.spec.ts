import * as fs from 'fs'
import * as path from 'path'
import { PrismaService } from 'src/services/prisma/prisma.service'
import {
  BILL_INCLUDE,
  BILLING_CHARGE_SELECT,
  PartnerBillingRepository,
} from './partner-billing.repository'

describe('PartnerBillingRepository (Spec 0036, AC-5, AC-6, AC-7, AC-8, AC-9)', () => {
  let repository: PartnerBillingRepository
  let mockPrisma: any
  let mockTx: any

  const modelMock = () => ({
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  })

  beforeEach(() => {
    mockTx = {
      partnerBill: modelMock(),
      partnerCharge: modelMock(),
      deliveryEvent: modelMock(),
      deliveryRemovalRequest: modelMock(),
      partner: modelMock(),
    }
    mockPrisma = {
      $transaction: jest.fn((callback) => callback(mockTx)),
      partnerBill: modelMock(),
      partnerCharge: modelMock(),
      deliveryEvent: modelMock(),
      deliveryRemovalRequest: modelMock(),
      partner: modelMock(),
    }
    repository = new PartnerBillingRepository(mockPrisma as unknown as PrismaService)
  })

  describe('findChargesWrittenBetween', () => {
    it('queries charges in [start, end) range ordered oldest first with tiebreak', async () => {
      const start = new Date('2026-11-01T00:00:00Z')
      const end = new Date('2026-12-01T00:00:00Z')
      mockPrisma.partnerCharge.findMany.mockResolvedValue([])

      await repository.findChargesWrittenBetween(start, end)

      expect(mockPrisma.partnerCharge.findMany).toHaveBeenCalledWith({
        where: { createdAt: { gte: start, lt: end } },
        select: BILLING_CHARGE_SELECT,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    })

    it('narrows by partnerId when provided', async () => {
      const start = new Date('2026-11-01T00:00:00Z')
      const end = new Date('2026-12-01T00:00:00Z')
      mockPrisma.partnerCharge.findMany.mockResolvedValue([])

      await repository.findChargesWrittenBetween(start, end, 'partner-1')

      expect(mockPrisma.partnerCharge.findMany).toHaveBeenCalledWith({
        where: { createdAt: { gte: start, lt: end }, partnerId: 'partner-1' },
        select: BILLING_CHARGE_SELECT,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    })
  })

  describe('findUnbilledWrittenBefore', () => {
    it('queries unbilled charges (billId null) before date and maps createdAt', async () => {
      const before = new Date('2026-11-01T00:00:00Z')
      const d1 = new Date('2026-10-15T10:00:00Z')
      const d2 = new Date('2026-10-25T15:00:00Z')
      mockPrisma.partnerCharge.findMany.mockResolvedValue([{ createdAt: d1 }, { createdAt: d2 }])

      const result = await repository.findUnbilledWrittenBefore(before)

      expect(result).toEqual([d1, d2])
      expect(mockPrisma.partnerCharge.findMany).toHaveBeenCalledWith({
        where: { billId: null, createdAt: { lt: before } },
        select: { createdAt: true },
      })
    })

    it('narrows unbilled by partnerId when provided', async () => {
      const before = new Date('2026-11-01T00:00:00Z')
      mockPrisma.partnerCharge.findMany.mockResolvedValue([])

      await repository.findUnbilledWrittenBefore(before, 'partner-1')

      expect(mockPrisma.partnerCharge.findMany).toHaveBeenCalledWith({
        where: { billId: null, createdAt: { lt: before }, partnerId: 'partner-1' },
        select: { createdAt: true },
      })
    })
  })

  describe('findChargesByIds', () => {
    it('queries partnerCharge by id list selecting scope check columns', async () => {
      const ids = ['ch-1', 'ch-2']
      mockPrisma.partnerCharge.findMany.mockResolvedValue([])

      await repository.findChargesByIds(ids)

      expect(mockPrisma.partnerCharge.findMany).toHaveBeenCalledWith({
        where: { id: { in: ids } },
        select: { id: true, partnerId: true, createdAt: true, billId: true },
      })
    })
  })

  describe('findEventTimes', () => {
    it('returns empty map immediately when eventIds array is empty', async () => {
      const map = await repository.findEventTimes([])
      expect(map.size).toBe(0)
      expect(mockPrisma.deliveryEvent.findMany).not.toHaveBeenCalled()
    })

    it('queries deliveryEvent by ids and returns Map of id to occurredAt', async () => {
      const date1 = new Date('2026-11-10T12:00:00Z')
      mockPrisma.deliveryEvent.findMany.mockResolvedValue([{ id: 'evt-1', occurredAt: date1 }])

      const map = await repository.findEventTimes(['evt-1'])

      expect(map.get('evt-1')).toBe(date1)
      expect(mockPrisma.deliveryEvent.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['evt-1'] } },
        select: { id: true, occurredAt: true },
      })
    })
  })

  describe('findRemovalRequests', () => {
    it('returns empty map immediately when ids array is empty', async () => {
      const map = await repository.findRemovalRequests([])
      expect(map.size).toBe(0)
      expect(mockPrisma.deliveryRemovalRequest.findMany).not.toHaveBeenCalled()
    })

    it('queries deliveryRemovalRequest by ids and returns Map of id to decidedAt and label', async () => {
      const decidedAt = new Date('2026-11-10T14:00:00Z')
      mockPrisma.deliveryRemovalRequest.findMany.mockResolvedValue([
        { id: 'rem-1', decidedAt, label: 'Vehicle breakdown' },
      ])

      const map = await repository.findRemovalRequests(['rem-1'])

      expect(map.get('rem-1')).toEqual({ decidedAt, label: 'Vehicle breakdown' })
      expect(mockPrisma.deliveryRemovalRequest.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['rem-1'] } },
        select: { id: true, decidedAt: true, label: true },
      })
    })
  })

  describe('findPartner', () => {
    it('queries partner by id with name and pickupLocation', async () => {
      mockPrisma.partner.findUnique.mockResolvedValue(null)

      await repository.findPartner('partner-1')

      expect(mockPrisma.partner.findUnique).toHaveBeenCalledWith({
        where: { id: 'partner-1' },
        select: {
          id: true,
          name: true,
          pickupLocation: { select: { formattedAddress: true, addressLine1: true, city: true, zipCode: true } },
        },
      })
    })
  })

  describe('findBills & findBill', () => {
    it('findBills queries partnerBill by partnerId and month, newest first', async () => {
      mockPrisma.partnerBill.findMany.mockResolvedValue([])

      await repository.findBills('partner-1', '2026-11')

      expect(mockPrisma.partnerBill.findMany).toHaveBeenCalledWith({
        where: { partnerId: 'partner-1', month: '2026-11' },
        include: BILL_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
    })

    it('findBill queries partnerBill by id with BILL_INCLUDE', async () => {
      mockPrisma.partnerBill.findUnique.mockResolvedValue(null)

      await repository.findBill('bill-1')

      expect(mockPrisma.partnerBill.findUnique).toHaveBeenCalledWith({
        where: { id: 'bill-1' },
        include: BILL_INCLUDE,
      })
    })
  })

  describe('findBillCharges', () => {
    it('queries partnerCharge by billLines some billId, oldest first', async () => {
      mockPrisma.partnerCharge.findMany.mockResolvedValue([])

      await repository.findBillCharges('bill-1')

      expect(mockPrisma.partnerCharge.findMany).toHaveBeenCalledWith({
        where: { billLines: { some: { billId: 'bill-1' } } },
        select: BILLING_CHARGE_SELECT,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    })
  })

  describe('createBillIfAllUnbilled (AC-5, AC-6)', () => {
    const input = {
      partnerId: 'partner-1',
      month: '2026-11',
      reference: 'ΤΠΥ 41',
      chargeIds: ['ch-1', 'ch-2'],
      billedByUserId: 'admin-1',
      billedByLabel: 'admin@coop.gr',
    }

    const mockCreatedBill = { id: 'bill-1' }
    const mockFullBillRow = { id: 'bill-1', lines: [] }

    it('conditional update where includes billId: null to claim only unbilled charges', async () => {
      mockTx.partnerBill.create.mockResolvedValue(mockCreatedBill)
      mockTx.partnerCharge.updateMany.mockResolvedValue({ count: 2 })
      mockTx.partnerBill.findUniqueOrThrow.mockResolvedValue(mockFullBillRow)

      const result = await repository.createBillIfAllUnbilled(input)

      expect(result).toBe(mockFullBillRow)
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
      expect(mockTx.partnerBill.create).toHaveBeenCalledWith({
        data: {
          partnerId: 'partner-1',
          month: '2026-11',
          reference: 'ΤΠΥ 41',
          billedByUserId: 'admin-1',
          billedByLabel: 'admin@coop.gr',
          lines: { create: [{ chargeId: 'ch-1' }, { chargeId: 'ch-2' }] },
        },
      })
      expect(mockTx.partnerCharge.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['ch-1', 'ch-2'] }, billId: null },
        data: { billId: 'bill-1' },
      })
      expect(mockTx.partnerBill.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'bill-1' },
        include: BILL_INCLUDE,
      })
    })

    it('a count short of chargeIds.length rolls back transaction and returns null', async () => {
      mockTx.partnerBill.create.mockResolvedValue(mockCreatedBill)
      // Only 1 of 2 charges was claimed (lost race)
      mockTx.partnerCharge.updateMany.mockResolvedValue({ count: 1 })

      const result = await repository.createBillIfAllUnbilled(input)

      expect(result).toBeNull()
      expect(mockTx.partnerBill.findUniqueOrThrow).not.toHaveBeenCalled()
    })

    it('re-throws unexpected errors from transaction', async () => {
      mockTx.partnerBill.create.mockRejectedValue(new Error('DB disconnect'))

      await expect(repository.createBillIfAllUnbilled(input)).rejects.toThrow('DB disconnect')
    })
  })

  describe('undoBill (AC-7)', () => {
    const input = {
      billId: 'bill-1',
      undoneByUserId: 'admin-1',
      undoneByLabel: 'admin@coop.gr',
      undoReason: 'Mistake in invoice reference',
    }

    it('undoBill stamps only where undoneAt is null', async () => {
      mockTx.partnerBill.updateMany.mockResolvedValue({ count: 1 })
      mockTx.partnerCharge.updateMany.mockResolvedValue({ count: 2 })

      const result = await repository.undoBill(input)

      expect(result).toBe('UNDONE')
      expect(mockTx.partnerBill.updateMany).toHaveBeenCalledWith({
        where: { id: 'bill-1', undoneAt: null },
        data: {
          undoneAt: expect.any(Date),
          undoneByUserId: 'admin-1',
          undoneByLabel: 'admin@coop.gr',
          undoReason: 'Mistake in invoice reference',
        },
      })
    })

    it('clears billId on charges where billId = the bill', async () => {
      mockTx.partnerBill.updateMany.mockResolvedValue({ count: 1 })
      mockTx.partnerCharge.updateMany.mockResolvedValue({ count: 2 })

      const result = await repository.undoBill(input)

      expect(result).toBe('UNDONE')
      expect(mockTx.partnerCharge.updateMany).toHaveBeenCalledWith({
        where: { billId: 'bill-1' },
        data: { billId: null },
      })
    })

    it('answers ALREADY_UNDONE when stamped count is 0 and bill exists', async () => {
      mockTx.partnerBill.updateMany.mockResolvedValue({ count: 0 })
      mockTx.partnerBill.findUnique.mockResolvedValue({ id: 'bill-1' })

      const result = await repository.undoBill(input)

      expect(result).toBe('ALREADY_UNDONE')
      expect(mockTx.partnerBill.findUnique).toHaveBeenCalledWith({
        where: { id: 'bill-1' },
        select: { id: true },
      })
      expect(mockTx.partnerCharge.updateMany).not.toHaveBeenCalled()
    })

    it('answers NOT_FOUND when stamped count is 0 and bill does not exist', async () => {
      mockTx.partnerBill.updateMany.mockResolvedValue({ count: 0 })
      mockTx.partnerBill.findUnique.mockResolvedValue(null)

      const result = await repository.undoBill(input)

      expect(result).toBe('NOT_FOUND')
      expect(mockTx.partnerCharge.updateMany).not.toHaveBeenCalled()
    })
  })

  describe('Migration 20261118220000_add_partner_bills backfill (AC-12)', () => {
    it('the backfill reads minutes with substring(... "Waited (\\d+) min"), only for reason WAITING rows whose message matches (so a null message stays null), and the charge copy joins on waitOf and reason WAITING', () => {
      const sqlPath = path.resolve(
        __dirname,
        '../../../prisma/migrations/20261118220000_add_partner_bills/migration.sql'
      )
      const sql = fs.readFileSync(sqlPath, 'utf8')

      // Assert compensation update extracts digits using substring regex
      expect(sql).toMatch(
        /UPDATE\s+"CourierCompensation"\s+SET\s+"waitMinutes"\s*=\s*\(substring\("message"\s+from\s+'Waited \(\\d\+\) min'\)\)::int/
      )
      // Only for reason WAITING and message matching pattern (so null message stays null)
      expect(sql).toMatch(
        /WHERE\s+"reason"\s*=\s*'WAITING'\s+AND\s+"message"\s*~\s*'Waited \\d\+ min';/
      )

      // Assert partner charge update copies waitMinutes from CourierCompensation joined on waitOf and reason WAITING
      expect(sql).toMatch(
        /UPDATE\s+"PartnerCharge"\s+c\s+SET\s+"waitMinutes"\s*=\s*a\."waitMinutes"\s+FROM\s+"CourierCompensation"\s+a\s+WHERE\s+c\."waitOf"\s*=\s*a\."waitOf"\s+AND\s+c\."reason"\s*=\s*'WAITING';/
      )
    })
  })
})
