import { EnumCourierDeliverySetting, EnumCourierStatus, EnumStripeAccountStatus } from '@prisma/types'
import { CourierEntity } from './courier.entity'

describe('CourierEntity - searchFold is never carried (spec 0025 AC-7, decision 98.3)', () => {
  // The trigger stores the folded names, phone and phone digits; it is personal data, so it stops
  // at the repository. The entity only declares the field for the type: a built entity has no
  // searchFold key at all, so a serialised courier (the partner webhook posts whole entities)
  // gains no field, not even "searchFold": null.
  const row = {
    id: 'courier-fold-test',
    node_uri: null,
    firstName: 'Γιώργος',
    lastName: 'Παπαδόπουλος',
    phoneNumber: '+302421010009',
    status: EnumCourierStatus.ONLINE,
    deliverySetting: EnumCourierDeliverySetting.AUTO_ACCEPT,
    rejectedOffers: [],
    stripeAccountId: null,
    stripeAccountStatus: EnumStripeAccountStatus.PENDING,
    userId: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    searchFold: 'γιωργοσ\nπαπαδοπουλοσ\n+302421010009\n302421010009',
  }

  it('built from a row with searchFold set, has no searchFold property', () => {
    expect('searchFold' in new CourierEntity(row)).toBe(false)
  })

  it('has no searchFold among its own keys', () => {
    expect(Object.keys(new CourierEntity(row))).not.toContain('searchFold')
  })

  it('serialises with no searchFold key and no folded text', () => {
    const json = JSON.stringify(new CourierEntity(row))
    expect(json).not.toContain('searchFold')
    expect(json).not.toContain('γιωργοσ')
    expect(json).not.toContain('302421010009\\n')
  })

  it('still copies the fields the fold is made from', () => {
    const entity = new CourierEntity(row)
    expect(entity.firstName).toBe('Γιώργος')
    expect(entity.lastName).toBe('Παπαδόπουλος')
    expect(entity.phoneNumber).toBe('+302421010009')
    expect(entity.id).toBe('courier-fold-test')
  })
})
