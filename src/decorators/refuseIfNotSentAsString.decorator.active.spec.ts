import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { IsOptional, IsString } from 'class-validator'
import { RefuseIfNotSentAsString } from './refuseIfNotSentAsString.decorator'

// Dummy DTO to test RefuseIfNotSentAsString in isolation
class TestDto {
  @IsOptional()
  @IsString()
  @RefuseIfNotSentAsString()
  testSetting?: string
}

describe('RefuseIfNotSentAsString decorator (row 72, decision 72.3)', () => {
  // Real ValidationPipe configured with exact main.ts options (enableImplicitConversion: true)
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
  })

  it('refuses JSON numbers with 400 BadRequestException naming the setting', async () => {
    for (const num of [302421012345, 0, -1, 12.34]) {
      const promise = pipe.transform({ testSetting: num }, { type: 'body', metatype: TestDto })
      await expect(promise).rejects.toBeInstanceOf(BadRequestException)
      await expect(promise).rejects.toThrow('testSetting must be sent as text')
    }
  })

  it('refuses boolean values (true, false) with 400 BadRequestException naming the setting', async () => {
    for (const bool of [true, false]) {
      const promise = pipe.transform({ testSetting: bool }, { type: 'body', metatype: TestDto })
      await expect(promise).rejects.toBeInstanceOf(BadRequestException)
      await expect(promise).rejects.toThrow('testSetting must be sent as text')
    }
  })

  it('refuses null with 400 BadRequestException naming the setting', async () => {
    const promise = pipe.transform({ testSetting: null }, { type: 'body', metatype: TestDto })
    await expect(promise).rejects.toBeInstanceOf(BadRequestException)
    await expect(promise).rejects.toThrow('testSetting must be sent as text')
  })

  it('refuses array and object values with 400 BadRequestException naming the setting', async () => {
    for (const complex of [[], [123], {}, { phone: '123' }]) {
      const promise = pipe.transform({ testSetting: complex }, { type: 'body', metatype: TestDto })
      await expect(promise).rejects.toBeInstanceOf(BadRequestException)
      await expect(promise).rejects.toThrow('testSetting must be sent as text')
    }
  })

  it('allows valid string phone numbers', async () => {
    const res = (await pipe.transform(
      { testSetting: '+30 24210 12345' },
      { type: 'body', metatype: TestDto }
    )) as TestDto
    expect(res.testSetting).toBe('+30 24210 12345')
  })

  it('allows empty string and whitespace string', async () => {
    const emptyRes = (await pipe.transform({ testSetting: '' }, { type: 'body', metatype: TestDto })) as TestDto
    expect(emptyRes.testSetting).toBe('')

    const wsRes = (await pipe.transform({ testSetting: '   ' }, { type: 'body', metatype: TestDto })) as TestDto
    expect(wsRes.testSetting).toBe('   ')
  })

  it('allows absent field (leaves it undefined)', async () => {
    const res = (await pipe.transform({}, { type: 'body', metatype: TestDto })) as TestDto
    expect(res.testSetting).toBeUndefined()
  })
})
