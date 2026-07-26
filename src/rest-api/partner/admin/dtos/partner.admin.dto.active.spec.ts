import { EnumCountryCode } from '@prisma/types'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { PartnerAdminDto } from './partner.admin.dto'

describe('PartnerAdminDto', () => {
  const createdAt = new Date('2026-07-01T10:00:00Z')
  const updatedAt = new Date('2026-07-01T11:00:00Z')

  test('13a. hydrated PartnerEntity populates email and pickupAddress DTO fields without exposing credentials', () => {
    const hydratedEntity = new PartnerEntity({
      id: 'partner-100',
      name: 'Taverna Volos',
      logo: 'https://example.com/logo.png',
      phoneNumber: '+302421000000',
      webhookUrl: 'https://example.com/webhook',
      userId: 'user-200',
      pickupLocationId: 'loc-300',
      createdAt,
      updatedAt,
      user: { email: 'taverna@volos.gr' },
      pickupLocation: {
        id: 'loc-300',
        addressLine1: null,
        addressLine2: null,
        city: 'Volos',
        state: 'Magnesia',
        street: 'Iasonos',
        zipCode: '38221',
        countryCode: EnumCountryCode.GR,
        stateCode: 'Magnesia',
        houseNumber: '12',
        longitude: 22.944,
        latitude: 39.362,
        formattedAddress: 'Iasonos 12, Volos',
        createdAt,
        updatedAt,
      },
    })

    const dto = new PartnerAdminDto(hydratedEntity)

    expect(dto.id).toBe('partner-100')
    expect(dto.name).toBe('Taverna Volos')
    expect(dto.phoneNumber).toBe('+302421000000')
    expect(dto.logo).toBe('https://example.com/logo.png')
    expect(dto.webhookUrl).toBe('https://example.com/webhook')
    expect(dto.userId).toBe('user-200')
    expect(dto.email).toBe('taverna@volos.gr')

    // Mapped nested LocationAdminDto assertion
    expect(dto.pickupAddress).toEqual(
      expect.objectContaining({
        id: 'loc-300',
        city: 'Volos',
        street: 'Iasonos',
        houseNumber: '12',
        zipCode: '38221',
        countryCode: EnumCountryCode.GR,
        latitude: 39.362,
        longitude: 22.944,
        formattedAddress: 'Iasonos 12, Volos',
      }),
    )

    // Verify sensitive keys are strictly absent from DTO
    const keys = Object.keys(dto)
    expect(keys).not.toContain('password')
    expect(keys).not.toContain('apiKey')
    expect(keys).not.toContain('hashedPassword')
  })

  test('13b. non-hydrated PartnerEntity sets email and pickupAddress to null (no undefined/crash)', () => {
    const nonHydratedEntity = new PartnerEntity({
      id: 'partner-101',
      name: 'Taverna Without Relations',
      logo: null,
      phoneNumber: null,
      webhookUrl: null,
      userId: null,
      pickupLocationId: null,
      createdAt,
      updatedAt,
      user: undefined,
      pickupLocation: undefined,
    })

    const dto = new PartnerAdminDto(nonHydratedEntity)

    expect(dto.id).toBe('partner-101')
    expect(dto.name).toBe('Taverna Without Relations')
    // email and pickupAddress must default to null rather than undefined
    expect(dto.email).toBeNull()
    expect(dto.pickupAddress).toBeNull()
  })
})
