import { NotFoundException } from 'src/errors'
import { EnumPartnerAvailabilityAction, EnumUserRole } from '@prisma/types'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import { PartnerAdminRestApiController } from './partner.admin.rest-api.controller'
import { PartnerDomainService } from 'src/domains/partner/partner.domain.service'
import { PartnerAdminRestApiService } from './partner.admin.rest-api.service'
import { PartnerAvailabilityDomainService } from 'src/domains/partner/partner-availability.domain.service'
import { PartnerAdminDto } from './dtos/partner.admin.dto'
import { PartnerAvailabilityChangeAdminDto } from './dtos/partner-availability.admin.dto'

// Spec 0029, AC-5, AC-7, AC-9: Admin disable, enable and availability history routes.
describe('PartnerAdminRestApiController availability endpoints (spec 0029)', () => {
  const NOW = new Date('2026-11-09T12:00:00.000Z')

  let controller: PartnerAdminRestApiController
  let mockPartnerDomainService: jest.Mocked<PartnerDomainService>
  let mockPartnerAdminRestApiService: jest.Mocked<PartnerAdminRestApiService>
  let mockPartnerAvailabilityDomainService: jest.Mocked<PartnerAvailabilityDomainService>

  const adminUser = new UserEntity({
    id: 'admin-user-42',
    email: 'rep@opencourier.coop',
    role: EnumUserRole.ADMIN,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  } as any)

  const makePartner = (overrides: Partial<PartnerEntity> = {}): PartnerEntity =>
    new PartnerEntity({
      id: 'partner-100',
      name: 'Taverna Volos',
      logo: null,
      phoneNumber: '+302421000000',
      webhookUrl: null,
      usualPrepMinutes: 15,
      busyExtraMinutes: null,
      pausedUntil: null,
      disabledAt: null,
      disabledReason: null,
      userId: 'user-200',
      pickupLocationId: 'loc-300',
      createdAt: new Date('2026-07-01T10:00:00Z'),
      updatedAt: new Date('2026-07-01T10:00:00Z'),
      user: { email: 'taverna@volos.gr' },
      pickupLocation: null,
      ...overrides,
    })

  beforeEach(() => {
    jest.useFakeTimers('modern')
    jest.setSystemTime(NOW)

    mockPartnerDomainService = {
      getByIdOrThrow: jest.fn(),
    } as any

    mockPartnerAdminRestApiService = {} as any

    mockPartnerAvailabilityDomainService = {
      disable: jest.fn(),
      enable: jest.fn(),
      getChanges: jest.fn(),
    } as any

    controller = new PartnerAdminRestApiController(
      mockPartnerDomainService,
      mockPartnerAdminRestApiService,
      mockPartnerAvailabilityDomainService,
      { getWaitRecord: jest.fn() } as any
    )
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('POST :id/disable (AC-5, AC-7)', () => {
    test('disables restaurant with reason and returns PartnerAdminDto containing availability', async () => {
      const partner = makePartner({ disabledAt: null, disabledReason: null })
      const updated = makePartner({ disabledAt: NOW, disabledReason: 'Licence renewal overdue' })
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(partner)
      mockPartnerAvailabilityDomainService.disable.mockResolvedValue(updated)

      const result = await controller.disablePartner(
        'partner-100',
        { reason: 'Licence renewal overdue' },
        adminUser
      )

      expect(mockPartnerDomainService.getByIdOrThrow).toHaveBeenCalledWith('partner-100')
      expect(mockPartnerAvailabilityDomainService.disable).toHaveBeenCalledWith(
        partner,
        { role: EnumUserRole.ADMIN, userId: 'admin-user-42' },
        'Licence renewal overdue',
        NOW
      )
      expect(result).toBeInstanceOf(PartnerAdminDto)
      expect(result.email).toBe('taverna@volos.gr')
      expect(result.availability.disabledAt).toEqual(NOW)
      expect(result.availability.disabledReason).toBe('Licence renewal overdue')
      expect(result.availability.acceptingOrders).toBe(false)
      expect(result.availability.notAcceptingReason).toBe(
        'The co-op has disabled this restaurant: Licence renewal overdue'
      )
    })

    test('throws 404 NotFoundException when partner id is unknown (AC-5)', async () => {
      mockPartnerDomainService.getByIdOrThrow.mockRejectedValue(new NotFoundException('Partner not found'))

      await expect(
        controller.disablePartner('unknown-id', { reason: 'Any reason' }, adminUser)
      ).rejects.toThrow(NotFoundException)
      expect(mockPartnerAvailabilityDomainService.disable).not.toHaveBeenCalled()
    })
  })

  describe('POST :id/enable (AC-5, AC-7)', () => {
    test('enables restaurant and returns PartnerAdminDto with availability cleared', async () => {
      const partner = makePartner({ disabledAt: NOW, disabledReason: 'Resolved' })
      const updated = makePartner({ disabledAt: null, disabledReason: null })
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(partner)
      mockPartnerAvailabilityDomainService.enable.mockResolvedValue(updated)

      const result = await controller.enablePartner('partner-100', adminUser)

      expect(mockPartnerDomainService.getByIdOrThrow).toHaveBeenCalledWith('partner-100')
      expect(mockPartnerAvailabilityDomainService.enable).toHaveBeenCalledWith(partner, {
        role: EnumUserRole.ADMIN,
        userId: 'admin-user-42',
      })
      expect(result).toBeInstanceOf(PartnerAdminDto)
      expect(result.email).toBe('taverna@volos.gr')
      expect(result.availability.disabledAt).toBeNull()
      expect(result.availability.disabledReason).toBeNull()
      expect(result.availability.acceptingOrders).toBe(true)
      expect(result.availability.notAcceptingReason).toBeNull()
    })

    test('throws 404 NotFoundException when partner id is unknown (AC-5)', async () => {
      mockPartnerDomainService.getByIdOrThrow.mockRejectedValue(new NotFoundException('Partner not found'))

      await expect(controller.enablePartner('unknown-id', adminUser)).rejects.toThrow(
        NotFoundException
      )
      expect(mockPartnerAvailabilityDomainService.enable).not.toHaveBeenCalled()
    })
  })

  describe('GET :id/availability-changes (AC-9)', () => {
    test('verifies partner existence and returns array of PartnerAvailabilityChangeAdminDto', async () => {
      const partner = makePartner()
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(partner)

      const rawChanges: any[] = [
        {
          id: 'ch-1',
          action: EnumPartnerAvailabilityAction.PAUSED,
          actorRole: EnumUserRole.PARTNER,
          actorEmail: 'kitchen@volos.gr',
          extraMinutes: null,
          pausedUntil: new Date(NOW.getTime() + 30 * 60_000),
          reason: null,
          createdAt: NOW,
        },
        {
          id: 'ch-2',
          action: EnumPartnerAvailabilityAction.DISABLED,
          actorRole: EnumUserRole.ADMIN,
          actorEmail: 'rep@opencourier.coop',
          extraMinutes: null,
          pausedUntil: null,
          reason: 'Disciplinary hearing',
          createdAt: new Date(NOW.getTime() - 3600_000),
        },
      ]
      mockPartnerAvailabilityDomainService.getChanges.mockResolvedValue(rawChanges)

      const result = await controller.getAvailabilityChanges('partner-100')

      expect(mockPartnerDomainService.getByIdOrThrow).toHaveBeenCalledWith('partner-100')
      expect(mockPartnerAvailabilityDomainService.getChanges).toHaveBeenCalledWith('partner-100')
      expect(result).toHaveLength(2)
      const [first, second] = result
      expect(first?.action).toBe(EnumPartnerAvailabilityAction.PAUSED)
      expect(first?.actorEmail).toBe('kitchen@volos.gr')
      expect(second?.action).toBe(EnumPartnerAvailabilityAction.DISABLED)
      expect(second?.reason).toBe('Disciplinary hearing')
    })

    test('throws 404 NotFoundException when partner id is unknown (AC-9)', async () => {
      mockPartnerDomainService.getByIdOrThrow.mockRejectedValue(new NotFoundException('Partner not found'))

      await expect(controller.getAvailabilityChanges('unknown-id')).rejects.toThrow(
        NotFoundException
      )
      expect(mockPartnerAvailabilityDomainService.getChanges).not.toHaveBeenCalled()
    })
  })
})
