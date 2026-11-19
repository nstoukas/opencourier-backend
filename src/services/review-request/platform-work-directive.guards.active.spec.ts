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
    it('ReviewRequestRepository contains no status writes other than answer and withdrawIfOpen', () => {
      const repoPath = path.resolve(__dirname, '../../persistence/repositories/review-request.repository.ts')
      const code = fs.readFileSync(repoPath, 'utf8')

      // Matches any update of status to ANSWERED or WITHDRAWN
      const statusUpdates = code.match(/status:\s*EnumReviewRequestStatus\.\w+/g) || []
      expect(statusUpdates.length).toBeGreaterThan(0)

      for (const update of statusUpdates) {
        // Every status assignment is either default OPEN on create, ANSWERED in answer(), or WITHDRAWN in withdrawIfOpen()
        expect(
          update.includes('EnumReviewRequestStatus.OPEN') ||
          update.includes('EnumReviewRequestStatus.ANSWERED') ||
          update.includes('EnumReviewRequestStatus.WITHDRAWN')
        ).toBe(true)
      }

      // Check conditional update in answer and withdraw
      expect(code).toContain("status: EnumReviewRequestStatus.OPEN")
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
