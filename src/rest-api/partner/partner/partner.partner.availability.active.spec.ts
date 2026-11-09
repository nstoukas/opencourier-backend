import { ConflictException, ForbiddenException } from '@nestjs/common'
import { EnumUserRole } from '@prisma/types'
import { IS_API_KEY_AUTH } from 'src/decorators/api-key-auth.decorator'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { PartnerPartnerRestApiController } from './partner.partner.rest-api.controller'
import { LocationDomainService } from 'src/domains/location/location.domain.service'
import { PartnerAvailabilityDomainService } from 'src/domains/partner/partner-availability.domain.service'
import { PartnerAvailabilityPartnerDto } from './dtos/partner-availability.partner.dto'
import { PartnerProfileDto } from './dtos/partner-profile.partner.dto'

// Spec 0029, AC-1, AC-3, AC-6, AC-7: Partner availability controller endpoints.
describe('PartnerPartnerRestApiController availability endpoints (spec 0029)', () => {
  const NOW = new Date('2026-11-09T12:00:00.000Z')

  let controller: PartnerPartnerRestApiController
  let locationDomainService: jest.Mocked<LocationDomainService>
  let availabilityDomainService: jest.Mocked<PartnerAvailabilityDomainService>

  const makePartner = (overrides: Partial<PartnerEntity> = {}): PartnerEntity =>
    new PartnerEntity({
      id: 'partner-1',
      name: 'To Steki',
      logo: null,
      phoneNumber: '+302421012345',
      webhookUrl: null,
      usualPrepMinutes: 15,
      busyExtraMinutes: null,
      pausedUntil: null,
      disabledAt: null,
      disabledReason: null,
      userId: 'user-789',
      pickupLocationId: 'loc-1',
      createdAt: new Date('2026-07-01T10:00:00Z'),
      updatedAt: new Date('2026-07-01T10:00:00Z'),
      ...overrides,
    })

  beforeEach(() => {
    jest.useFakeTimers('modern')
    jest.setSystemTime(NOW)

    locationDomainService = {
      getById: jest.fn().mockResolvedValue(null),
    } as any

    availabilityDomainService = {
      setBusy: jest.fn(),
      clearBusy: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
    } as any

    controller = new PartnerPartnerRestApiController(
      locationDomainService,
      availabilityDomainService,
      { getWaitRecord: jest.fn() } as any
    )
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('POST availability/busy (AC-1)', () => {
    test('turns busy mode on and returns PartnerAvailabilityPartnerDto', async () => {
      const partner = makePartner({ busyExtraMinutes: null })
      const updated = makePartner({ busyExtraMinutes: 15 })
      availabilityDomainService.setBusy.mockResolvedValue(updated)

      const result = await controller.busyOn({ extraMinutes: 15 }, partner)

      expect(availabilityDomainService.setBusy).toHaveBeenCalledWith(
        partner,
        { role: EnumUserRole.PARTNER, userId: 'user-789' },
        15
      )
      expect(result).toBeInstanceOf(PartnerAvailabilityPartnerDto)
      expect(result.busyExtraMinutes).toBe(15)
      expect(result.acceptingOrders).toBe(true)
      expect(result.notAcceptingReason).toBeNull()
    })

    test('refuses with 409 ConflictException when restaurant is disabled (AC-6)', async () => {
      const partner = makePartner({ disabledAt: NOW, disabledReason: 'Inspection hold' })
      availabilityDomainService.setBusy.mockRejectedValue(
        new ConflictException('The co-op has disabled this restaurant: Inspection hold')
      )

      await expect(controller.busyOn({ extraMinutes: 15 }, partner)).rejects.toThrow(
        new ConflictException('The co-op has disabled this restaurant: Inspection hold')
      )
    })
  })

  describe('DELETE availability/busy (AC-1)', () => {
    test('turns busy mode off and returns PartnerAvailabilityPartnerDto', async () => {
      const partner = makePartner({ busyExtraMinutes: 15 })
      const updated = makePartner({ busyExtraMinutes: null })
      availabilityDomainService.clearBusy.mockResolvedValue(updated)

      const result = await controller.busyOff(partner)

      expect(availabilityDomainService.clearBusy).toHaveBeenCalledWith(partner, {
        role: EnumUserRole.PARTNER,
        userId: 'user-789',
      })
      expect(result).toBeInstanceOf(PartnerAvailabilityPartnerDto)
      expect(result.busyExtraMinutes).toBeNull()
      expect(result.acceptingOrders).toBe(true)
    })

    test('refuses with 409 ConflictException when restaurant is disabled (AC-6)', async () => {
      const partner = makePartner({ disabledAt: NOW, disabledReason: 'Co-op sanction' })
      availabilityDomainService.clearBusy.mockRejectedValue(
        new ConflictException('The co-op has disabled this restaurant: Co-op sanction')
      )

      await expect(controller.busyOff(partner)).rejects.toThrow(
        new ConflictException('The co-op has disabled this restaurant: Co-op sanction')
      )
    })
  })

  describe('POST availability/pause (AC-3)', () => {
    test('pauses ordering for chosen minutes and returns PartnerAvailabilityPartnerDto', async () => {
      const partner = makePartner({ pausedUntil: null })
      const until = new Date(NOW.getTime() + 30 * 60_000)
      const updated = makePartner({ pausedUntil: until })
      availabilityDomainService.pause.mockResolvedValue(updated)

      const result = await controller.pause({ minutes: 30 }, partner)

      expect(availabilityDomainService.pause).toHaveBeenCalledWith(
        partner,
        { role: EnumUserRole.PARTNER, userId: 'user-789' },
        30,
        NOW
      )
      expect(result).toBeInstanceOf(PartnerAvailabilityPartnerDto)
      expect(result.pausedUntil).toEqual(until)
      expect(result.acceptingOrders).toBe(false)
      expect(result.notAcceptingReason).toBe('Ordering is paused until 14:30.')
    })

    test('refuses with 409 ConflictException when restaurant is disabled (AC-6)', async () => {
      const partner = makePartner({ disabledAt: NOW, disabledReason: 'Suspended' })
      availabilityDomainService.pause.mockRejectedValue(
        new ConflictException('The co-op has disabled this restaurant: Suspended')
      )

      await expect(controller.pause({ minutes: 30 }, partner)).rejects.toThrow(
        new ConflictException('The co-op has disabled this restaurant: Suspended')
      )
    })
  })

  describe('DELETE availability/pause (AC-3)', () => {
    test('resumes ordering and returns PartnerAvailabilityPartnerDto', async () => {
      const partner = makePartner({ pausedUntil: new Date(NOW.getTime() + 30 * 60_000) })
      const updated = makePartner({ pausedUntil: null })
      availabilityDomainService.resume.mockResolvedValue(updated)

      const result = await controller.resume(partner)

      expect(availabilityDomainService.resume).toHaveBeenCalledWith(
        partner,
        { role: EnumUserRole.PARTNER, userId: 'user-789' },
        NOW
      )
      expect(result).toBeInstanceOf(PartnerAvailabilityPartnerDto)
      expect(result.pausedUntil).toBeNull()
      expect(result.acceptingOrders).toBe(true)
      expect(result.notAcceptingReason).toBeNull()
    })

    test('refuses with 409 ConflictException when restaurant is disabled (AC-6)', async () => {
      const partner = makePartner({ disabledAt: NOW, disabledReason: 'Account closed' })
      availabilityDomainService.resume.mockRejectedValue(
        new ConflictException('The co-op has disabled this restaurant: Account closed')
      )

      await expect(controller.resume(partner)).rejects.toThrow(
        new ConflictException('The co-op has disabled this restaurant: Account closed')
      )
    })
  })

  describe('ForbiddenException when partner has no userId', () => {
    test('throws ForbiddenException if partner has no login user', async () => {
      const partnerWithoutUser = makePartner({ userId: null })

      await expect(controller.busyOn({ extraMinutes: 15 }, partnerWithoutUser)).rejects.toThrow(
        new ForbiddenException('This restaurant has no sign in.')
      )
    })
  })

  describe('GET profile availability (AC-7)', () => {
    test('profile DTO carries the 6 availability fields', async () => {
      const partner = makePartner({
        busyExtraMinutes: 10,
        pausedUntil: null,
        disabledAt: null,
        disabledReason: null,
      })

      const profile = await controller.getProfile(partner)

      expect(profile).toBeInstanceOf(PartnerProfileDto)
      expect(profile.availability).toBeInstanceOf(PartnerAvailabilityPartnerDto)
      expect(profile.availability.busyExtraMinutes).toBe(10)
      expect(profile.availability.acceptingOrders).toBe(true)
      expect(profile.availability.notAcceptingReason).toBeNull()
    })

    test('profile DTO reflects expired pause as null and acceptingOrders true', async () => {
      const partner = makePartner({
        pausedUntil: new Date(NOW.getTime() - 10 * 60_000), // in the past
      })

      const profile = await controller.getProfile(partner)

      expect(profile.availability.pausedUntil).toBeNull()
      expect(profile.availability.acceptingOrders).toBe(true)
    })
  })

  // Agy review bug 2: availability endpoints must carry @ApiKeyAuth() like all other partner routes
  describe('ApiKeyAuth decorator on partner availability routes', () => {
    test.each([
      ['busyOn', PartnerPartnerRestApiController.prototype.busyOn],
      ['busyOff', PartnerPartnerRestApiController.prototype.busyOff],
      ['pause', PartnerPartnerRestApiController.prototype.pause],
      ['resume', PartnerPartnerRestApiController.prototype.resume],
    ])('route handler %s carries @ApiKeyAuth() metadata', (_name, handler) => {
      const isApiKeyAuth = Reflect.getMetadata(IS_API_KEY_AUTH, handler)
      expect(isApiKeyAuth).toBe(true)
    })
  })
})
