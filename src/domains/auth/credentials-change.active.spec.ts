import {
  CREDENTIALS_CHANGED_MESSAGE,
  accountDeactivatedMessage,
  isIssuedBeforeCredentialsChange,
} from './credentials-change'

describe('credentials-change (Spec 0013 AC-5: token revocation on password change)', () => {
  test('CREDENTIALS_CHANGED_MESSAGE matches the exact spec message', () => {
    // Spec 0051 (cross check 3): an admin can change the login email too, which ends sessions the same way.
    expect(CREDENTIALS_CHANGED_MESSAGE).toBe('Your password or login email was changed. Log in again.')
  })

  describe('accountDeactivatedMessage (spec 0051, AC-2 and cross check 1)', () => {
    test('says the co-op deactivated the account and ends with the dispatch phone when one is set', () => {
      expect(accountDeactivatedMessage('+30 24210 12345')).toBe(
        'Your account was deactivated by the co-op. If you think this is a mistake, call the co-op on +30 24210 12345.'
      )
    })

    test('ends with "contact the co-op" when no phone is set (null, undefined or empty)', () => {
      const plain = 'Your account was deactivated by the co-op. If you think this is a mistake, contact the co-op.'
      expect(accountDeactivatedMessage(null)).toBe(plain)
      expect(accountDeactivatedMessage(undefined)).toBe(plain)
      expect(accountDeactivatedMessage('')).toBe(plain)
    })
  })

  describe('isIssuedBeforeCredentialsChange', () => {
    test('null or undefined credentialsChangedAt never refuses any token', () => {
      expect(isIssuedBeforeCredentialsChange(1000, null)).toBe(false)
      expect(isIssuedBeforeCredentialsChange(1000, undefined)).toBe(false)
      expect(isIssuedBeforeCredentialsChange(undefined, null)).toBe(false)
      expect(isIssuedBeforeCredentialsChange(null, null)).toBe(false)
      expect(isIssuedBeforeCredentialsChange('not-a-number', null)).toBe(false)
    })

    test('refuses a token issued a second before credentialsChangedAt', () => {
      // 2026-11-01T12:00:10.500Z -> epoch seconds = 1793534410
      const changeTime = new Date('2026-11-01T12:00:10.500Z')
      const changeSeconds = Math.floor(changeTime.getTime() / 1000)
      const iatOneSecondBefore = changeSeconds - 1

      expect(isIssuedBeforeCredentialsChange(iatOneSecondBefore, changeTime)).toBe(true)
    })

    test('accepts a token issued in the same second as credentialsChangedAt', () => {
      const changeTime = new Date('2026-11-01T12:00:10.500Z')
      const changeSeconds = Math.floor(changeTime.getTime() / 1000)
      const iatSameSecond = changeSeconds

      expect(isIssuedBeforeCredentialsChange(iatSameSecond, changeTime)).toBe(false)
    })

    test('accepts a token issued after credentialsChangedAt', () => {
      const changeTime = new Date('2026-11-01T12:00:10.500Z')
      const changeSeconds = Math.floor(changeTime.getTime() / 1000)
      const iatOneSecondAfter = changeSeconds + 1
      const iatWellAfter = changeSeconds + 3600

      expect(isIssuedBeforeCredentialsChange(iatOneSecondAfter, changeTime)).toBe(false)
      expect(isIssuedBeforeCredentialsChange(iatWellAfter, changeTime)).toBe(false)
    })

    test('refuses when iat is missing or non-numeric once a credentialsChangedAt exists', () => {
      const changeTime = new Date('2026-11-01T12:00:10.500Z')

      expect(isIssuedBeforeCredentialsChange(undefined, changeTime)).toBe(true)
      expect(isIssuedBeforeCredentialsChange(null, changeTime)).toBe(true)
      expect(isIssuedBeforeCredentialsChange('1793534410', changeTime)).toBe(true)
      expect(isIssuedBeforeCredentialsChange({}, changeTime)).toBe(true)
    })
  })
})
