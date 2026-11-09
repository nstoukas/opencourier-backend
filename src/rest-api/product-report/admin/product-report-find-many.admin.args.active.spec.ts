import { BadRequestException, ValidationPipe } from '@nestjs/common'
import {
  ProductReportFindManyAdminArgs,
  ProductReportResolveAdminInput,
} from './product-report-find-many.admin.args'

describe('ProductReportFindManyAdminArgs through ValidationPipe (Spec 0032, AC-6)', () => {
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  })

  const transformArgs = (query: unknown) =>
    pipe.transform(query, { type: 'query', metatype: ProductReportFindManyAdminArgs })

  test.each(['open', 'resolved', 'all'] as const)(
    'accepts valid state "%s"',
    async (state) => {
      const result = (await transformArgs({ state, page: '2', perPage: '10' })) as ProductReportFindManyAdminArgs

      expect(result).toBeInstanceOf(ProductReportFindManyAdminArgs)
      expect(result.state).toBe(state)
      expect(result.page).toBe(2)
      expect(result.perPage).toBe(10)
    }
  )

  test('accepts empty query arguments', async () => {
    const result = (await transformArgs({})) as ProductReportFindManyAdminArgs

    expect(result.state).toBeUndefined()
    expect(result.page).toBeUndefined()
    expect(result.perPage).toBeUndefined()
  })

  test('refuses invalid state with 400 BadRequestException', async () => {
    await expect(transformArgs({ state: 'pending' })).rejects.toBeInstanceOf(BadRequestException)
  })

  test('refuses non-numeric page with 400 BadRequestException', async () => {
    await expect(transformArgs({ page: 'abc' })).rejects.toBeInstanceOf(BadRequestException)
  })
})

describe('ProductReportResolveAdminInput through ValidationPipe (Spec 0032, AC-7)', () => {
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  })

  const transformBody = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: ProductReportResolveAdminInput })

  test('accepts optional resolution up to 500 characters', async () => {
    const res500 = 'z'.repeat(500)
    const result = (await transformBody({ resolution: res500 })) as ProductReportResolveAdminInput

    expect(result).toBeInstanceOf(ProductReportResolveAdminInput)
    expect(result.resolution).toBe(res500)
  })

  test('accepts empty body without resolution', async () => {
    const result = (await transformBody({})) as ProductReportResolveAdminInput

    expect(result.resolution).toBeUndefined()
  })

  test('refuses resolution exceeding 500 characters with 400 BadRequestException', async () => {
    await expect(transformBody({ resolution: 'z'.repeat(501) })).rejects.toBeInstanceOf(
      BadRequestException
    )
  })
})
