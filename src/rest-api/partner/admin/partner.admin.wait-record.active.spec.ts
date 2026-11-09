import { NotFoundException } from 'src/errors'
import { PartnerAdminRestApiController } from './partner.admin.rest-api.controller'
import { PartnerDomainService } from 'src/domains/partner/partner.domain.service'
import { PartnerWaitRecordDomainService } from 'src/domains/partner/partner-wait-record.domain.service'
import { PartnerAdminRestApiService } from './partner.admin.rest-api.service'
import { PartnerAvailabilityDomainService } from 'src/domains/partner/partner-availability.domain.service'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { PartnerWaitRecordAdminDto } from './dtos/partner-wait-record.admin.dto'

// Spec 0030: admin wait-record endpoint and DTO (AC-1, AC-6).
describe('PartnerAdminRestApiController getWaitRecord (spec 0030)', () => {
  let controller: PartnerAdminRestApiController
  let mockPartnerDomainService: jest.Mocked<PartnerDomainService>
  let mockPartnerWaitRecordDomainService: jest.Mocked<PartnerWaitRecordDomainService>

  const mockPartner = new PartnerEntity({
    id: 'partner-volos-42',
    name: 'Volos Tsipouradiko',
    logo: null,
    phoneNumber: '+302421099999',
    webhookUrl: null,
    usualPrepMinutes: 18,
    busyExtraMinutes: null,
    pausedUntil: null,
    disabledAt: null,
    disabledReason: null,
    userId: 'user-42',
    pickupLocationId: 'loc-42',
    createdAt: new Date('2026-05-01T10:00:00Z'),
    updatedAt: new Date('2026-05-01T10:00:00Z'),
  })

  beforeEach(() => {
    mockPartnerDomainService = {
      getByIdOrThrow: jest.fn(),
    } as unknown as jest.Mocked<PartnerDomainService>

    mockPartnerWaitRecordDomainService = {
      getWaitRecord: jest.fn(),
    } as unknown as jest.Mocked<PartnerWaitRecordDomainService>

    controller = new PartnerAdminRestApiController(
      mockPartnerDomainService,
      {} as jest.Mocked<PartnerAdminRestApiService>,
      {} as jest.Mocked<PartnerAvailabilityDomainService>,
      mockPartnerWaitRecordDomainService
    )
  })

  test('fetches restaurant by id and returns wait record with default 30 days when query is empty (AC-1)', async () => {
    mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartner)
    mockPartnerWaitRecordDomainService.getWaitRecord.mockResolvedValue({
      days: 30,
      orderCount: 15,
      waitSamples: 14,
      averageWaitMinutes: 5.4,
      lateShare: 0.2,
      prepSamples: 13,
      medianPrepMinutes: 17,
      usualPrepMinutes: 18,
    })

    const result = await controller.getWaitRecord('partner-volos-42', {})

    expect(mockPartnerDomainService.getByIdOrThrow).toHaveBeenCalledWith('partner-volos-42')
    expect(mockPartnerWaitRecordDomainService.getWaitRecord).toHaveBeenCalledWith(
      mockPartner,
      30,
      expect.any(Date)
    )
    expect(result).toBeInstanceOf(PartnerWaitRecordAdminDto)
    expect(result.days).toBe(30)
    expect(result.orderCount).toBe(15)
    expect(result.waitSamples).toBe(14)
    expect(result.averageWaitMinutes).toBe(5.4)
    expect(result.lateShare).toBe(0.2)
    expect(result.prepSamples).toBe(13)
    expect(result.medianPrepMinutes).toBe(17)
    expect(result.usualPrepMinutes).toBe(18)
  })

  test('passes explicit days parameter (7 or 90) to domain service (AC-1)', async () => {
    mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartner)
    mockPartnerWaitRecordDomainService.getWaitRecord.mockResolvedValue({
      days: 7,
      orderCount: 4,
      waitSamples: 4,
      averageWaitMinutes: 3.1,
      lateShare: 0,
      prepSamples: 4,
      medianPrepMinutes: 15,
      usualPrepMinutes: 18,
    })

    const result = await controller.getWaitRecord('partner-volos-42', { days: 7 })

    expect(mockPartnerWaitRecordDomainService.getWaitRecord).toHaveBeenCalledWith(
      mockPartner,
      7,
      expect.any(Date)
    )
    expect(result.days).toBe(7)
  })

  test('throws NotFoundException when restaurant id does not exist (AC-1)', async () => {
    mockPartnerDomainService.getByIdOrThrow.mockRejectedValue(
      new NotFoundException('Restaurant not found')
    )

    await expect(controller.getWaitRecord('non-existent-id', {})).rejects.toThrow(
      NotFoundException
    )
    expect(mockPartnerWaitRecordDomainService.getWaitRecord).not.toHaveBeenCalled()
  })

  test('response carries no rider field, id or per-rider statistics (AC-6, Value 5)', async () => {
    mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartner)
    mockPartnerWaitRecordDomainService.getWaitRecord.mockResolvedValue({
      days: 30,
      orderCount: 1,
      waitSamples: 1,
      averageWaitMinutes: 4.5,
      lateShare: 0,
      prepSamples: 1,
      medianPrepMinutes: 16,
      usualPrepMinutes: 18,
    })

    const result = await controller.getWaitRecord('partner-volos-42', {})
    const keys = Object.keys(result)
    const jsonKeys = Object.keys(JSON.parse(JSON.stringify(result)))

    expect(keys.some((k) => /courier|rider/i.test(k))).toBe(false)
    expect(jsonKeys.some((k) => /courier|rider/i.test(k))).toBe(false)
  })
})
