import { ConflictException } from '@nestjs/common'
import { EnumPartnerAvailabilityAction, EnumUserRole } from '@prisma/types'
import { PartnerEntity } from './entities/partner.entity'
import { PartnerAvailabilityDomainService } from './partner-availability.domain.service'
import { PartnerAvailabilityChangeRepository } from 'src/persistence/repositories/partner-availability-change.repository'

// Spec 0029: Availability transitions, no-op guards, refusal when disabled, and change recording.
describe('PartnerAvailabilityDomainService (spec 0029, AC-1, AC-3, AC-5, AC-6, AC-10)', () => {
  const NOW = new Date('2026-11-09T12:00:00.000Z')
  const partnerActor = { role: EnumUserRole.PARTNER, userId: 'partner-user-1' }
  const adminActor = { role: EnumUserRole.ADMIN, userId: 'admin-user-1' }

  let service: PartnerAvailabilityDomainService
  let changeRepository: jest.Mocked<PartnerAvailabilityChangeRepository>

  const makePartner = (overrides: Partial<PartnerEntity> = {}): PartnerEntity =>
    new PartnerEntity({
      id: 'partner-volos-1',
      name: 'To Steki',
      logo: null,
      phoneNumber: '+302421012345',
      webhookUrl: null,
      usualPrepMinutes: 15,
      busyExtraMinutes: null,
      pausedUntil: null,
      disabledAt: null,
      disabledReason: null,
      userId: 'partner-user-1',
      pickupLocationId: 'loc-1',
      createdAt: new Date('2026-07-01T10:00:00Z'),
      updatedAt: new Date('2026-07-01T10:00:00Z'),
      ...overrides,
    })

  beforeEach(() => {
    changeRepository = {
      applyChange: jest.fn(),
      findLatest: jest.fn(),
    } as unknown as jest.Mocked<PartnerAvailabilityChangeRepository>

    service = new PartnerAvailabilityDomainService(changeRepository)
  })

  describe('setBusy (AC-1, AC-10)', () => {
    test('turns busy mode on and records BUSY_ON with extraMinutes', async () => {
      const partner = makePartner({ busyExtraMinutes: null })
      const updated = makePartner({ busyExtraMinutes: 15 })
      changeRepository.applyChange.mockResolvedValue(updated)

      const result = await service.setBusy(partner, partnerActor, 15)

      expect(changeRepository.applyChange).toHaveBeenCalledWith(
        'partner-volos-1',
        { busyExtraMinutes: 15 },
        {
          action: EnumPartnerAvailabilityAction.BUSY_ON,
          actorRole: EnumUserRole.PARTNER,
          actorUserId: 'partner-user-1',
          extraMinutes: 15,
        }
      )
      expect(result).toBe(updated)
    })

    test('changes busy mode amount when already on with a different amount and records row', async () => {
      const partner = makePartner({ busyExtraMinutes: 10 })
      const updated = makePartner({ busyExtraMinutes: 20 })
      changeRepository.applyChange.mockResolvedValue(updated)

      const result = await service.setBusy(partner, partnerActor, 20)

      expect(changeRepository.applyChange).toHaveBeenCalledWith(
        'partner-volos-1',
        { busyExtraMinutes: 20 },
        {
          action: EnumPartnerAvailabilityAction.BUSY_ON,
          actorRole: EnumUserRole.PARTNER,
          actorUserId: 'partner-user-1',
          extraMinutes: 20,
        }
      )
      expect(result).toBe(updated)
    })

    test('no-op: setting the same extraMinutes records nothing and returns partner untouched (AC-1)', async () => {
      const partner = makePartner({ busyExtraMinutes: 15 })

      const result = await service.setBusy(partner, partnerActor, 15)

      expect(changeRepository.applyChange).not.toHaveBeenCalled()
      expect(result).toBe(partner)
    })

    test('refuses with 409 ConflictException when restaurant is disabled (AC-6)', async () => {
      const partner = makePartner({
        disabledAt: NOW,
        disabledReason: 'Late paperwork',
      })

      await expect(service.setBusy(partner, partnerActor, 15)).rejects.toThrow(
        new ConflictException('The co-op has disabled this restaurant: Late paperwork')
      )
      expect(changeRepository.applyChange).not.toHaveBeenCalled()
    })
  })

  describe('clearBusy (AC-1, AC-10)', () => {
    test('turns busy mode off and records BUSY_OFF', async () => {
      const partner = makePartner({ busyExtraMinutes: 15 })
      const updated = makePartner({ busyExtraMinutes: null })
      changeRepository.applyChange.mockResolvedValue(updated)

      const result = await service.clearBusy(partner, partnerActor)

      expect(changeRepository.applyChange).toHaveBeenCalledWith(
        'partner-volos-1',
        { busyExtraMinutes: null },
        {
          action: EnumPartnerAvailabilityAction.BUSY_OFF,
          actorRole: EnumUserRole.PARTNER,
          actorUserId: 'partner-user-1',
        }
      )
      expect(result).toBe(updated)
    })

    test('no-op: clearing when already off records nothing and returns partner untouched (AC-1)', async () => {
      const partner = makePartner({ busyExtraMinutes: null })

      const result = await service.clearBusy(partner, partnerActor)

      expect(changeRepository.applyChange).not.toHaveBeenCalled()
      expect(result).toBe(partner)
    })

    test('refuses with 409 ConflictException when restaurant is disabled (AC-6)', async () => {
      const partner = makePartner({
        busyExtraMinutes: 15,
        disabledAt: NOW,
        disabledReason: 'Unpaid dues',
      })

      await expect(service.clearBusy(partner, partnerActor)).rejects.toThrow(
        new ConflictException('The co-op has disabled this restaurant: Unpaid dues')
      )
      expect(changeRepository.applyChange).not.toHaveBeenCalled()
    })
  })

  describe('pause (AC-3, AC-10)', () => {
    test('sets pausedUntil to now + minutes and records PAUSED', async () => {
      const partner = makePartner({ pausedUntil: null })
      const expectedEnd = new Date(NOW.getTime() + 30 * 60_000)
      const updated = makePartner({ pausedUntil: expectedEnd })
      changeRepository.applyChange.mockResolvedValue(updated)

      const result = await service.pause(partner, partnerActor, 30, NOW)

      expect(changeRepository.applyChange).toHaveBeenCalledWith(
        'partner-volos-1',
        { pausedUntil: expectedEnd },
        {
          action: EnumPartnerAvailabilityAction.PAUSED,
          actorRole: EnumUserRole.PARTNER,
          actorUserId: 'partner-user-1',
          pausedUntil: expectedEnd,
        }
      )
      expect(result).toBe(updated)
    })

    test('pausing again always resets the end and records a row, even for the same number of minutes (AC-3)', async () => {
      // Previously paused until 15 min from now; pausing again for 30 min sets it to 30 min from now
      const existingEnd = new Date(NOW.getTime() + 15 * 60_000)
      const partner = makePartner({ pausedUntil: existingEnd })
      const newEnd = new Date(NOW.getTime() + 30 * 60_000)
      const updated = makePartner({ pausedUntil: newEnd })
      changeRepository.applyChange.mockResolvedValue(updated)

      const result = await service.pause(partner, partnerActor, 30, NOW)

      expect(changeRepository.applyChange).toHaveBeenCalledWith(
        'partner-volos-1',
        { pausedUntil: newEnd },
        {
          action: EnumPartnerAvailabilityAction.PAUSED,
          actorRole: EnumUserRole.PARTNER,
          actorUserId: 'partner-user-1',
          pausedUntil: newEnd,
        }
      )
      expect(result).toBe(updated)
    })

    test('refuses with 409 ConflictException when restaurant is disabled (AC-6)', async () => {
      const partner = makePartner({
        disabledAt: NOW,
        disabledReason: 'Safety dispute',
      })

      await expect(service.pause(partner, partnerActor, 30, NOW)).rejects.toThrow(
        new ConflictException('The co-op has disabled this restaurant: Safety dispute')
      )
      expect(changeRepository.applyChange).not.toHaveBeenCalled()
    })
  })

  describe('resume (AC-3, AC-10)', () => {
    test('clears pausedUntil and records RESUMED when pause is in force', async () => {
      const futureEnd = new Date(NOW.getTime() + 20 * 60_000)
      const partner = makePartner({ pausedUntil: futureEnd })
      const updated = makePartner({ pausedUntil: null })
      changeRepository.applyChange.mockResolvedValue(updated)

      const result = await service.resume(partner, partnerActor, NOW)

      expect(changeRepository.applyChange).toHaveBeenCalledWith(
        'partner-volos-1',
        { pausedUntil: null },
        {
          action: EnumPartnerAvailabilityAction.RESUMED,
          actorRole: EnumUserRole.PARTNER,
          actorUserId: 'partner-user-1',
        }
      )
      expect(result).toBe(updated)
    })

    test('no-op: clearing when not paused records nothing and returns partner untouched (AC-3)', async () => {
      const partner = makePartner({ pausedUntil: null })

      const result = await service.resume(partner, partnerActor, NOW)

      expect(changeRepository.applyChange).not.toHaveBeenCalled()
      expect(result).toBe(partner)
    })

    test('no-op: clearing when pause has expired by the clock records nothing (decision 34.5)', async () => {
      const expiredEnd = new Date(NOW.getTime() - 5 * 60_000)
      const partner = makePartner({ pausedUntil: expiredEnd })

      const result = await service.resume(partner, partnerActor, NOW)

      expect(changeRepository.applyChange).not.toHaveBeenCalled()
      expect(result).toBe(partner)
    })

    test('refuses with 409 ConflictException when restaurant is disabled (AC-6)', async () => {
      const partner = makePartner({
        pausedUntil: new Date(NOW.getTime() + 10 * 60_000),
        disabledAt: NOW,
        disabledReason: 'Under review',
      })

      await expect(service.resume(partner, partnerActor, NOW)).rejects.toThrow(
        new ConflictException('The co-op has disabled this restaurant: Under review')
      )
      expect(changeRepository.applyChange).not.toHaveBeenCalled()
    })
  })

  describe('disable (AC-5, AC-10)', () => {
    test('sets disabledAt and disabledReason and records DISABLED with reason', async () => {
      const partner = makePartner({ disabledAt: null, disabledReason: null })
      const updated = makePartner({ disabledAt: NOW, disabledReason: 'Repeated late orders' })
      changeRepository.applyChange.mockResolvedValue(updated)

      const result = await service.disable(partner, adminActor, 'Repeated late orders', NOW)

      expect(changeRepository.applyChange).toHaveBeenCalledWith(
        'partner-volos-1',
        { disabledAt: NOW, disabledReason: 'Repeated late orders' },
        {
          action: EnumPartnerAvailabilityAction.DISABLED,
          actorRole: EnumUserRole.ADMIN,
          actorUserId: 'admin-user-1',
          reason: 'Repeated late orders',
        }
      )
      expect(result).toBe(updated)
    })

    test('no-op: disabling when already disabled records nothing and returns partner untouched (AC-5)', async () => {
      const partner = makePartner({ disabledAt: NOW, disabledReason: 'Already disabled' })

      const result = await service.disable(partner, adminActor, 'New reason', NOW)

      expect(changeRepository.applyChange).not.toHaveBeenCalled()
      expect(result).toBe(partner)
    })
  })

  describe('enable (AC-5, AC-10)', () => {
    test('clears disabledAt and disabledReason, leaves busyExtraMinutes and pausedUntil intact, and records ENABLED', async () => {
      const pauseEnd = new Date(NOW.getTime() + 30 * 60_000)
      const partner = makePartner({
        busyExtraMinutes: 15,
        pausedUntil: pauseEnd,
        disabledAt: NOW,
        disabledReason: 'Past dispute',
      })
      const updated = makePartner({
        busyExtraMinutes: 15,
        pausedUntil: pauseEnd,
        disabledAt: null,
        disabledReason: null,
      })
      changeRepository.applyChange.mockResolvedValue(updated)

      const result = await service.enable(partner, adminActor)

      expect(changeRepository.applyChange).toHaveBeenCalledWith(
        'partner-volos-1',
        { disabledAt: null, disabledReason: null },
        {
          action: EnumPartnerAvailabilityAction.ENABLED,
          actorRole: EnumUserRole.ADMIN,
          actorUserId: 'admin-user-1',
        }
      )
      expect(result).toBe(updated)
    })

    test('no-op: enabling when already enabled records nothing and returns partner untouched (AC-5)', async () => {
      const partner = makePartner({ disabledAt: null, disabledReason: null })

      const result = await service.enable(partner, adminActor)

      expect(changeRepository.applyChange).not.toHaveBeenCalled()
      expect(result).toBe(partner)
    })
  })

  describe('getChanges (AC-9)', () => {
    test('fetches the newest 50 changes for the given partnerId', async () => {
      const sampleChanges = [
        {
          id: 'ch-1',
          partnerId: 'partner-volos-1',
          action: EnumPartnerAvailabilityAction.BUSY_ON,
          actorRole: EnumUserRole.PARTNER,
          actorUserId: 'user-1',
          actorEmail: 'kitchen@volos.gr',
          extraMinutes: 15,
          pausedUntil: null,
          reason: null,
          createdAt: NOW,
        },
      ]
      changeRepository.findLatest.mockResolvedValue(sampleChanges as any)

      const result = await service.getChanges('partner-volos-1')

      expect(changeRepository.findLatest).toHaveBeenCalledWith('partner-volos-1', 50)
      expect(result).toEqual(sampleChanges)
    })
  })
})
