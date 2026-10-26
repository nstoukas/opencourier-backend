import * as fs from 'fs'
import * as path from 'path'
import { EnumDevicePlatform } from '@prisma/types'
import { CourierDeviceRepository } from './courier-device.repository'
import { PrismaService } from '../../services/prisma/prisma.service'

describe('CourierDeviceRepository - Spec 0003 AC-1 Token Lifecycle & AC-13 Value 5', () => {
  let repository: CourierDeviceRepository
  let mockPrisma: {
    courierDevice: {
      upsert: jest.Mock
      deleteMany: jest.Mock
      findMany: jest.Mock
    }
  }

  beforeEach(() => {
    mockPrisma = {
      courierDevice: {
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    }

    repository = new CourierDeviceRepository(mockPrisma as unknown as PrismaService)
  })

  describe('upsertForCourier (AC-1: registration and token moves)', () => {
    test('upserts device token with where on unique token and updates courierId if token moves', async () => {
      const courierId = 'courier-rider-b'
      const token = 'fcm-device-token-12345'
      const platform = EnumDevicePlatform.ANDROID

      await repository.upsertForCourier(courierId, token, platform)

      // AC-1: One row per install, unique by token. If rider B logs in on rider A's phone,
      // the upsert updates courierId to rider B.
      expect(mockPrisma.courierDevice.upsert).toHaveBeenCalledWith({
        where: { token },
        create: { token, platform, courierId },
        update: { courierId, platform },
      })
    })
  })

  describe('deleteForCourier (AC-1: logout and own-token delete)', () => {
    test('deletes only if both token and caller courierId match', async () => {
      const courierId = 'courier-rider-a'
      const token = 'fcm-device-token-12345'

      await repository.deleteForCourier(courierId, token)

      // Security rule: DELETE must filter on both token and courierId so a rider
      // can never unregister another rider's phone.
      expect(mockPrisma.courierDevice.deleteMany).toHaveBeenCalledWith({
        where: { token, courierId },
      })
    })
  })

  describe('findTokensForCourier', () => {
    test('queries devices by courierId and returns token strings', async () => {
      mockPrisma.courierDevice.findMany.mockResolvedValue([
        { token: 'token-phone-1' },
        { token: 'token-phone-2' },
      ])

      const tokens = await repository.findTokensForCourier('courier-rider-1')

      expect(mockPrisma.courierDevice.findMany).toHaveBeenCalledWith({
        where: { courierId: 'courier-rider-1' },
        select: { token: true },
      })
      expect(tokens).toEqual(['token-phone-1', 'token-phone-2'])
    })

    test('returns empty array when courier has no registered devices', async () => {
      mockPrisma.courierDevice.findMany.mockResolvedValue([])

      const tokens = await repository.findTokensForCourier('courier-no-devices')

      expect(tokens).toEqual([])
    })
  })

  describe('deleteByTokens (AC-1: dead token cleanup)', () => {
    test('deletes devices matching list of dead tokens and returns deleted count', async () => {
      mockPrisma.courierDevice.deleteMany.mockResolvedValue({ count: 2 })

      const count = await repository.deleteByTokens(['dead-token-1', 'dead-token-2'])

      expect(mockPrisma.courierDevice.deleteMany).toHaveBeenCalledWith({
        where: { token: { in: ['dead-token-1', 'dead-token-2'] } },
      })
      expect(count).toBe(2)
    })

    test('returns 0 without database query when tokens array is empty', async () => {
      const count = await repository.deleteByTokens([])

      expect(count).toBe(0)
      expect(mockPrisma.courierDevice.deleteMany).not.toHaveBeenCalled()
    })
  })

  describe('AC-13 / Value 5: No delivery, open or answer tracking fields', () => {
    test('repository methods equal an explicit allow list (no markPushed or timing methods)', () => {
      const methodNames = Object.getOwnPropertyNames(CourierDeviceRepository.prototype)
        .filter((name) => name !== 'constructor')
        .sort()

      const ALLOWED_METHODS = [
        'upsertForCourier',
        'deleteForCourier',
        'findTokensForCourier',
        'deleteByTokens',
      ].sort()

      expect(methodNames).toEqual(ALLOWED_METHODS)
    })

    test('schema CourierDevice model columns equal an explicit allow list of columns it has today', () => {
      const schemaPath = path.resolve(process.cwd(), 'prisma/schema.prisma')
      const schemaContent = fs.readFileSync(schemaPath, 'utf8')

      // Extract model CourierDevice block
      const modelMatch = schemaContent.match(/model\s+CourierDevice\s+\{([^}]+)\}/)
      expect(modelMatch).not.toBeNull()

      const modelBody = modelMatch ? modelMatch[1] ?? '' : ''
      const fieldLines = modelBody
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('//') && !line.startsWith('@@'))

      // Extract database column names (scalar fields, ignoring @relation fields)
      const columnNames = fieldLines
        .filter((line) => !line.includes('@relation'))
        .map((line) => line.split(/\s+/)[0])
        .sort()

      // Value 5: explicit allow list of the columns CourierDevice has today.
      // Any new per-rider timing column (lastPushedAt, deliveredAt, openedAt, etc.) or updatedAt fails.
      const ALLOWED_COLUMNS = ['createdAt', 'courierId', 'id', 'platform', 'token'].sort()
      expect(columnNames).toEqual(ALLOWED_COLUMNS)

      // Also assert all model fields in schema.prisma equal the explicit allow list (including relation)
      const allFields = fieldLines.map((line) => line.split(/\s+/)[0]).sort()
      const ALLOWED_ALL_FIELDS = ['courier', 'courierId', 'createdAt', 'id', 'platform', 'token'].sort()
      expect(allFields).toEqual(ALLOWED_ALL_FIELDS)
    })
  })
})
