import { PartnerEntity } from './entities/partner.entity'
import { PartnerWaitRecordDomainService } from './partner-wait-record.domain.service'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { EnumCountryCode, EnumDeliveryEventType } from '@prisma/types'

// Spec 0030: PartnerWaitRecordDomainService (AC-1, AC-2, AC-6).
describe('PartnerWaitRecordDomainService (spec 0030)', () => {
  let service: PartnerWaitRecordDomainService
  let mockDeliveryRepository: jest.Mocked<DeliveryRepository>

  const NOW = new Date('2026-11-09T12:00:00.000Z')
  const DAY_MS = 24 * 60 * 60 * 1000

  const mockPartner = new PartnerEntity({
    id: 'partner-100',
    name: 'Volos Grill House',
    logo: null,
    phoneNumber: '+302421012345',
    webhookUrl: null,
    usualPrepMinutes: 20,
    busyExtraMinutes: null,
    pausedUntil: null,
    disabledAt: null,
    disabledReason: null,
    userId: 'user-100',
    pickupLocationId: 'loc-1',
    createdAt: new Date('2026-01-01T10:00:00Z'),
    updatedAt: new Date('2026-01-01T10:00:00Z'),
  })

  beforeEach(() => {
    mockDeliveryRepository = {
      findForWaitRecord: jest.fn(),
    } as unknown as jest.Mocked<DeliveryRepository>

    service = new PartnerWaitRecordDomainService(mockDeliveryRepository)
  })

  test('calculates rolling 24 hour cutoff since date and delegates to repository (AC-2)', async () => {
    const days = 30
    const expectedSince = new Date(NOW.getTime() - 30 * DAY_MS)
    mockDeliveryRepository.findForWaitRecord.mockResolvedValue([])

    const result = await service.getWaitRecord(mockPartner, days, NOW)

    expect(mockDeliveryRepository.findForWaitRecord).toHaveBeenCalledWith('partner-100', expectedSince)
    expect(result.days).toBe(30)
    expect(result.usualPrepMinutes).toBe(20)
    expect(result.orderCount).toBe(0)
  })

  test('handles 7 days rolling period cutoff correctly (AC-1, AC-2)', async () => {
    const days = 7
    const expectedSince = new Date(NOW.getTime() - 7 * DAY_MS)
    mockDeliveryRepository.findForWaitRecord.mockResolvedValue([])

    const result = await service.getWaitRecord(mockPartner, days, NOW)

    expect(mockDeliveryRepository.findForWaitRecord).toHaveBeenCalledWith('partner-100', expectedSince)
    expect(result.days).toBe(7)
  })

  test('handles 90 days rolling period cutoff correctly (AC-1, AC-2)', async () => {
    const days = 90
    const expectedSince = new Date(NOW.getTime() - 90 * DAY_MS)
    mockDeliveryRepository.findForWaitRecord.mockResolvedValue([])

    const result = await service.getWaitRecord(mockPartner, days, NOW)

    expect(mockDeliveryRepository.findForWaitRecord).toHaveBeenCalledWith('partner-100', expectedSince)
    expect(result.days).toBe(90)
  })

  test('combines days with calculated waitRecordOf results from repository deliveries (AC-6)', async () => {
    const createdAt = new Date(NOW.getTime() - 2 * DAY_MS)
    const readyAt = new Date(createdAt.getTime() + 20 * 60_000)
    const foodReadyAt = new Date(createdAt.getTime() + 25 * 60_000) // late by 5 min
    const arrivedAt = new Date(createdAt.getTime() + 18 * 60_000)
    const pickedUpAt = new Date(createdAt.getTime() + 30 * 60_000)

    mockDeliveryRepository.findForWaitRecord.mockResolvedValue([
      {
        id: 'del-1',
        createdAt,
        readyAt,
        foodReadyAt,
        events: [
          { type: EnumDeliveryEventType.ARRIVED_AT_PICKUP_LOCATION, occurredAt: arrivedAt },
          { type: EnumDeliveryEventType.PICKED_UP, occurredAt: pickedUpAt },
        ],
      },
    ])

    const result = await service.getWaitRecord(mockPartner, 30, NOW)

    expect(result).toEqual({
      days: 30,
      orderCount: 1,
      waitSamples: 1,
      // wait: 30 - max(18, 20) = 10 minutes
      averageWaitMinutes: 10,
      // foodReadyAt (25) > readyAt (20) -> late
      lateShare: 1,
      prepSamples: 1,
      // prep: 25 - 0 = 25 minutes
      medianPrepMinutes: 25,
      usualPrepMinutes: 20,
    })
  })
})
