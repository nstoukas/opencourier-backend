import { PartnerPartnerRestApiController } from './partner.partner.rest-api.controller'
import { PartnerWaitRecordDomainService } from 'src/domains/partner/partner-wait-record.domain.service'
import { LocationDomainService } from 'src/domains/location/location.domain.service'
import { PartnerAvailabilityDomainService } from 'src/domains/partner/partner-availability.domain.service'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { WaitRecordPartnerDto } from './dtos/wait-record.partner.dto'

// Spec 0030: restaurant partner wait-record endpoint and DTO (AC-1, AC-6).
describe('PartnerPartnerRestApiController getWaitRecord (spec 0030)', () => {
  let controller: PartnerPartnerRestApiController
  let mockPartnerWaitRecordDomainService: jest.Mocked<PartnerWaitRecordDomainService>

  const signedInPartner = new PartnerEntity({
    id: 'partner-self-99',
    name: 'My Volos Bistro',
    logo: null,
    phoneNumber: '+302421077777',
    webhookUrl: null,
    usualPrepMinutes: 15,
    busyExtraMinutes: null,
    pausedUntil: null,
    disabledAt: null,
    disabledReason: null,
    userId: 'user-self-99',
    pickupLocationId: 'loc-99',
    createdAt: new Date('2026-06-01T10:00:00Z'),
    updatedAt: new Date('2026-06-01T10:00:00Z'),
  })

  beforeEach(() => {
    mockPartnerWaitRecordDomainService = {
      getWaitRecord: jest.fn(),
    } as unknown as jest.Mocked<PartnerWaitRecordDomainService>

    controller = new PartnerPartnerRestApiController(
      {} as jest.Mocked<LocationDomainService>,
      {} as jest.Mocked<PartnerAvailabilityDomainService>,
      mockPartnerWaitRecordDomainService
    )
  })

  test('reads only the signed in restaurant record and defaults to 30 days (AC-1)', async () => {
    mockPartnerWaitRecordDomainService.getWaitRecord.mockResolvedValue({
      days: 30,
      orderCount: 10,
      waitSamples: 9,
      averageWaitMinutes: 4.8,
      lateShare: 0.1,
      prepSamples: 8,
      medianPrepMinutes: 14,
      usualPrepMinutes: 15,
    })

    const result = await controller.getWaitRecord({}, signedInPartner)

    expect(mockPartnerWaitRecordDomainService.getWaitRecord).toHaveBeenCalledWith(
      signedInPartner,
      30,
      expect.any(Date)
    )
    expect(result).toBeInstanceOf(WaitRecordPartnerDto)
    expect(result.days).toBe(30)
    expect(result.orderCount).toBe(10)
    expect(result.waitSamples).toBe(9)
    expect(result.averageWaitMinutes).toBe(4.8)
    expect(result.lateShare).toBe(0.1)
    expect(result.prepSamples).toBe(8)
    expect(result.medianPrepMinutes).toBe(14)
    expect(result.usualPrepMinutes).toBe(15)
  })

  test('passes explicit days parameter (7 or 90) for signed in partner (AC-1)', async () => {
    mockPartnerWaitRecordDomainService.getWaitRecord.mockResolvedValue({
      days: 90,
      orderCount: 45,
      waitSamples: 42,
      averageWaitMinutes: 5.1,
      lateShare: 0.05,
      prepSamples: 40,
      medianPrepMinutes: 15,
      usualPrepMinutes: 15,
    })

    const result = await controller.getWaitRecord({ days: 90 }, signedInPartner)

    expect(mockPartnerWaitRecordDomainService.getWaitRecord).toHaveBeenCalledWith(
      signedInPartner,
      90,
      expect.any(Date)
    )
    expect(result.days).toBe(90)
    expect(result.orderCount).toBe(45)
  })

  test('response carries no rider field, id or per-rider statistics (AC-6, Value 5)', async () => {
    mockPartnerWaitRecordDomainService.getWaitRecord.mockResolvedValue({
      days: 30,
      orderCount: 2,
      waitSamples: 2,
      averageWaitMinutes: 3.5,
      lateShare: 0,
      prepSamples: 2,
      medianPrepMinutes: 12,
      usualPrepMinutes: 15,
    })

    const result = await controller.getWaitRecord({}, signedInPartner)
    const keys = Object.keys(result)
    const jsonKeys = Object.keys(JSON.parse(JSON.stringify(result)))

    expect(keys.some((k) => /courier|rider/i.test(k))).toBe(false)
    expect(jsonKeys.some((k) => /courier|rider/i.test(k))).toBe(false)
  })
})
