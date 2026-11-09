import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { PartnerWaitRecordAdminArgs } from './partner-wait-record.admin.args'
import { WAIT_RECORD_DAYS } from 'src/domains/partner/wait-record'

// Spec 0030, AC-1: days is 7, 30 or 90; any other value is 400.
describe('PartnerWaitRecordAdminArgs validation (spec 0030, AC-1)', () => {
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  })

  const transform = (query: any) =>
    pipe.transform(query, { type: 'query', metatype: PartnerWaitRecordAdminArgs })

  test.each([7, 30, 90])('accepts valid numeric days=%p', async (days) => {
    const result = await transform({ days })
    expect(result).toBeInstanceOf(PartnerWaitRecordAdminArgs)
    expect(result.days).toBe(days)
  })

  test.each(['7', '30', '90'])('accepts valid string days=%p and transforms to number', async (daysStr) => {
    const result = await transform({ days: daysStr })
    expect(result).toBeInstanceOf(PartnerWaitRecordAdminArgs)
    expect(result.days).toBe(Number(daysStr))
  })

  test('accepts omitted days (defaults in controller)', async () => {
    const result = await transform({})
    expect(result).toBeInstanceOf(PartnerWaitRecordAdminArgs)
    expect(result.days).toBeUndefined()
  })

  test.each([0, 1, 14, 28, 60, 100, -1, 'abc', 'foo'])(
    'rejects invalid days=%p with BadRequestException (400)',
    async (invalidDays) => {
      await expect(transform({ days: invalidDays })).rejects.toThrow(BadRequestException)
    }
  )
})
