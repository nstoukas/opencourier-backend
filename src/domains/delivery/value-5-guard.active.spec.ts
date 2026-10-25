import * as fs from 'fs'
import * as path from 'path'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { EnumDeliveryStatus } from '@prisma/types'

describe('Value 5 Guard (AC-12: Never count or score missed offers against couriers)', () => {
  // Helper to recursively collect files matching a predicate
  function findFiles(dir: string, filter: (filePath: string) => boolean): string[] {
    const results: string[] = []
    if (!fs.existsSync(dir)) return results

    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...findFiles(fullPath, filter))
      } else if (entry.isFile() && filter(fullPath)) {
        results.push(fullPath)
      }
    }
    return results
  }

  const rootSrc = path.resolve(__dirname, '../../')

  describe('DTO inspection: no field aggregates or exposes missed/expired offers per courier', () => {
    // Prohibited terms that would indicate monitoring, rating, scoring, or aggregating misses against couriers
    const PROHIBITED_FIELD_PATTERNS = [
      /expiredOffers/i,
      /missedOffers/i,
      /expiryCount/i,
      /expiredOfferCount/i,
      /acceptanceRate/i,
      /offerExpiryCount/i,
      /missedOfferCount/i,
      /rejectedOfferCount/i,
    ]

    const dtoFiles = [
      ...findFiles(path.join(rootSrc, 'rest-api'), (f) => f.includes('/admin/') && f.endsWith('.dto.ts')),
      ...findFiles(path.join(rootSrc, 'rest-api'), (f) => f.includes('/public/') && f.endsWith('.dto.ts')),
    ]

    it('finds DTO source files to check', () => {
      expect(dtoFiles.length).toBeGreaterThan(0)
    })

    dtoFiles.forEach((file) => {
      const relativePath = path.relative(rootSrc, file)

      it(`ensures ${relativePath} does not declare any prohibited courier-expiry tracking property`, () => {
        const content = fs.readFileSync(file, 'utf8')

        for (const pattern of PROHIBITED_FIELD_PATTERNS) {
          const match = content.match(pattern)
          expect(match).toBeNull()
        }
      })
    })
  })

  describe('Repository inspection: no query aggregates DeliveryEvent by courierId', () => {
    const repositoryFiles = findFiles(
      path.join(rootSrc, 'persistence/repositories'),
      (f) => f.endsWith('.repository.ts')
    )

    it('finds repository source files to check', () => {
      expect(repositoryFiles.length).toBeGreaterThan(0)
    })

    repositoryFiles.forEach((file) => {
      const relativePath = path.relative(rootSrc, file)

      it(`ensures ${relativePath} does not group deliveryEvent by courierId`, () => {
        const content = fs.readFileSync(file, 'utf8')

        // Must not contain groupBy with courierId on deliveryEvent table
        const deliveryEventGroupByCourier = /deliveryEvent\.groupBy\s*\(\s*\{[\s\S]*?by:\s*\[[\s\S]*?['"]courierId['"]/
        expect(content.match(deliveryEventGroupByCourier)).toBeNull()
      })
    })
  })

  describe('Behavior guard: offer expiry never changes a courier status', () => {
    it('ensures handleOfferExpiryJob never calls courierRepository.updateById or updateStatus', async () => {
      const mockCourierRepository: any = {
        findById: jest.fn().mockResolvedValue({ id: 'courier-val5', userId: 'user-val5' }),
        updateById: jest.fn(),
        updateStatus: jest.fn(),
      }

      const mockDeliveryRepository: any = {
        findById: jest.fn().mockResolvedValue({
          id: 'del-val5',
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: 'courier-val5',
          offeredAt: new Date(Date.now() - 25000),
          offerExpiresAt: new Date(Date.now() - 5000),
        }),
        findByIdOrThrow: jest.fn().mockResolvedValue({
          id: 'del-val5',
          status: EnumDeliveryStatus.ASSIGNING_COURIER,
          matchedCourierId: null,
          courierId: null,
        }),
        update: jest.fn().mockResolvedValue({}),
        updateIfMatches: jest.fn().mockResolvedValue(true),
      }

      const mockDeliveryEventRepository: any = {
        create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
        findLatestOfTypes: jest.fn().mockResolvedValue(null),
      }

      const mockWebsocketDispatcher: any = {
        sendOfferEnded: jest.fn().mockResolvedValue(undefined),
      }

      const mockDeliveryMatchingService: any = {
        findCourierForDelivery: jest.fn().mockResolvedValue(undefined),
      }

      const mockCacheService: any = {
        getOrDefault: jest.fn().mockResolvedValue([]),
        save: jest.fn().mockResolvedValue(undefined),
      }

      const service = new DeliveryEventService(
        {} as any,
        mockWebsocketDispatcher,
        mockCourierRepository,
        mockDeliveryRepository,
        mockDeliveryEventRepository,
        {} as any,
        { registerTaskHandler: jest.fn() } as any,
        {} as any,
        mockDeliveryMatchingService,
        {} as any,
        { removeDelayedJobsWithIdPrefix: jest.fn().mockResolvedValue([]), addJob: jest.fn() } as any,
        {
          instanceConfig: {
            getOfferExpiryEnabled: jest.fn().mockResolvedValue(true),
            getOfferExpirySeconds: jest.fn().mockResolvedValue(20),
            getNoCourierRetrySeconds: jest.fn().mockResolvedValue(30),
          },
        } as any,
        mockCacheService
      )

      await service.handleOfferExpiryJob({
        deliveryId: 'del-val5',
        courierId: 'courier-val5',
        offeredAt: new Date(Date.now() - 25000).toISOString(),
      })

      // Courier status must NOT be modified by an expiry
      expect(mockCourierRepository.updateById).not.toHaveBeenCalled()
      if (mockCourierRepository.updateStatus) {
        expect(mockCourierRepository.updateStatus).not.toHaveBeenCalled()
      }
    })
  })
})
