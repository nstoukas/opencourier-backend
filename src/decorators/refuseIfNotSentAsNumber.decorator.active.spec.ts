import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { IsNumber, IsOptional } from 'class-validator'
import { RefuseIfNotSentAsNumber } from './refuseIfNotSentAsNumber.decorator'

// Dummy DTO class to test the RefuseIfNotSentAsNumber decorator in isolation
class TestDto {
  @IsOptional()
  @IsNumber()
  @RefuseIfNotSentAsNumber()
  testSetting?: number
}

describe('RefuseIfNotSentAsNumber decorator', () => {
  // Real ValidationPipe configured with exact main.ts options
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
  })

  it('refuses empty string with 400 BadRequestException naming the setting', async () => {
    const promise = pipe.transform({ testSetting: '' }, { type: 'body', metatype: TestDto })
    await expect(promise).rejects.toBeInstanceOf(BadRequestException)
    await expect(promise).rejects.toThrow('testSetting cannot be empty')
  })

  it('refuses whitespace-only string with 400 BadRequestException naming the setting', async () => {
    const promise = pipe.transform({ testSetting: '   ' }, { type: 'body', metatype: TestDto })
    await expect(promise).rejects.toBeInstanceOf(BadRequestException)
    await expect(promise).rejects.toThrow('testSetting cannot be empty')
  })

  it('refuses non-number types (false, [], "5", "abc") with 400 BadRequestException', async () => {
    for (const val of [false, [], '5', 'abc']) {
      const promise = pipe.transform({ testSetting: val }, { type: 'body', metatype: TestDto })
      await expect(promise).rejects.toBeInstanceOf(BadRequestException)
      await expect(promise).rejects.toThrow('testSetting must be sent as a number')
    }
  })

  it('allows real JSON number 0', async () => {
    const res = (await pipe.transform({ testSetting: 0 }, { type: 'body', metatype: TestDto })) as TestDto
    expect(res.testSetting).toBe(0)
  })

  it('allows real positive numbers', async () => {
    const res = (await pipe.transform({ testSetting: 100 }, { type: 'body', metatype: TestDto })) as TestDto
    expect(res.testSetting).toBe(100)
  })

  it('does not handle left-out fields (remains undefined)', async () => {
    const res = (await pipe.transform({}, { type: 'body', metatype: TestDto })) as TestDto
    expect(res.testSetting).toBeUndefined()
  })

  it('does not handle null (passes through decorator untouched)', async () => {
    const res = (await pipe.transform({ testSetting: null }, { type: 'body', metatype: TestDto })) as TestDto
    expect(res.testSetting).toBeNull()
  })
})
