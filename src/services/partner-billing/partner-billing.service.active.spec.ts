import { Logger } from '@nestjs/common'
import { EnumPartnerChargeReason } from '@prisma/types'
import * as errors from 'src/errors'
import {
  BillingChargeRow,
  BillRow,
  PartnerBillingRepository,
} from 'src/persistence/repositories/partner-billing.repository'
import {
  PARTNER_BILL_MAX_CHARGES,
  PartnerBillingService,
} from './partner-billing.service'

describe('PartnerBillingService (Spec 0036, AC-1 to AC-14)', () => {
  let service: PartnerBillingService
  let mockRepo: jest.Mocked<PartnerBillingRepository>
  let loggerSpy: jest.SpyInstance

  const ADMIN = {
    id: 'admin-1',
    email: 'admin@coop.gr',
    username: 'admin',
  }

  const PARTNER_ID = 'partner-nosh'
  const MONTH = '2026-11'

  const mockPartner = {
    id: PARTNER_ID,
    name: 'Nosh',
    pickupLocation: {
      formattedAddress: 'Iasonos 45, Volos 38221',
      addressLine1: 'Iasonos 45',
      city: 'Volos',
      zipCode: '38221',
    },
  }

  const makeChargeRow = (overrides: Partial<BillingChargeRow> = {}): BillingChargeRow => ({
    id: 'charge-1',
    partnerId: PARTNER_ID,
    deliveryId: 'del-1',
    amount: 500,
    currencyCode: 'EUR',
    reason: EnumPartnerChargeReason.CANCELLATION,
    createdAt: new Date('2026-11-10T12:00:00Z'),
    billId: null,
    waitOf: null,
    removalOf: null,
    waitMinutes: null,
    partner: { name: 'Nosh' },
    delivery: { orderReference: 'ORD-101', cancelledAt: new Date('2026-11-10T11:55:00Z') },
    bill: null,
    ...overrides,
  })

  const makeBillRow = (overrides: Partial<BillRow> = {}): BillRow => ({
    id: 'bill-1',
    partnerId: PARTNER_ID,
    month: MONTH,
    reference: 'ΤΠΥ 41',
    billedByUserId: ADMIN.id,
    billedByLabel: 'admin@coop.gr',
    createdAt: new Date('2026-11-18T14:00:00Z'),
    undoneAt: null,
    undoneByUserId: null,
    undoneByLabel: null,
    undoReason: null,
    lines: [
      {
        charge: {
          id: 'charge-1',
          amount: 500,
          currencyCode: 'EUR',
        },
      },
    ],
    ...overrides,
  })

  beforeEach(() => {
    mockRepo = {
      findChargesWrittenBetween: jest.fn().mockResolvedValue([]),
      findUnbilledWrittenBefore: jest.fn().mockResolvedValue([]),
      findChargesByIds: jest.fn().mockResolvedValue([]),
      findEventTimes: jest.fn().mockResolvedValue(new Map()),
      findRemovalRequests: jest.fn().mockResolvedValue(new Map()),
      findPartner: jest.fn().mockResolvedValue(mockPartner),
      findBills: jest.fn().mockResolvedValue([]),
      findBill: jest.fn().mockResolvedValue(null),
      findBillCharges: jest.fn().mockResolvedValue([]),
      createBillIfAllUnbilled: jest.fn().mockResolvedValue(null),
      undoBill: jest.fn().mockResolvedValue('NOT_FOUND'),
    } as unknown as jest.Mocked<PartnerBillingRepository>

    service = new PartnerBillingService(mockRepo)
    loggerSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    loggerSpy.mockRestore()
  })

  describe('getMonthOverview (AC-1, AC-2, AC-4, AC-11, AC-13)', () => {
    it('refuses bad month string with BadRequestException', async () => {
      await expect(service.getMonthOverview('2026-13')).rejects.toThrow(errors.BadRequestException)
      await expect(service.getMonthOverview('26-11')).rejects.toThrow(errors.BadRequestException)
      await expect(service.getMonthOverview('abc')).rejects.toThrow(errors.BadRequestException)
      await expect(service.getMonthOverview('')).rejects.toThrow(errors.BadRequestException)
    })

    it('AC-1: overview lists restaurants with counts and totals, sorted by unbilled highest first then name', async () => {
      const chargeNosh1 = makeChargeRow({ id: 'c-n1', partnerId: 'p-nosh', partner: { name: 'Nosh' }, amount: 500, billId: null })
      const chargeNosh2 = makeChargeRow({ id: 'c-n2', partnerId: 'p-nosh', partner: { name: 'Nosh' }, amount: 300, billId: 'bill-n' })
      const chargeAlpha1 = makeChargeRow({ id: 'c-a1', partnerId: 'p-alpha', partner: { name: 'Alpha Cafe' }, amount: 1000, billId: null })
      const chargeBeta1 = makeChargeRow({ id: 'c-b1', partnerId: 'p-beta', partner: { name: 'Beta Burger' }, amount: 1000, billId: null })

      mockRepo.findChargesWrittenBetween.mockResolvedValue([chargeNosh1, chargeNosh2, chargeAlpha1, chargeBeta1])
      mockRepo.findUnbilledWrittenBefore.mockResolvedValue([
        new Date('2026-10-15T10:00:00Z'),
        new Date('2026-09-12T10:00:00Z'),
      ])

      const overview = await service.getMonthOverview(MONTH)

      expect(overview.month).toBe(MONTH)
      // Alpha and Beta have 1000 unbilled; sorted alphabetically among ties ('Alpha Cafe' before 'Beta Burger'),
      // then Nosh with 500 unbilled
      expect(overview.restaurants.map((r) => r.partnerName)).toEqual(['Alpha Cafe', 'Beta Burger', 'Nosh'])
      expect(overview.restaurants[0]?.totals).toEqual([
        { currencyCode: 'EUR', charged: 1000, billed: 0, unbilled: 1000 },
      ])
      expect(overview.restaurants[2]?.totals).toEqual([
        { currencyCode: 'EUR', charged: 800, billed: 300, unbilled: 500 },
      ])

      // earlierUnbilled groups by Athens month, oldest first
      expect(overview.earlierUnbilled).toEqual([
        { month: '2026-09', count: 1 },
        { month: '2026-10', count: 1 },
      ])
    })

    it('AC-1: partnerId narrows query and earlier unbilled to that restaurant', async () => {
      await service.getMonthOverview(MONTH, 'partner-specific')

      expect(mockRepo.findChargesWrittenBetween).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
        'partner-specific'
      )
      expect(mockRepo.findUnbilledWrittenBefore).toHaveBeenCalledWith(
        expect.any(Date),
        'partner-specific'
      )
    })

    it('decision 109.3 / AC-3: overview lines carry billId, bill object, happenedAt, and NO customer personal data', async () => {
      const waitEventTime = new Date('2026-11-10T11:40:00Z')
      const removalDecidedAt = new Date('2026-11-12T09:30:00Z')

      const chargeWait = makeChargeRow({
        id: 'c-wait',
        reason: EnumPartnerChargeReason.WAITING,
        waitOf: 'del-wait:evt-wait-end',
        waitMinutes: 12,
        billId: 'bill-open',
        bill: { id: 'bill-open', reference: 'INV-1', createdAt: new Date('2026-11-18T10:00:00Z') },
      })
      const chargeRemoval = makeChargeRow({
        id: 'c-rem',
        reason: EnumPartnerChargeReason.REMOVAL,
        removalOf: 'rem-req-1',
        billId: null,
        bill: null,
      })

      mockRepo.findChargesWrittenBetween.mockResolvedValue([chargeWait, chargeRemoval])
      mockRepo.findEventTimes.mockResolvedValue(new Map([['evt-wait-end', waitEventTime]]))
      mockRepo.findRemovalRequests.mockResolvedValue(
        new Map([['rem-req-1', { decidedAt: removalDecidedAt, label: 'Kitchen closed' }]])
      )

      const overview = await service.getMonthOverview(MONTH)

      expect(overview.charges).toHaveLength(2)

      const waitLine = overview.charges.find((c) => c.id === 'c-wait')!
      expect(waitLine.happenedAt).toEqual(waitEventTime)
      expect(waitLine.waitMinutes).toBe(12)
      expect(waitLine.removalLabel).toBeNull()
      expect(waitLine.billId).toBe('bill-open')
      expect(waitLine.bill).toEqual({ id: 'bill-open', reference: 'INV-1', createdAt: expect.any(Date) })

      const remLine = overview.charges.find((c) => c.id === 'c-rem')!
      expect(remLine.happenedAt).toEqual(removalDecidedAt)
      expect(remLine.removalLabel).toBe('Kitchen closed')
      expect(remLine.billId).toBeNull()
      expect(remLine.bill).toBeNull()

      // AC-13: no customer fields on any line
      for (const line of overview.charges) {
        expect((line as any).customerName).toBeUndefined()
        expect((line as any).dropoffPhoneNumber).toBeUndefined()
        expect((line as any).dropoffAddress).toBeUndefined()
        expect((line as any).formattedAddress).toBeUndefined()
      }
    })
  })

  describe('getPartnerMonth (AC-3, AC-4, AC-8)', () => {
    it('refuses bad month with BadRequestException', async () => {
      await expect(service.getPartnerMonth('invalid', PARTNER_ID)).rejects.toThrow(
        errors.BadRequestException
      )
    })

    it('throws NotFoundException when restaurant is not found', async () => {
      mockRepo.findPartner.mockResolvedValue(null)
      await expect(service.getPartnerMonth(MONTH, 'unknown-partner')).rejects.toThrow(
        errors.NotFoundException
      )
    })

    it('returns partner details, charges oldest first, bills newest first, and totals', async () => {
      const charge1 = makeChargeRow({ id: 'c-1', amount: 400, billId: 'bill-1' })
      const bill1 = makeBillRow({ id: 'bill-1' })

      mockRepo.findPartner.mockResolvedValue(mockPartner)
      mockRepo.findChargesWrittenBetween.mockResolvedValue([charge1])
      mockRepo.findBills.mockResolvedValue([bill1])

      const result = await service.getPartnerMonth(MONTH, PARTNER_ID)

      expect(result.partner).toEqual({ id: PARTNER_ID, name: 'Nosh' })
      expect(result.month).toBe(MONTH)
      expect(result.charges).toHaveLength(1)
      expect(result.charges[0]?.billId).toBe('bill-1')
      expect(result.bills).toHaveLength(1)
      expect(result.bills[0]?.id).toBe('bill-1')
      expect(result.totals).toEqual([
        { currencyCode: 'EUR', charged: 400, billed: 400, unbilled: 0 },
      ])
    })
  })

  describe('createBill (AC-5, AC-6, AC-14)', () => {
    const validArgs = {
      partnerId: PARTNER_ID,
      month: MONTH,
      chargeIds: ['c-1', 'c-2'],
      reference: '   ΤΠΥ 41   ',
    }

    it('refuses bad month with BadRequestException', async () => {
      await expect(
        service.createBill({ ...validArgs, month: '2026-13' }, ADMIN)
      ).rejects.toThrow(errors.BadRequestException)
    })

    it('refuses empty chargeIds or > 500 chargeIds with BadRequestException', async () => {
      await expect(
        service.createBill({ ...validArgs, chargeIds: [] }, ADMIN)
      ).rejects.toThrow(errors.BadRequestException)

      const tooMany = Array.from({ length: PARTNER_BILL_MAX_CHARGES + 1 }, (_, i) => `ch-${i}`)
      await expect(
        service.createBill({ ...validArgs, chargeIds: tooMany }, ADMIN)
      ).rejects.toThrow(errors.BadRequestException)
    })

    it('refuses duplicate chargeIds with BadRequestException', async () => {
      await expect(
        service.createBill({ ...validArgs, chargeIds: ['c-1', 'c-1'] }, ADMIN)
      ).rejects.toThrow(new errors.BadRequestException('A charge is listed twice.'))
    })

    it('trims reference: whitespace only means null, over 60 chars after trim throws 400', async () => {
      mockRepo.findPartner.mockResolvedValue(mockPartner)
      mockRepo.findChargesByIds.mockResolvedValue([
        { id: 'c-1', partnerId: PARTNER_ID, createdAt: new Date('2026-11-10T10:00:00Z'), billId: null },
      ])
      mockRepo.createBillIfAllUnbilled.mockResolvedValue(makeBillRow({ reference: null }))

      // Whitespace only reference becomes null
      await service.createBill({ ...validArgs, chargeIds: ['c-1'], reference: '    ' }, ADMIN)
      expect(mockRepo.createBillIfAllUnbilled).toHaveBeenCalledWith(
        expect.objectContaining({ reference: null })
      )

      // Over 60 characters after trim throws 400
      const longRef = 'a'.repeat(61)
      await expect(
        service.createBill({ ...validArgs, chargeIds: ['c-1'], reference: `  ${longRef}  ` }, ADMIN)
      ).rejects.toThrow(errors.BadRequestException)
    })

    it('throws NotFoundException when restaurant is not found', async () => {
      mockRepo.findPartner.mockResolvedValue(null)
      await expect(service.createBill(validArgs, ADMIN)).rejects.toThrow(errors.NotFoundException)
    })

    it('throws BadRequestException when a charge is unknown, of another restaurant, or of another Athens month', async () => {
      mockRepo.findPartner.mockResolvedValue(mockPartner)

      // Unknown charge (repo returned 1 row for 2 ids)
      mockRepo.findChargesByIds.mockResolvedValueOnce([
        { id: 'c-1', partnerId: PARTNER_ID, createdAt: new Date('2026-11-10T10:00:00Z'), billId: null },
      ])
      await expect(service.createBill(validArgs, ADMIN)).rejects.toThrow(
        new errors.BadRequestException("Some of these charges are not this restaurant's charges for this month.")
      )

      // Charge of another restaurant
      mockRepo.findChargesByIds.mockResolvedValueOnce([
        { id: 'c-1', partnerId: 'other-partner', createdAt: new Date('2026-11-10T10:00:00Z'), billId: null },
        { id: 'c-2', partnerId: PARTNER_ID, createdAt: new Date('2026-11-10T10:00:00Z'), billId: null },
      ])
      await expect(service.createBill(validArgs, ADMIN)).rejects.toThrow(errors.BadRequestException)

      // Charge of another Athens month (e.g. October)
      mockRepo.findChargesByIds.mockResolvedValueOnce([
        { id: 'c-1', partnerId: PARTNER_ID, createdAt: new Date('2026-10-31T20:00:00Z'), billId: null },
        { id: 'c-2', partnerId: PARTNER_ID, createdAt: new Date('2026-11-10T10:00:00Z'), billId: null },
      ])
      await expect(service.createBill(validArgs, ADMIN)).rejects.toThrow(errors.BadRequestException)
    })

    it('throws PartnerChargesAlreadyBilledException listing only already billed ids', async () => {
      mockRepo.findPartner.mockResolvedValue(mockPartner)
      mockRepo.findChargesByIds.mockResolvedValue([
        { id: 'c-1', partnerId: PARTNER_ID, createdAt: new Date('2026-11-10T10:00:00Z'), billId: 'existing-bill' },
        { id: 'c-2', partnerId: PARTNER_ID, createdAt: new Date('2026-11-10T10:00:00Z'), billId: null },
      ])

      try {
        await service.createBill(validArgs, ADMIN)
        fail('Should have thrown PartnerChargesAlreadyBilledException')
      } catch (err: any) {
        expect(err).toBeInstanceOf(errors.PartnerChargesAlreadyBilledException)
        expect(err.getResponse().alreadyBilled).toEqual(['c-1'])
      }
    })

    // Key invariant / check (c): when a 400 case and a billed charge occur together, 400 wins
    it('when a 400 case and a billed charge occur together, 400 wins', async () => {
      mockRepo.findPartner.mockResolvedValue(mockPartner)
      // c-wrong is another partner's (400), c-billed is already billed (409)
      mockRepo.findChargesByIds.mockResolvedValue([
        { id: 'c-wrong', partnerId: 'other-partner', createdAt: new Date('2026-11-10T10:00:00Z'), billId: null },
        { id: 'c-billed', partnerId: PARTNER_ID, createdAt: new Date('2026-11-10T10:00:00Z'), billId: 'existing-bill' },
      ])

      await expect(
        service.createBill({ ...validArgs, chargeIds: ['c-wrong', 'c-billed'] }, ADMIN)
      ).rejects.toThrow(errors.BadRequestException)
    })

    it('lost race: when repository transaction returns null, answers 409 with the ids now billed', async () => {
      mockRepo.findPartner.mockResolvedValue(mockPartner)
      // Initial check passed (both unbilled)
      mockRepo.findChargesByIds
        .mockResolvedValueOnce([
          { id: 'c-1', partnerId: PARTNER_ID, createdAt: new Date('2026-11-10T10:00:00Z'), billId: null },
          { id: 'c-2', partnerId: PARTNER_ID, createdAt: new Date('2026-11-10T10:00:00Z'), billId: null },
        ])
        // Re-read after lost race shows c-2 was taken by another bill
        .mockResolvedValueOnce([
          { id: 'c-1', partnerId: PARTNER_ID, createdAt: new Date('2026-11-10T10:00:00Z'), billId: null },
          { id: 'c-2', partnerId: PARTNER_ID, createdAt: new Date('2026-11-10T10:00:00Z'), billId: 'racing-bill' },
        ])
      mockRepo.createBillIfAllUnbilled.mockResolvedValue(null)

      try {
        await service.createBill(validArgs, ADMIN)
        fail('Should have thrown PartnerChargesAlreadyBilledException')
      } catch (err: any) {
        expect(err).toBeInstanceOf(errors.PartnerChargesAlreadyBilledException)
        expect(err.getResponse().alreadyBilled).toEqual(['c-2'])
      }
    })

    it('when the repository returns null after a conflict and the reread shows a charge now billed, createBill throws PartnerChargesAlreadyBilledException with that id', async () => {
      mockRepo.findPartner.mockResolvedValue(mockPartner)
      mockRepo.findChargesByIds
        .mockResolvedValueOnce([
          { id: 'c-1', partnerId: PARTNER_ID, createdAt: new Date('2026-11-10T10:00:00Z'), billId: null },
          { id: 'c-2', partnerId: PARTNER_ID, createdAt: new Date('2026-11-10T10:00:00Z'), billId: null },
        ])
        .mockResolvedValueOnce([
          { id: 'c-1', partnerId: PARTNER_ID, createdAt: new Date('2026-11-10T10:00:00Z'), billId: 'other-bill' },
          { id: 'c-2', partnerId: PARTNER_ID, createdAt: new Date('2026-11-10T10:00:00Z'), billId: null },
        ])
      mockRepo.createBillIfAllUnbilled.mockResolvedValue(null)

      try {
        await service.createBill(validArgs, ADMIN)
        fail('Should have thrown PartnerChargesAlreadyBilledException')
      } catch (err: any) {
        expect(err).toBeInstanceOf(errors.PartnerChargesAlreadyBilledException)
        expect(err.getResponse().alreadyBilled).toEqual(['c-1'])
      }
    })

    it('AC-5, AC-14: happy path writes bill with billedByLabel = email ?? username ?? id and logs info line', async () => {
      mockRepo.findPartner.mockResolvedValue(mockPartner)
      mockRepo.findChargesByIds.mockResolvedValue([
        { id: 'c-1', partnerId: PARTNER_ID, createdAt: new Date('2026-11-10T10:00:00Z'), billId: null },
        { id: 'c-2', partnerId: PARTNER_ID, createdAt: new Date('2026-11-10T10:00:00Z'), billId: null },
      ])
      const createdBill = makeBillRow({
        id: 'bill-100',
        reference: 'ΤΠΥ 41',
        lines: [
          { charge: { id: 'c-1', amount: 300, currencyCode: 'EUR' } },
          { charge: { id: 'c-2', amount: 200, currencyCode: 'EUR' } },
        ],
      })
      mockRepo.createBillIfAllUnbilled.mockResolvedValue(createdBill)

      const result = await service.createBill(validArgs, ADMIN)

      expect(mockRepo.createBillIfAllUnbilled).toHaveBeenCalledWith({
        partnerId: PARTNER_ID,
        month: MONTH,
        reference: 'ΤΠΥ 41',
        chargeIds: ['c-1', 'c-2'],
        billedByUserId: 'admin-1',
        billedByLabel: 'admin@coop.gr',
      })

      expect(result.id).toBe('bill-100')
      expect(result.lineCount).toBe(2)
      expect(result.totals).toEqual([{ currencyCode: 'EUR', amount: 500 }])

      // AC-14 log line: PARTNER_BILL_CREATED with billId, partnerId, adminUserId, lineCount, and nothing else
      expect(loggerSpy).toHaveBeenCalledWith(
        `PARTNER_BILL_CREATED ${JSON.stringify({
          billId: 'bill-100',
          partnerId: PARTNER_ID,
          adminUserId: 'admin-1',
          lineCount: 2,
        })}`
      )
    })
  })

  describe('undoBill (AC-7, AC-14)', () => {
    it('refuses empty reason or reason > 300 characters after trim with BadRequestException', async () => {
      await expect(service.undoBill('bill-1', '   ', ADMIN)).rejects.toThrow(
        errors.BadRequestException
      )
      const longReason = 'x'.repeat(301)
      await expect(service.undoBill('bill-1', longReason, ADMIN)).rejects.toThrow(
        errors.BadRequestException
      )
    })

    it('maps repository NOT_FOUND to NotFoundException', async () => {
      mockRepo.undoBill.mockResolvedValue('NOT_FOUND')
      await expect(service.undoBill('unknown-bill', 'Mistake', ADMIN)).rejects.toThrow(
        errors.NotFoundException
      )
    })

    it('maps repository ALREADY_UNDONE to PartnerBillAlreadyUndoneException (409)', async () => {
      mockRepo.undoBill.mockResolvedValue('ALREADY_UNDONE')
      await expect(service.undoBill('bill-1', 'Mistake', ADMIN)).rejects.toThrow(
        errors.PartnerBillAlreadyUndoneException
      )
    })

    it('happy path undid bill logs info line and returns updated bill view', async () => {
      mockRepo.undoBill.mockResolvedValue('UNDONE')
      const undoneBill = makeBillRow({
        id: 'bill-1',
        undoneAt: new Date('2026-11-18T15:00:00Z'),
        undoneByLabel: 'admin@coop.gr',
        undoReason: 'Duplicate invoice entered',
      })
      mockRepo.findBill.mockResolvedValue(undoneBill)

      const result = await service.undoBill('bill-1', '  Duplicate invoice entered  ', ADMIN)

      expect(result.undoneAt).toEqual(expect.any(Date))
      expect(result.undoReason).toBe('Duplicate invoice entered')

      // AC-14 log line: PARTNER_BILL_UNDONE with billId, partnerId, adminUserId, lineCount, and nothing else
      expect(loggerSpy).toHaveBeenCalledWith(
        `PARTNER_BILL_UNDONE ${JSON.stringify({
          billId: 'bill-1',
          partnerId: PARTNER_ID,
          adminUserId: 'admin-1',
          lineCount: 1,
        })}`
      )
    })
  })

  describe('getStatement (AC-9, Decision 109.3)', () => {
    it('throws NotFoundException when bill is not found', async () => {
      mockRepo.findBill.mockResolvedValue(null)
      await expect(service.getStatement('unknown-bill')).rejects.toThrow(errors.NotFoundException)
    })

    it('throws NotFoundException when restaurant is not found', async () => {
      mockRepo.findBill.mockResolvedValue(makeBillRow())
      mockRepo.findPartner.mockResolvedValue(null)
      await expect(service.getStatement('bill-1')).rejects.toThrow(errors.NotFoundException)
    })

    // AC-9 / Decision 109.3 / check (i): statement lines carry neither billId nor bill
    it('AC-9 statement: lines carry neither billId nor bill fields', async () => {
      const chargeRow = makeChargeRow({
        id: 'c-1',
        amount: 500,
        currencyCode: 'EUR',
        billId: 'bill-1',
        bill: { id: 'bill-1', reference: 'ΤΠΥ 41', createdAt: new Date('2026-11-18T14:00:00Z') },
      })
      const billRow = makeBillRow({ id: 'bill-1' })

      mockRepo.findBill.mockResolvedValue(billRow)
      mockRepo.findPartner.mockResolvedValue(mockPartner)
      mockRepo.findBillCharges.mockResolvedValue([chargeRow])

      const statement = await service.getStatement('bill-1')

      expect(statement.partner).toEqual({
        name: 'Nosh',
        pickupAddress: 'Iasonos 45, Volos 38221',
      })
      expect(statement.month).toBe(MONTH)
      expect(statement.lines).toHaveLength(1)

      const line = statement.lines[0]!
      expect(line.id).toBe('c-1')
      expect(line.amount).toBe(500)
      // Must NOT carry billId or bill
      expect(line).not.toHaveProperty('billId')
      expect(line).not.toHaveProperty('bill')
    })

    it('pickupAddress is null when partner has no pickup location', async () => {
      mockRepo.findBill.mockResolvedValue(makeBillRow())
      mockRepo.findPartner.mockResolvedValue({ id: PARTNER_ID, name: 'Nosh', pickupLocation: null })
      mockRepo.findBillCharges.mockResolvedValue([])

      const statement = await service.getStatement('bill-1')
      expect(statement.partner.pickupAddress).toBeNull()
    })
  })
})
