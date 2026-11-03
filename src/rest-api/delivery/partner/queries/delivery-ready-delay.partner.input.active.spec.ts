import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { DeliveryReadyDelayPartnerInput } from './delivery-ready-delay.partner.input'

// Spec 0023, AC-3: the body of POST partner deliveries/:id/ready-delay, through the same
// ValidationPipe main.ts installs (implicit conversion on), so "10" as text is seen as it is sent.
describe('DeliveryReadyDelayPartnerInput through ValidationPipe (spec 0023, AC-3)', () => {
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  })

  const transform = (body: unknown) => pipe.transform(body, { type: 'body', metatype: DeliveryReadyDelayPartnerInput })

  const shown = '2026-11-03T12:18:00.000Z'

  test.each([5, 10, 15])('accepts minutes %d with an ISO expectedReadyAt', async (minutes) => {
    const result = (await transform({ minutes, expectedReadyAt: shown })) as DeliveryReadyDelayPartnerInput

    expect(result).toBeInstanceOf(DeliveryReadyDelayPartnerInput)
    expect(result.minutes).toBe(minutes)
    expect(result.expectedReadyAt).toBe(shown)
  })

  test('accepts expectedReadyAt null (an order with no ready time)', async () => {
    const result = (await transform({ minutes: 10, expectedReadyAt: null })) as DeliveryReadyDelayPartnerInput

    expect(result.expectedReadyAt).toBeNull()
  })

  test.each([0, 1, 4, 6, 7, 9, 11, 20, 30, -5, 10.5, 100])('refuses minutes %p with 400', async (minutes) => {
    await expect(transform({ minutes, expectedReadyAt: shown })).rejects.toThrow(BadRequestException)
  })

  test('refuses "10" sent as text with 400', async () => {
    await expect(transform({ minutes: '10', expectedReadyAt: shown })).rejects.toThrow(BadRequestException)
  })

  test('refuses an empty minutes, true and a missing minutes with 400', async () => {
    await expect(transform({ minutes: '', expectedReadyAt: shown })).rejects.toThrow(BadRequestException)
    await expect(transform({ minutes: true, expectedReadyAt: shown })).rejects.toThrow(BadRequestException)
    await expect(transform({ expectedReadyAt: shown })).rejects.toThrow(BadRequestException)
  })

  test('refuses a missing expectedReadyAt with 400 (null must be sent on purpose)', async () => {
    await expect(transform({ minutes: 10 })).rejects.toThrow(BadRequestException)
  })

  test('refuses an expectedReadyAt that is not an ISO time with 400', async () => {
    await expect(transform({ minutes: 10, expectedReadyAt: 'soon' })).rejects.toThrow(BadRequestException)
    await expect(transform({ minutes: 10, expectedReadyAt: '' })).rejects.toThrow(BadRequestException)
  })
})
