import { EnumPartnerAvailabilityAction, EnumUserRole } from '@prisma/types'
import { PrismaService } from 'src/services/prisma/prisma.service'
import {
  PartnerAvailabilityChangeData,
  PartnerAvailabilityChangeRepository,
} from './partner-availability-change.repository'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'

// Spec 0029, AC-10: Partner update and change row written in the same $transaction.
// AC-9: findLatest joins actor emails from User.
describe('PartnerAvailabilityChangeRepository (spec 0029, AC-9, AC-10)', () => {
  let repository: PartnerAvailabilityChangeRepository
  let mockPrisma: any

  const NOW = new Date('2026-11-09T12:00:00.000Z')

  const samplePartnerDbRow = {
    id: 'partner-1',
    name: 'To Steki',
    logo: null,
    phoneNumber: '+302421012345',
    webhookUrl: null,
    usualPrepMinutes: 15,
    busyExtraMinutes: 15,
    pausedUntil: null,
    disabledAt: null,
    disabledReason: null,
    userId: 'user-1',
    pickupLocationId: 'loc-1',
    createdAt: NOW,
    updatedAt: NOW,
  }

  beforeEach(() => {
    mockPrisma = {
      $transaction: jest.fn(),
      partner: {
        update: jest.fn(),
      },
      partnerAvailabilityChange: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
      user: {
        findMany: jest.fn(),
      },
    }

    repository = new PartnerAvailabilityChangeRepository(mockPrisma as unknown as PrismaService)
  })

  describe('applyChange (AC-10)', () => {
    test('executes partner update and change create in a single $transaction array and returns PartnerEntity', async () => {
      const partnerData = { busyExtraMinutes: 15 }
      const changeData: PartnerAvailabilityChangeData = {
        action: EnumPartnerAvailabilityAction.BUSY_ON,
        actorRole: EnumUserRole.PARTNER,
        actorUserId: 'user-1',
        extraMinutes: 15,
      }

      // $transaction receives an array of promises: [partner.update, partnerAvailabilityChange.create]
      mockPrisma.partner.update.mockReturnValue('partner-update-promise')
      mockPrisma.partnerAvailabilityChange.create.mockReturnValue('change-create-promise')
      mockPrisma.$transaction.mockResolvedValue([samplePartnerDbRow, { id: 'ch-1' }])

      const result = await repository.applyChange('partner-1', partnerData, changeData)

      expect(mockPrisma.partner.update).toHaveBeenCalledWith({
        where: { id: 'partner-1' },
        data: partnerData,
      })
      expect(mockPrisma.partnerAvailabilityChange.create).toHaveBeenCalledWith({
        data: {
          ...changeData,
          partnerId: 'partner-1',
        },
      })
      expect(mockPrisma.$transaction).toHaveBeenCalledWith([
        'partner-update-promise',
        'change-create-promise',
      ])

      expect(result).toBeInstanceOf(PartnerEntity)
      expect(result.id).toBe('partner-1')
      expect(result.busyExtraMinutes).toBe(15)
    })
  })

  describe('findLatest (AC-9)', () => {
    test('queries changes ordered by createdAt desc and maps actorEmail from User', async () => {
      const rows = [
        {
          id: 'ch-1',
          partnerId: 'partner-1',
          action: EnumPartnerAvailabilityAction.PAUSED,
          actorRole: EnumUserRole.PARTNER,
          actorUserId: 'user-kitchen',
          extraMinutes: null,
          pausedUntil: new Date('2026-11-09T13:00:00.000Z'),
          reason: null,
          createdAt: new Date('2026-11-09T12:00:00.000Z'),
        },
        {
          id: 'ch-2',
          partnerId: 'partner-1',
          action: EnumPartnerAvailabilityAction.DISABLED,
          actorRole: EnumUserRole.ADMIN,
          actorUserId: 'user-admin',
          extraMinutes: null,
          pausedUntil: null,
          reason: 'Late payments',
          createdAt: new Date('2026-11-09T11:00:00.000Z'),
        },
        {
          id: 'ch-3',
          partnerId: 'partner-1',
          action: EnumPartnerAvailabilityAction.BUSY_ON,
          actorRole: EnumUserRole.PARTNER,
          actorUserId: 'user-unknown',
          extraMinutes: 10,
          pausedUntil: null,
          reason: null,
          createdAt: new Date('2026-11-09T10:00:00.000Z'),
        },
      ]

      mockPrisma.partnerAvailabilityChange.findMany.mockResolvedValue(rows)
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'user-kitchen', email: 'kitchen@volos.gr' },
        { id: 'user-admin', email: 'admin@opencourier.coop' },
      ])

      const result = await repository.findLatest('partner-1', 50)

      expect(mockPrisma.partnerAvailabilityChange.findMany).toHaveBeenCalledWith({
        where: { partnerId: 'partner-1' },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })

      // Unique user ids queried
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['user-kitchen', 'user-admin', 'user-unknown'] } },
        select: { id: true, email: true },
      })

      expect(result).toHaveLength(3)
      const [first, second, third] = result
      expect(first?.actorEmail).toBe('kitchen@volos.gr')
      expect(second?.actorEmail).toBe('admin@opencourier.coop')
      expect(third?.actorEmail).toBeNull() // When user not found in User table
    })
  })
})
