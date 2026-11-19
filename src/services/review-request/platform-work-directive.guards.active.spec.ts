import * as fs from 'fs'
import * as path from 'path'
import { STATE_MACHINE } from 'src/shared-types/stateMachine'
import { EnumDeliveryEventType } from '@prisma/types'

describe('Platform Work Directive Readiness Guards (spec 0038, AC-16)', () => {
  // AC-16 Guard 1: The server never stores a read record for a rider's review answer.
  describe('Guard: No read tracking stored for review requests (AC-9, AC-16)', () => {
    it('ReviewRequest schema contains no readAt, seenAt, openedAt, or isRead columns', () => {
      const schemaPath = path.resolve(__dirname, '../../../prisma/schema.prisma')
      const schema = fs.readFileSync(schemaPath, 'utf8')

      const reviewRequestModelMatch = schema.match(/model ReviewRequest \{([\s\S]*?)\n\}/)
      expect(reviewRequestModelMatch).toBeDefined()
      const modelBody = reviewRequestModelMatch![1]!

      expect(modelBody).not.toMatch(/\breadAt\b/i)
      expect(modelBody).not.toMatch(/\bseenAt\b/i)
      expect(modelBody).not.toMatch(/\bopenedAt\b/i)
      expect(modelBody).not.toMatch(/\bisRead\b/i)
      expect(modelBody).not.toMatch(/\breadBy\b/i)
    })
  })

  // AC-16 Guard 2: No review event is in STATE_MACHINE or allowed via processDeliveryEvent.
  describe('Guard: Review events have no status transitions in STATE_MACHINE (AC-4, AC-16)', () => {
    it('STATE_MACHINE contains no transitions for REVIEW_REQUESTED, REVIEW_ANSWERED, or COURIER_PAID_FOR_REVIEW', () => {
      const reviewTypes = [
        EnumDeliveryEventType.REVIEW_REQUESTED,
        EnumDeliveryEventType.REVIEW_ANSWERED,
        EnumDeliveryEventType.COURIER_PAID_FOR_REVIEW,
      ]

      for (const status of Object.keys(STATE_MACHINE)) {
        const transitions = STATE_MACHINE[status as keyof typeof STATE_MACHINE].on
        for (const reviewType of reviewTypes) {
          expect(transitions[reviewType as keyof typeof transitions]).toBeUndefined()
        }
      }
    })
  })

  // AC-16 Guard 3: Only admin answer and rider withdrawal can move a request out of OPEN.
  describe('Guard: Only admin answer and rider withdrawal update ReviewRequest.status (AC-6, AC-8, AC-16)', () => {
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

    it('scans all src files for writes to ReviewRequest status and allows only create, answer, and withdrawIfOpen in ReviewRequestRepository', () => {
      const srcDir = path.resolve(__dirname, '../..')
      const tsFiles = findFiles(
        srcDir,
        (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts') && !f.endsWith('.test.ts')
      )
      expect(tsFiles.length).toBeGreaterThan(100)

      const repoRelative = 'persistence/repositories/review-request.repository.ts'
      const violations: string[] = []

      for (const file of tsFiles) {
        const content = fs.readFileSync(file, 'utf8')
        const isRepo = file.endsWith(repoRelative)

        // 1. Raw SQL touching ReviewRequest and status
        if (/ReviewRequest/i.test(content) && /\$executeRaw|\$queryRaw/.test(content)) {
          if (/\bstatus\b/i.test(content)) {
            violations.push(`${path.basename(file)}: raw SQL touching ReviewRequest status`)
          }
        }

        if (!isRepo) {
          // 2. Any Prisma write to reviewRequest outside repository
          if (/\.reviewRequest\s*\.\s*(update|updateMany|upsert|create|createMany)\b/.test(content)) {
            violations.push(`${path.basename(file)}: reviewRequest write outside ReviewRequestRepository`)
          }

          // 3. Any assignment of ReviewRequest status outside repository (e.g. stray status: EnumReviewRequestStatus.ANSWERED)
          if (/status:\s*EnumReviewRequestStatus\.(ANSWERED|WITHDRAWN|OPEN)/.test(content)) {
            violations.push(`${path.basename(file)}: stray ReviewRequest status assignment`)
          }
        } else {
          // Inside review-request.repository.ts:
          // Check create method
          const createMatch = content.match(/async\s+create\s*\([^)]*\)[\s\S]*?return\s+this\.findById/)
          expect(createMatch).not.toBeNull()
          const createBody = createMatch![0]
          if (/status:\s*EnumReviewRequestStatus\.(ANSWERED|WITHDRAWN)/.test(createBody)) {
            violations.push('create() sets non-OPEN status')
          }

          // Check answer method: must set ANSWERED conditional on where status OPEN
          const answerMatch = content.match(
            /async\s+answer\s*\([^)]*\)[\s\S]*?return\s+\{\s*courierId:\s*request\.courierId\s*\}/
          )
          expect(answerMatch).not.toBeNull()
          const answerBody = answerMatch![0]
          if (!/where:\s*\{[^}]*status:\s*EnumReviewRequestStatus\.OPEN/.test(answerBody)) {
            violations.push('answer() missing conditional where status OPEN')
          }
          if (!/data:\s*\{[^}]*status:\s*EnumReviewRequestStatus\.ANSWERED/.test(answerBody)) {
            violations.push('answer() does not set status to ANSWERED')
          }
          if (/data:\s*\{[^}]*status:\s*EnumReviewRequestStatus\.(WITHDRAWN|OPEN)/.test(answerBody)) {
            violations.push('answer() sets illegal status')
          }

          // Check withdrawIfOpen method: must set WITHDRAWN conditional on where status OPEN
          const withdrawMatch = content.match(
            /async\s+withdrawIfOpen\s*\([^)]*\)[\s\S]*?return\s+count\s*===\s*1/
          )
          expect(withdrawMatch).not.toBeNull()
          const withdrawBody = withdrawMatch![0]
          if (!/where:\s*\{[^}]*status:\s*EnumReviewRequestStatus\.OPEN/.test(withdrawBody)) {
            violations.push('withdrawIfOpen() missing conditional where status OPEN')
          }
          if (!/data:\s*\{[^}]*status:\s*EnumReviewRequestStatus\.WITHDRAWN/.test(withdrawBody)) {
            violations.push('withdrawIfOpen() does not set status to WITHDRAWN')
          }
          if (/data:\s*\{[^}]*status:\s*EnumReviewRequestStatus\.(ANSWERED|OPEN)/.test(withdrawBody)) {
            violations.push('withdrawIfOpen() sets illegal status')
          }

          // Ensure exactly 3 prisma reviewRequest writes in review-request.repository.ts
          const prismaWrites =
            content.match(/\breviewRequest\s*\.\s*(create|createMany|update|updateMany|upsert)\b/g) || []
          if (prismaWrites.length !== 3) {
            violations.push(
              `review-request.repository.ts has ${prismaWrites.length} writes to reviewRequest, expected exactly 3`
            )
          }
        }
      }

      expect(violations).toEqual([])
    })
  })

  // AC-16 Guard 4: Review events are saved with null statuses.
  describe('Guard: Review events are saved with oldStatus and newStatus null (AC-4, AC-16)', () => {
    it('review-request.repository.ts writes oldStatus: null and newStatus: null on all review events', () => {
      const repoPath = path.resolve(__dirname, '../../persistence/repositories/review-request.repository.ts')
      const code = fs.readFileSync(repoPath, 'utf8')

      // Check that deliveryEvent.create calls in review-request.repository have oldStatus: null and newStatus: null
      const eventCreations = code.split('tx.deliveryEvent.create')
      expect(eventCreations.length).toBe(4) // 1 in create (REVIEW_REQUESTED), 2 in answer (REVIEW_ANSWERED, COURIER_PAID_FOR_REVIEW)

      for (let i = 1; i < eventCreations.length; i++) {
        const block = eventCreations[i]!.slice(0, 500)
        expect(block).toContain('oldStatus: null')
        expect(block).toContain('newStatus: null')
        expect(block).toContain('transitionSuccessful: true')
      }
    })
  })

  // AC-16 Guard 5: Location updates and offline state.
  describe('Guard: Location update and offline switch require active delivery condition (AC-14, AC-15, AC-16)', () => {
    it('courier.repository.ts enforces offline / busy condition in updateCurrentLocationById', () => {
      const repoPath = path.resolve(__dirname, '../../persistence/repositories/courier.repository.ts')
      const code = fs.readFileSync(repoPath, 'utf8')

      expect(code).toContain('"status"::text <> ${EnumCourierStatus.OFFLINE} OR EXISTS (${busyCourierDeliverySubQuery()})')
      expect(code).toContain('CASE WHEN EXISTS (${busyCourierDeliverySubQuery()}) THEN "currentLocation" ELSE NULL END')
    })
  })

  // AC-16 Guard 6: SettingChange is written only when effective value changed.
  describe('Guard: SettingChange write requires !isSameSettingValue check (AC-12, AC-16)', () => {
    it('instance-config.domain.service.ts guards writeSettingChange with !isSameSettingValue', () => {
      const servicePath = path.resolve(__dirname, '../../domains/config/instance-config.domain.service.ts')
      const code = fs.readFileSync(servicePath, 'utf8')

      expect(code).toContain('if (!isSameSettingValue(before[write.key], write.value))')
      expect(code).toContain('await writeSettingChange(tx, {')
    })
  })
})
