import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { DropoffPointCourierInput } from './dropoff-point.courier.input'

describe('DropoffPointCourierInput through ValidationPipe (Spec 0016 AC-9)', () => {
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  })

  const transform = (body: any) =>
    pipe.transform(body, { type: 'body', metatype: DropoffPointCourierInput })

  it('accepts valid latitude and longitude numbers', async () => {
    const result = (await transform({
      latitude: 39.3622,
      longitude: 22.9425,
    })) as DropoffPointCourierInput

    expect(result).toBeInstanceOf(DropoffPointCourierInput)
    expect(result.latitude).toBe(39.3622)
    expect(result.longitude).toBe(22.9425)
  })

  it('accepts coordinate range boundaries (-90, 90, -180, 180)', async () => {
    const minResult = (await transform({ latitude: -90, longitude: -180 })) as DropoffPointCourierInput
    expect(minResult.latitude).toBe(-90)
    expect(minResult.longitude).toBe(-180)

    const maxResult = (await transform({ latitude: 90, longitude: 180 })) as DropoffPointCourierInput
    expect(maxResult.latitude).toBe(90)
    expect(maxResult.longitude).toBe(180)
  })

  it('refuses latitude sent as string with 400 BadRequestException (@RefuseIfNotSentAsNumber)', async () => {
    await expect(
      transform({ latitude: '39.3622', longitude: 22.9425 })
    ).rejects.toThrow(BadRequestException)
  })

  it('refuses longitude sent as string with 400 BadRequestException (@RefuseIfNotSentAsNumber)', async () => {
    await expect(
      transform({ latitude: 39.3622, longitude: '22.9425' })
    ).rejects.toThrow(BadRequestException)
  })

  it('refuses boolean or empty string for latitude/longitude with 400 BadRequestException', async () => {
    await expect(
      transform({ latitude: '', longitude: 22.9425 })
    ).rejects.toThrow(BadRequestException)

    await expect(
      transform({ latitude: true, longitude: 22.9425 })
    ).rejects.toThrow(BadRequestException)

    await expect(
      transform({ latitude: 39.3622, longitude: false })
    ).rejects.toThrow(BadRequestException)
  })

  it('refuses latitude out of range (> 90 or < -90) with 400 BadRequestException', async () => {
    await expect(
      transform({ latitude: 90.001, longitude: 22.9425 })
    ).rejects.toThrow(BadRequestException)

    await expect(
      transform({ latitude: -90.001, longitude: 22.9425 })
    ).rejects.toThrow(BadRequestException)
  })

  it('refuses longitude out of range (> 180 or < -180) with 400 BadRequestException', async () => {
    await expect(
      transform({ latitude: 39.3622, longitude: 180.001 })
    ).rejects.toThrow(BadRequestException)

    await expect(
      transform({ latitude: 39.3622, longitude: -180.001 })
    ).rejects.toThrow(BadRequestException)
  })

  it('refuses missing latitude or longitude with 400 BadRequestException', async () => {
    await expect(transform({ latitude: 39.3622 })).rejects.toThrow(BadRequestException)
    await expect(transform({ longitude: 22.9425 })).rejects.toThrow(BadRequestException)
    await expect(transform({})).rejects.toThrow(BadRequestException)
  })
})
