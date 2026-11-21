import * as fs from 'fs'
import * as path from 'path'
import { EnumDeliveryEventType, EnumQuoteSource, EnumSplitRequestStatus } from '@prisma/types'
import { CourierCompensationRepository } from './courier-compensation.repository'
import { DeliveryEventRepository } from './delivery-event.repository'
import { PartnerChargeRepository } from './partner-charge.repository'
import { SplitRequestRepository } from './split-request.repository'

// Spec 0047 (row 11): the database side of a split at pickup. No test here runs SQL, so these check the
// queries each repository sends to Prisma, and the schema text for the unique keys the rules rest on.

// An error shaped like Prisma's "unique constraint failed" (P2002), which the repositories recognise.
const uniqueError = () => Object.assign(new Error('Unique constraint failed'), { name: 'PrismaClientKnownRequestError', code: 'P2002' })

describe('SplitRequestRepository (spec 0047)', () => {
  let prisma: any
  let repository: SplitRequestRepository

  beforeEach(() => {
    prisma = {
      splitRequest: {
        create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'split-1', ...data })),
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(0),
      },
      deliveryQuote: { findMany: jest.fn().mockResolvedValue([]) },
    }
    repository = new SplitRequestRepository(prisma)
  })

  describe('createOpen: at most one OPEN request per delivery (AC-1, decision 11.1)', () => {
    const input = { deliveryId: 'del-1', courierId: 'rider-1', proposedLegs: [{ boxSize: 'LARGE' }, { boxSize: 'SMALL' }] }

    it('creates the request OPEN with openFor set to the delivery id (the unique key that allows only one)', async () => {
      const created = await repository.createOpen(input)

      expect(prisma.splitRequest.create).toHaveBeenCalledWith({
        data: { ...input, status: EnumSplitRequestStatus.OPEN, openFor: 'del-1' },
      })
      expect(created).toMatchObject({ id: 'split-1', openFor: 'del-1', status: EnumSplitRequestStatus.OPEN })
    })

    it('answers null when the database refuses a second open request for the delivery', async () => {
      prisma.splitRequest.create.mockRejectedValue(uniqueError())
      await expect(repository.createOpen(input)).resolves.toBeNull()
    })

    it('lets any other database error through, so a real failure is not read as "already open"', async () => {
      prisma.splitRequest.create.mockRejectedValue(new Error('connection lost'))
      await expect(repository.createOpen(input)).rejects.toThrow('connection lost')
    })
  })

  describe('closeIfOpen: one winner (AC-9)', () => {
    it('writes only where the request is still OPEN, and clears openFor so a new request can be made', async () => {
      const answeredAt = new Date('2026-11-21T12:05:00.000Z')

      const won = await repository.closeIfOpen('split-1', { status: EnumSplitRequestStatus.REFUSED, answeredAt, answeredByUserId: 'admin-1' })

      expect(won).toBe(true)
      expect(prisma.splitRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'split-1', status: EnumSplitRequestStatus.OPEN },
        data: { status: EnumSplitRequestStatus.REFUSED, answeredAt, answeredByUserId: 'admin-1', openFor: null },
      })
    })

    it('answers false when someone else already closed it (no row matched)', async () => {
      prisma.splitRequest.updateMany.mockResolvedValue({ count: 0 })
      await expect(repository.closeIfOpen('split-1', { status: EnumSplitRequestStatus.CONFIRMED })).resolves.toBe(false)
    })

    it("writes through the transaction client when one is given, so a rollback undoes the claim too", async () => {
      const tx = { splitRequest: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } }

      await repository.closeIfOpen('split-1', { status: EnumSplitRequestStatus.CONFIRMED }, tx as any)

      expect(tx.splitRequest.updateMany).toHaveBeenCalledTimes(1)
      expect(prisma.splitRequest.updateMany).not.toHaveBeenCalled()
    })
  })

  it('findOpenForDelivery looks the request up by its openFor key', async () => {
    prisma.splitRequest.findUnique.mockResolvedValue({ id: 'split-1' })
    await expect(repository.findOpenForDelivery('del-1')).resolves.toEqual({ id: 'split-1' })
    expect(prisma.splitRequest.findUnique).toHaveBeenCalledWith({ where: { openFor: 'del-1' } })
  })

  describe('the admin queue (AC-4)', () => {
    it('lists OPEN requests only, oldest first, with the rider and the delivery', async () => {
      await repository.findOpenForQueue()

      const query = prisma.splitRequest.findMany.mock.calls[0][0]
      expect(query.where).toEqual({ status: EnumSplitRequestStatus.OPEN })
      expect(query.orderBy).toEqual({ createdAt: 'asc' })
      expect(query.include.courier.select).toEqual({ firstName: true, lastName: true })
      expect(query.include.delivery.select).toMatchObject({ pickupBusinessName: true, boxSize: true })
    })

    it('counts OPEN requests only', async () => {
      prisma.splitRequest.count.mockResolvedValue(3)
      await expect(repository.countOpen()).resolves.toBe(3)
      expect(prisma.splitRequest.count).toHaveBeenCalledWith({ where: { status: EnumSplitRequestStatus.OPEN } })
    })
  })

  describe('findNewestByCourierForDeliveries (the job list, AC-2, AC-7)', () => {
    it("reads only this rider's requests and keeps the newest per delivery", async () => {
      prisma.splitRequest.findMany.mockResolvedValue([
        { id: 'newer', deliveryId: 'del-1', createdAt: new Date('2026-11-21T12:10:00Z') },
        { id: 'older', deliveryId: 'del-1', createdAt: new Date('2026-11-21T12:00:00Z') },
        { id: 'other', deliveryId: 'del-2', createdAt: new Date('2026-11-21T12:05:00Z') },
      ])

      const result = await repository.findNewestByCourierForDeliveries('rider-1', ['del-1', 'del-2'])

      expect(prisma.splitRequest.findMany).toHaveBeenCalledWith({
        where: { courierId: 'rider-1', deliveryId: { in: ['del-1', 'del-2'] } },
        orderBy: { createdAt: 'desc' },
      })
      expect(result.map((row) => row.id).sort()).toEqual(['newer', 'other'])
    })

    it('asks nothing for an empty job list', async () => {
      await expect(repository.findNewestByCourierForDeliveries('rider-1', [])).resolves.toEqual([])
      expect(prisma.splitRequest.findMany).not.toHaveBeenCalled()
    })
  })

  describe('findOutcomesForDeliveries (what the restaurant is told, AC-8, AC-10)', () => {
    const deliveries = [
      { id: 'kept-leg', deliveryQuoteId: 'quote-1' },
      { id: 'new-leg', deliveryQuoteId: 'quote-split' },
      { id: 'left-order', deliveryQuoteId: 'quote-3' },
      { id: 'refused-order', deliveryQuoteId: 'quote-4' },
      { id: 'plain-order', deliveryQuoteId: 'quote-5' },
    ]

    it('SPLIT for the kept leg and for a leg the split made, LEFT for one the rider left, nothing otherwise', async () => {
      prisma.splitRequest.findMany.mockResolvedValue([
        { deliveryId: 'kept-leg', status: EnumSplitRequestStatus.CONFIRMED },
        { deliveryId: 'left-order', status: EnumSplitRequestStatus.LEFT },
      ])
      prisma.deliveryQuote.findMany.mockResolvedValue([{ id: 'quote-split' }])

      const outcomes = await repository.findOutcomesForDeliveries(deliveries)

      expect(outcomes.get('kept-leg')).toBe('SPLIT')
      expect(outcomes.get('new-leg')).toBe('SPLIT')
      expect(outcomes.get('left-order')).toBe('LEFT')
      expect(outcomes.has('refused-order')).toBe(false)
      expect(outcomes.has('plain-order')).toBe(false)
    })

    it('reads only CONFIRMED and LEFT requests: a refused, void or open request tells the restaurant nothing', async () => {
      await repository.findOutcomesForDeliveries(deliveries)

      const where = prisma.splitRequest.findMany.mock.calls[0][0].where
      expect(where.deliveryId).toEqual({ in: deliveries.map((delivery) => delivery.id) })
      expect([...where.status.in].sort()).toEqual([EnumSplitRequestStatus.CONFIRMED, EnumSplitRequestStatus.LEFT].sort())
      expect(prisma.deliveryQuote.findMany.mock.calls[0][0].where).toEqual({
        id: { in: deliveries.map((delivery) => delivery.deliveryQuoteId) },
        source: EnumQuoteSource.SPLIT,
      })
    })

    it('asks nothing for an empty list', async () => {
      const outcomes = await repository.findOutcomesForDeliveries([])
      expect(outcomes.size).toBe(0)
      expect(prisma.splitRequest.findMany).not.toHaveBeenCalled()
    })
  })
})

describe('the once only writers of the split wait and the split leg charge (spec 0047, AC-3, AC-11)', () => {
  const award = {
    amount: 70,
    currencyCode: 'EUR',
    reason: 'WAITING',
    policy: 'SPLIT_WAIT',
    message: 'Waited 7 min while dispatch split the order, at 10 cents a minute',
    waitMinutes: 7,
    courierId: 'rider-1',
    deliveryId: 'del-1',
    splitWaitOf: 'split-1',
  } as any
  const charge = {
    partnerId: 'partner-1',
    deliveryId: 'del-1',
    amount: 70,
    currencyCode: 'EUR',
    reason: 'WAITING',
    waitMinutes: 7,
    splitWaitOf: 'split-1',
  } as any

  describe('CourierCompensationRepository.createSplitWaitPayOnce', () => {
    it('writes the award with its splitWaitOf key', async () => {
      const prisma = { courierCompensation: { create: jest.fn().mockResolvedValue({ id: 'comp-1', ...award }), findUnique: jest.fn() } }
      const repository = new CourierCompensationRepository(prisma as any)

      await expect(repository.createSplitWaitPayOnce(award)).resolves.toMatchObject({ id: 'comp-1', splitWaitOf: 'split-1' })

      expect(prisma.courierCompensation.create).toHaveBeenCalledWith({ data: award })
    })

    it('a second write for the same split request pays nothing more: it hands back the row already there', async () => {
      const existing = { id: 'comp-first', ...award }
      const prisma = {
        courierCompensation: {
          create: jest.fn().mockRejectedValue(uniqueError()),
          findUnique: jest.fn().mockResolvedValue(existing),
        },
      }
      const repository = new CourierCompensationRepository(prisma as any)

      // The retry believes the wait was 9 minutes; the first write (7 minutes, 70 cents) stands.
      const result = await repository.createSplitWaitPayOnce({ ...award, amount: 90, waitMinutes: 9 })

      expect(result).toBe(existing)
      expect(result.amount).toBe(70)
      expect(prisma.courierCompensation.findUnique).toHaveBeenCalledWith({ where: { splitWaitOf: 'split-1' } })
      expect(prisma.courierCompensation.create).toHaveBeenCalledTimes(1)
    })

    it('lets any other database error through', async () => {
      const prisma = { courierCompensation: { create: jest.fn().mockRejectedValue(new Error('connection lost')), findUnique: jest.fn() } }
      await expect(new CourierCompensationRepository(prisma as any).createSplitWaitPayOnce(award)).rejects.toThrow('connection lost')
    })
  })

  describe('PartnerChargeRepository.createSplitWaitChargeOnce', () => {
    it('writes the charge with its splitWaitOf key', async () => {
      const prisma = { partnerCharge: { create: jest.fn().mockResolvedValue({ id: 'charge-1', ...charge }), findUnique: jest.fn() } }
      await new PartnerChargeRepository(prisma as any).createSplitWaitChargeOnce(charge)
      expect(prisma.partnerCharge.create).toHaveBeenCalledWith({ data: charge })
    })

    it('a second write for the same split request charges nothing more: it hands back the row already there', async () => {
      const existing = { id: 'charge-first', ...charge }
      const prisma = {
        partnerCharge: { create: jest.fn().mockRejectedValue(uniqueError()), findUnique: jest.fn().mockResolvedValue(existing) },
      }

      const result = await new PartnerChargeRepository(prisma as any).createSplitWaitChargeOnce({ ...charge, amount: 90 })

      expect(result).toBe(existing)
      expect(prisma.partnerCharge.findUnique).toHaveBeenCalledWith({ where: { splitWaitOf: 'split-1' } })
      expect(prisma.partnerCharge.create).toHaveBeenCalledTimes(1)
    })

    it('lets any other database error through', async () => {
      const prisma = { partnerCharge: { create: jest.fn().mockRejectedValue(new Error('connection lost')), findUnique: jest.fn() } }
      await expect(new PartnerChargeRepository(prisma as any).createSplitWaitChargeOnce(charge)).rejects.toThrow('connection lost')
    })
  })

  describe('PartnerChargeRepository.deleteUnbilledSplitLegCharge (cross check 5)', () => {
    const legCharge = { id: 'charge-leg', amount: 356, currencyCode: 'EUR', splitLegOf: 'new-leg-2', billId: null }

    it("deletes the leg's unbilled SPLIT_LEG charge and hands it back, so the event can name the amount", async () => {
      const prisma = {
        partnerCharge: { findUnique: jest.fn().mockResolvedValue(legCharge), deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      }

      const result = await new PartnerChargeRepository(prisma as any).deleteUnbilledSplitLegCharge('new-leg-2')

      expect(prisma.partnerCharge.findUnique).toHaveBeenCalledWith({ where: { splitLegOf: 'new-leg-2' } })
      expect(prisma.partnerCharge.deleteMany).toHaveBeenCalledWith({ where: { id: 'charge-leg', billId: null } })
      expect(result).toEqual(legCharge)
    })

    it('leaves a charge that is already on a bill, and answers null', async () => {
      const prisma = {
        partnerCharge: { findUnique: jest.fn().mockResolvedValue({ ...legCharge, billId: 'bill-1' }), deleteMany: jest.fn() },
      }
      await expect(new PartnerChargeRepository(prisma as any).deleteUnbilledSplitLegCharge('new-leg-2')).resolves.toBeNull()
      expect(prisma.partnerCharge.deleteMany).not.toHaveBeenCalled()
    })

    it('answers null for a delivery with no split leg charge (an ordinary order)', async () => {
      const prisma = { partnerCharge: { findUnique: jest.fn().mockResolvedValue(null), deleteMany: jest.fn() } }
      await expect(new PartnerChargeRepository(prisma as any).deleteUnbilledSplitLegCharge('plain-order')).resolves.toBeNull()
      expect(prisma.partnerCharge.deleteMany).not.toHaveBeenCalled()
    })

    it('answers null when the charge was billed between the read and the delete (nothing was removed)', async () => {
      const prisma = {
        partnerCharge: { findUnique: jest.fn().mockResolvedValue(legCharge), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      }
      await expect(new PartnerChargeRepository(prisma as any).deleteUnbilledSplitLegCharge('new-leg-2')).resolves.toBeNull()
    })
  })

  describe('DeliveryEventRepository.hasSuccessfulEvent', () => {
    it('looks for a successful event of the type on that delivery', async () => {
      const prisma = { deliveryEvent: { findFirst: jest.fn().mockResolvedValue({ id: 'evt-1' }) } }
      const repository = new DeliveryEventRepository(prisma as any)

      await expect(repository.hasSuccessfulEvent('new-leg-2', EnumDeliveryEventType.ACCEPTED)).resolves.toBe(true)

      expect(prisma.deliveryEvent.findFirst).toHaveBeenCalledWith({
        where: { deliveryId: 'new-leg-2', type: EnumDeliveryEventType.ACCEPTED, transitionSuccessful: true },
        select: { id: true },
      })
    })

    it('answers false when there is none', async () => {
      const prisma = { deliveryEvent: { findFirst: jest.fn().mockResolvedValue(null) } }
      await expect(new DeliveryEventRepository(prisma as any).hasSuccessfulEvent('new-leg-2', EnumDeliveryEventType.ACCEPTED)).resolves.toBe(false)
    })
  })
})

// The "once only" rules above hold only while the database has these unique keys. A test that reads the
// schema fails if one is ever dropped, which no mocked test could notice.
describe('schema.prisma keeps the unique keys the split rules rest on (spec 0047)', () => {
  const schema = fs.readFileSync(path.join(__dirname, '../../../prisma/schema.prisma'), 'utf8')

  // The text of one `model X { ... }` block.
  const model = (name: string): string => {
    const start = schema.indexOf(`model ${name} {`)
    expect(start).toBeGreaterThan(-1)
    return schema.slice(start, schema.indexOf('\n}', start))
  }
  // The line that declares a field in a model.
  const field = (modelName: string, fieldName: string): string =>
    model(modelName)
      .split('\n')
      .find((line) => line.trim().startsWith(`${fieldName} `)) ?? ''

  it('SplitRequest.openFor is unique: one open request per delivery', () => {
    expect(field('SplitRequest', 'openFor')).toContain('@unique')
  })

  it('CourierCompensation.splitWaitOf is unique: a split wait is paid once', () => {
    expect(field('CourierCompensation', 'splitWaitOf')).toContain('@unique')
  })

  it('PartnerCharge.splitWaitOf is unique: a split wait is charged once', () => {
    expect(field('PartnerCharge', 'splitWaitOf')).toContain('@unique')
  })

  it('PartnerCharge.splitLegOf is unique: a new leg is charged once', () => {
    expect(field('PartnerCharge', 'splitLegOf')).toContain('@unique')
  })

  it('the statuses and the charge reason exist', () => {
    const statuses = schema.slice(schema.indexOf('enum EnumSplitRequestStatus {'))
    for (const status of ['OPEN', 'CONFIRMED', 'REFUSED', 'LEFT', 'VOID']) {
      expect(statuses.slice(0, statuses.indexOf('}'))).toContain(status)
    }
    const reasons = schema.slice(schema.indexOf('enum EnumPartnerChargeReason {'))
    expect(reasons.slice(0, reasons.indexOf('}'))).toContain('SPLIT_LEG')
  })

  it('a quote is a restaurant quote unless marked SPLIT', () => {
    expect(field('DeliveryQuote', 'source')).toContain('@default(PARTNER)')
  })
})
