import { SavedCustomer } from '@prisma/types'
import { SavedCustomerDto } from './saved-customer.dto'

describe('SavedCustomerDto (Spec 0016 AC-3)', () => {
  const baseCustomer: SavedCustomer = {
    id: 'cust-1',
    partnerId: 'partner-1',
    name: 'Nikos Dimas',
    phone: '+306912345678',
    notes: 'Ring bell twice',
    addressLine1: 'Iasonos 10',
    addressLine2: null,
    floor: '3rd',
    doorbell: 'Dimas',
    city: 'Volos',
    zipCode: '38221',
    latitude: 39.362,
    longitude: 22.945,
    formattedAddress: 'Iasonos 10, Volos',
    lastUsedAt: new Date('2026-11-01T10:00:00Z'),
    createdAt: new Date('2026-11-01T10:00:00Z'),
    updatedAt: new Date('2026-11-01T10:00:00Z'),
  }

  it('returns floor and doorbell from the saved customer entity', () => {
    const dto = new SavedCustomerDto(baseCustomer)

    expect(dto.floor).toBe('3rd')
    expect(dto.doorbell).toBe('Dimas')
  })

  it('returns null when floor and doorbell are null', () => {
    const dto = new SavedCustomerDto({ ...baseCustomer, floor: null, doorbell: null })

    expect(dto.floor).toBeNull()
    expect(dto.doorbell).toBeNull()
  })
})
