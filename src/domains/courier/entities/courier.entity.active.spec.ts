import { EnumCourierDeliverySetting, EnumCourierStatus, EnumStripeAccountStatus } from '@prisma/types'
import { CourierEntity } from './courier.entity'

describe('CourierEntity - searchFold is never copied from the row (spec 0025)', () => {
  // The trigger stores the folded names, phone and phone digits; it is personal data, so it stops
  // at the repository: the entity keeps null whatever the row holds.
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

  it('built from a row with searchFold set, searchFold is null', () => {
    const entity = new CourierEntity(row)
    expect(entity.searchFold).toBeNull()
    expect(JSON.stringify(entity)).not.toContain('γιωργοσ')
  })

  it('still copies the fields the fold is made from', () => {
    const entity = new CourierEntity(row)
    expect(entity.firstName).toBe('Γιώργος')
    expect(entity.lastName).toBe('Παπαδόπουλος')
    expect(entity.phoneNumber).toBe('+302421010009')
  })
})
