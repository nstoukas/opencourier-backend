import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { SavedCustomerCreatePartnerInput } from './saved-customer-create.partner.input'

describe('SavedCustomerCreatePartnerInput through ValidationPipe (Spec 0005)', () => {
  // Real Nest ValidationPipe built with exact options from src/main.ts
  const pipe = new ValidationPipe({
    transform: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
  })

  const validBody = {
    name: 'Nikos Dimas',
    phone: '6912345678',
    notes: 'Ring bell',
    addressLine1: 'Iasonos 10',
    addressLine2: '2nd floor',
    city: 'Volos',
    zipCode: '38221',
    latitude: 39.362,
    longitude: 22.945,
    formattedAddress: 'Iasonos 10, Volos',
    onPhoneClash: 'refuse',
    markUsed: true,
  }

  const transform = (body: any) =>
    pipe.transform(body, { type: 'body', metatype: SavedCustomerCreatePartnerInput })

  it('passes validation for a valid body', async () => {
    const transformed = await transform(validBody)
    expect(transformed).toBeInstanceOf(SavedCustomerCreatePartnerInput)
    expect(transformed.name).toBe('Nikos Dimas')
    expect(transformed.latitude).toBe(39.362)
    expect(transformed.markUsed).toBe(true)
  })

  it('refuses missing name with 400 BadRequestException', async () => {
    const { name, ...missingNameBody } = validBody
    await expect(transform(missingNameBody)).rejects.toBeInstanceOf(BadRequestException)
  })

  it('refuses name null with 400 BadRequestException', async () => {
    await expect(transform({ ...validBody, name: null })).rejects.toBeInstanceOf(BadRequestException)
  })

  it('refuses latitude "" with 400 BadRequestException', async () => {
    await expect(transform({ ...validBody, latitude: '' })).rejects.toBeInstanceOf(BadRequestException)
  })

  it('refuses latitude 95 (> 90) with 400 BadRequestException', async () => {
    await expect(transform({ ...validBody, latitude: 95 })).rejects.toBeInstanceOf(BadRequestException)
  })

  it('refuses onPhoneClash "maybe" with 400 BadRequestException', async () => {
    await expect(transform({ ...validBody, onPhoneClash: 'maybe' })).rejects.toBeInstanceOf(BadRequestException)
  })

  it('refuses markUsed "false" with 400 BadRequestException', async () => {
    await expect(transform({ ...validBody, markUsed: 'false' })).rejects.toBeInstanceOf(BadRequestException)
  })

  it('refuses name of 256 characters with 400 BadRequestException', async () => {
    const longName = 'A'.repeat(256)
    await expect(transform({ ...validBody, name: longName })).rejects.toBeInstanceOf(BadRequestException)
  })
})
