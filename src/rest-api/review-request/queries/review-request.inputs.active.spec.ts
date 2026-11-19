import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { EnumReviewOutcome, EnumReviewTopic } from '@prisma/types'
import {
  ReviewRequestAnswerAdminInput,
  ReviewRequestCreateCourierInput,
} from './review-request.inputs'

// Spec 0038, AC-1, AC-6, AC-7: review request DTO validation.
// The pipe is configured with enableImplicitConversion: true (from src/main.ts),
// which converts strings to numbers unless @RefuseIfNotSentAsNumber() guards the property.
describe('ReviewRequest inputs validation (spec 0038, AC-7)', () => {
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  })

  const answerBody = (body: Record<string, unknown>) =>
    pipe.transform(body, { type: 'body', metatype: ReviewRequestAnswerAdminInput })

  const createBody = (body: Record<string, unknown>) =>
    pipe.transform(body, { type: 'body', metatype: ReviewRequestCreateCourierInput })

  describe('ReviewRequestAnswerAdminInput', () => {
    it('accepts valid whole number correctionCents alongside outcome and answer', async () => {
      const valid = {
        outcome: EnumReviewOutcome.CHANGED,
        answer: 'Corrected rider pay',
        correctionCents: 150,
      }
      const result = (await answerBody(valid)) as ReviewRequestAnswerAdminInput
      expect(result).toBeInstanceOf(ReviewRequestAnswerAdminInput)
      expect(result.correctionCents).toBe(150)
      expect(result.outcome).toBe(EnumReviewOutcome.CHANGED)
      expect(result.answer).toBe('Corrected rider pay')
    })

    it('accepts omitted or null correctionCents', async () => {
      const withoutCorrection = (await answerBody({
        outcome: EnumReviewOutcome.STANDS,
        answer: 'Decision stands',
      })) as ReviewRequestAnswerAdminInput
      expect(withoutCorrection.correctionCents).toBeUndefined()

      const withNullCorrection = (await answerBody({
        outcome: EnumReviewOutcome.STANDS,
        answer: 'Decision stands',
        correctionCents: null,
      })) as ReviewRequestAnswerAdminInput
      expect(withNullCorrection.correctionCents).toBeNull()
    })

    it('refuses correctionCents arriving as a string (400) via @RefuseIfNotSentAsNumber', async () => {
      for (const invalid of ['150', '0', 'true', 'false', 'abc']) {
        const promise = answerBody({
          outcome: EnumReviewOutcome.CHANGED,
          answer: 'Corrected rider pay',
          correctionCents: invalid,
        })
        await expect(promise).rejects.toBeInstanceOf(BadRequestException)
      }
    })

    it('refuses correctionCents arriving as a float (400) via @IsInt', async () => {
      for (const invalidFloat of [150.5, 0.1, 12.34]) {
        const promise = answerBody({
          outcome: EnumReviewOutcome.CHANGED,
          answer: 'Corrected rider pay',
          correctionCents: invalidFloat,
        })
        await expect(promise).rejects.toBeInstanceOf(BadRequestException)
      }
    })

    it('refuses correctionCents arriving as a boolean (400) via @RefuseIfNotSentAsNumber', async () => {
      for (const invalidBool of [true, false]) {
        const promise = answerBody({
          outcome: EnumReviewOutcome.CHANGED,
          answer: 'Corrected rider pay',
          correctionCents: invalidBool,
        })
        await expect(promise).rejects.toBeInstanceOf(BadRequestException)
      }
    })
  })

  describe('ReviewRequestCreateCourierInput', () => {
    it('accepts valid topic and note', async () => {
      const valid = {
        topic: EnumReviewTopic.PAY,
        note: 'Review request note from rider',
        deliveryId: 'del-123',
      }
      const result = (await createBody(valid)) as ReviewRequestCreateCourierInput
      expect(result).toBeInstanceOf(ReviewRequestCreateCourierInput)
      expect(result.topic).toBe(EnumReviewTopic.PAY)
      expect(result.note).toBe('Review request note from rider')
      expect(result.deliveryId).toBe('del-123')
    })
  })
})
