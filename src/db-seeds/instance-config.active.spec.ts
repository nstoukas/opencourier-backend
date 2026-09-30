import { PrismaClient } from '@prisma/types'
import { seedInitialInstanceConfig } from './instance-config'

describe('seedInitialInstanceConfig', () => {
  let mockFindUnique: jest.Mock
  let mockCreate: jest.Mock
  let prismaStub: PrismaClient

  beforeEach(() => {
    mockFindUnique = jest.fn().mockResolvedValue(null) // By default, no rows exist
    mockCreate = jest.fn().mockResolvedValue({})

    // Simple stub for PrismaClient with only the config repository methods used in seeds
    prismaStub = {
      config: {
        findUnique: mockFindUnique,
        create: mockCreate,
      },
    } as unknown as PrismaClient
  })

  // 9 & 10. Checks currency is seeded as 'EUR' with type 'string'
  it('seeds currency config as EUR with string type', async () => {
    await seedInitialInstanceConfig(prismaStub)

    // Find the call for the 'currency' key
    const currencyCall = mockCreate.mock.calls.find(
      ([arg]: any) => arg?.data?.key === 'currency'
    )

    expect(currencyCall).toBeDefined()
    expect(currencyCall[0].data.value).toBe('EUR') // 9. Concrete string comparison against 'EUR'
    expect(currencyCall[0].data.type).toBe('string') // 10. Type derived from typeof value
  })

  // 11. Regression guard: no created config has value 'USD'
  it('never seeds any config with USD as value', async () => {
    await seedInitialInstanceConfig(prismaStub)

    const usdCalls = mockCreate.mock.calls.filter(
      ([arg]: any) => arg?.data?.value === 'USD'
    )

    expect(usdCalls).toHaveLength(0)
  })

  // 12. Regression guard: distanceUnit is still seeded as 'KILOMETERS'
  it('seeds distanceUnit as KILOMETERS without disturbing neighboring configs', async () => {
    await seedInitialInstanceConfig(prismaStub)

    const distanceUnitCall = mockCreate.mock.calls.find(
      ([arg]: any) => arg?.data?.key === 'distanceUnit'
    )

    expect(distanceUnitCall).toBeDefined()
    expect(distanceUnitCall[0].data.value).toBe('KILOMETERS')
  })

  // 13. Re-seeding when currency row exists does not overwrite it (binding value 2)
  it('does not overwrite an existing currency config row if one already exists', async () => {
    mockFindUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === 'currency') {
        return { key: 'currency', value: 'USD', type: 'string' }
      }
      return null
    })

    await seedInitialInstanceConfig(prismaStub)

    const currencyCreateCall = mockCreate.mock.calls.find(
      ([arg]: any) => arg?.data?.key === 'currency'
    )

    expect(currencyCreateCall).toBeUndefined()
  })

  // F1. quoteCalculationType is seeded as 'BY_DISTANCE' with type: 'string'
  it('seeds quoteCalculationType as BY_DISTANCE with string type', async () => {
    await seedInitialInstanceConfig(prismaStub)

    const quoteTypeCall = mockCreate.mock.calls.find(
      ([arg]: any) => arg?.data?.key === 'quoteCalculationType'
    )

    expect(quoteTypeCall).toBeDefined()
    expect(quoteTypeCall[0].data.value).toBe('BY_DISTANCE')
    expect(quoteTypeCall[0].data.type).toBe('string')
  })

  // F2. quoteRatePerDistanceUnit is seeded as '150' with type: 'number'
  it('seeds quoteRatePerDistanceUnit as 150 with number type', async () => {
    await seedInitialInstanceConfig(prismaStub)

    const rateCall = mockCreate.mock.calls.find(
      ([arg]: any) => arg?.data?.key === 'quoteRatePerDistanceUnit'
    )

    expect(rateCall).toBeDefined()
    expect(rateCall[0].data.value).toBe('150')
    expect(rateCall[0].data.type).toBe('number')
  })

  // F4. Existing quoteCalculationType row is not overwritten
  it('does not overwrite an existing quoteCalculationType config row if one already exists', async () => {
    mockFindUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === 'quoteCalculationType') {
        return { key: 'quoteCalculationType', value: 'CUSTOM', type: 'string' }
      }
      return null
    })

    await seedInitialInstanceConfig(prismaStub)

    const quoteTypeCreateCall = mockCreate.mock.calls.find(
      ([arg]: any) => arg?.data?.key === 'quoteCalculationType'
    )

    expect(quoteTypeCreateCall).toBeUndefined()
  })
})

