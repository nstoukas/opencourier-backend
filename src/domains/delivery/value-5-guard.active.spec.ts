import * as fs from 'fs'
import * as path from 'path'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { EnumDeliveryStatus } from '@prisma/types'
import { OfferPushService } from 'src/services/pushNotification/offer-push.service'

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

  // Value 5 / AC-12 helper: scans content for any grouping, counting, or aggregating of DeliveryEvent rows by courierId
  function inspectPersistenceContentForValue5Violations(content: string): string[] {
    const violations: string[] = []

    // 1. deliveryEvent.groupBy with courierId as array or string
    const groupByRegex = /deliveryEvent\.groupBy\s*\(\s*\{[\s\S]*?by:\s*(\[[\s\S]*?['"`]courierId['"`]|['"`]courierId['"`])/
    if (groupByRegex.test(content)) {
      violations.push('deliveryEvent.groupBy with courierId')
    }

    // 2. _count over Courier relation deliveryEvents
    const countRelationRegex = /(_count\s*:\s*\{[\s\S]*?\bdeliveryEvents\b|\bdeliveryEvents\s*:\s*\{[\s\S]*?\b_count\b)/
    if (countRelationRegex.test(content)) {
      violations.push('_count over Courier relation deliveryEvents')
    }

    // 3. deliveryEvent.count or deliveryEvent.aggregate whose where uses courierId
    const countWhereCourierIdRegex = /deliveryEvent\.(count|aggregate)\s*\(\s*\{[\s\S]*?where\s*:\s*\{[\s\S]*?\bcourierId\s*:/
    if (countWhereCourierIdRegex.test(content)) {
      violations.push('deliveryEvent.count/aggregate where courierId')
    }

    // 4. Raw SQL GROUP BY on "DeliveryEvent"."courierId" or DeliveryEvent.courierId
    const rawSqlGroupByRegex = /((FROM|JOIN)\s+["']?DeliveryEvent["']?[\s\S]*?GROUP\s+BY\s+[\s\S]*?["']?(DeliveryEvent["']?\.)?["']?courierId["']?|GROUP\s+BY\s+[\s\S]*?["']?DeliveryEvent["']?\.["']?courierId["']?)/i
    if (rawSqlGroupByRegex.test(content)) {
      violations.push('raw SQL GROUP BY on DeliveryEvent.courierId')
    }

    // 5. Raw SQL COUNT over DeliveryEvent with courierId
    const rawSqlCountRegex = /SELECT[\s\S]*?\bCOUNT\s*\([^)]*\)[\s\S]*?FROM\s+["']?DeliveryEvent["']?[\s\S]*?WHERE[\s\S]*?["']?(DeliveryEvent["']?\.)?["']?courierId["']?/i
    if (rawSqlCountRegex.test(content)) {
      violations.push('raw SQL COUNT over DeliveryEvent with courierId')
    }

    return violations
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
    // Scan all persistence files under src/persistence (repositories, helpers, modules)
    const persistenceFiles = findFiles(
      path.join(rootSrc, 'persistence'),
      (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts')
    )

    it('finds persistence source files to check', () => {
      expect(persistenceFiles.length).toBeGreaterThan(0)
    })

    persistenceFiles.forEach((file) => {
      const relativePath = path.relative(rootSrc, file)

      it(`ensures ${relativePath} does not group, count or aggregate DeliveryEvent by courierId in any spelling`, () => {
        const content = fs.readFileSync(file, 'utf8')
        const violations = inspectPersistenceContentForValue5Violations(content)
        expect(violations).toEqual([])
      })
    })

    describe('Pattern detection verification (proves each forbidden pattern bites)', () => {
      it('catches deliveryEvent.groupBy with by as array containing courierId', () => {
        const badSnippet = `
          const result = await this.prisma.deliveryEvent.groupBy({
            by: ['courierId'],
            _count: true,
          })
        `
        const violations = inspectPersistenceContentForValue5Violations(badSnippet)
        expect(violations).toContain('deliveryEvent.groupBy with courierId')
      })

      it('catches deliveryEvent.groupBy with by as string courierId', () => {
        const badSnippet = `
          const result = await this.prisma.deliveryEvent.groupBy({
            by: 'courierId',
            _count: true,
          })
        `
        const violations = inspectPersistenceContentForValue5Violations(badSnippet)
        expect(violations).toContain('deliveryEvent.groupBy with courierId')
      })

      it('catches _count over Courier relation deliveryEvents', () => {
        const badSnippet = `
          const couriers = await this.prisma.courier.findMany({
            select: {
              id: true,
              _count: {
                select: { deliveryEvents: true },
              },
            },
          })
        `
        const violations = inspectPersistenceContentForValue5Violations(badSnippet)
        expect(violations).toContain('_count over Courier relation deliveryEvents')
      })

      it('catches deliveryEvent.count whose where uses courierId', () => {
        const badSnippet = `
          const count = await this.prisma.deliveryEvent.count({
            where: {
              courierId: 'courier-1',
              type: EnumDeliveryEventType.OFFER_EXPIRED,
            },
          })
        `
        const violations = inspectPersistenceContentForValue5Violations(badSnippet)
        expect(violations).toContain('deliveryEvent.count/aggregate where courierId')
      })

      it('catches deliveryEvent.aggregate whose where uses courierId', () => {
        const badSnippet = `
          const agg = await this.prisma.deliveryEvent.aggregate({
            where: {
              courierId: 'courier-1',
            },
            _count: true,
          })
        `
        const violations = inspectPersistenceContentForValue5Violations(badSnippet)
        expect(violations).toContain('deliveryEvent.count/aggregate where courierId')
      })

      it('catches raw SQL GROUP BY on "DeliveryEvent"."courierId"', () => {
        const badSnippet = `
          await this.prisma.$queryRaw\`
            SELECT "courierId", COUNT(*)
            FROM "DeliveryEvent"
            GROUP BY "DeliveryEvent"."courierId"
          \`
        `
        const violations = inspectPersistenceContentForValue5Violations(badSnippet)
        expect(violations).toContain('raw SQL GROUP BY on DeliveryEvent.courierId')
      })

      it('catches raw SQL COUNT over DeliveryEvent with courierId in WHERE', () => {
        const badSnippet = `
          await this.prisma.$queryRaw\`
            SELECT COUNT(*)
            FROM "DeliveryEvent"
            WHERE "courierId" = \${courierId}
          \`
        `
        const violations = inspectPersistenceContentForValue5Violations(badSnippet)
        expect(violations).toContain('raw SQL COUNT over DeliveryEvent with courierId')
      })

      it('permits legitimate earnings queries selecting by Delivery courierId (not DeliveryEvent.courierId)', () => {
        const allowedEarningsSnippet = `
          const events = await this.prisma.deliveryEvent.findMany({
            where: {
              transitionSuccessful: true,
              newStatus: EnumDeliveryStatus.DROPPED_OFF,
              delivery: {
                is: {
                  courierId,
                },
              },
            },
          })
        `
        const violations = inspectPersistenceContentForValue5Violations(allowedEarningsSnippet)
        expect(violations).toEqual([])
      })

      it('permits legitimate DeliveryEventAdminDto declaring courierId property', () => {
        const allowedDtoSnippet = `
          export class DeliveryEventAdminDto {
            @ApiProperty({ type: String, nullable: true })
            courierId: string | null
          }
        `
        const violations = inspectPersistenceContentForValue5Violations(allowedDtoSnippet)
        expect(violations).toEqual([])
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
        mockCacheService,
        // Spec 0003 added the offer push service; push is not under test here.
        { newOffer: jest.fn(), offerEnded: jest.fn() } as unknown as OfferPushService
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

  describe('Spec 0003 AC-13 / Value 5: CourierDevice columns in schema.prisma equal explicit allow list', () => {
    it('asserts CourierDevice columns in prisma/schema.prisma equal an explicit allow list (columns it has today)', () => {
      const schemaPath = path.resolve(process.cwd(), 'prisma/schema.prisma')
      const schemaContent = fs.readFileSync(schemaPath, 'utf8')

      const modelMatch = schemaContent.match(/model\s+CourierDevice\s+\{([^}]+)\}/)
      expect(modelMatch).not.toBeNull()

      const modelBody = modelMatch ? modelMatch[1] ?? '' : ''
      const fieldLines = modelBody
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('//') && !line.startsWith('@@'))

      const columnNames = fieldLines
        .filter((line) => !line.includes('@relation'))
        .map((line) => line.split(/\s+/)[0])
        .sort()

      const ALLOWED_COLUMNS = ['createdAt', 'courierId', 'id', 'platform', 'token'].sort()
      expect(columnNames).toEqual(ALLOWED_COLUMNS)
    })
  })
})
