import {
  CREDENTIALS_CHANGED_MESSAGE,
  isIssuedBeforeCredentialsChange,
} from './credentials-change'

describe('credentials-change (Spec 0013 AC-5: token revocation on password change)', () => {
  test('CREDENTIALS_CHANGED_MESSAGE matches the exact spec message', () => {
    expect(CREDENTIALS_CHANGED_MESSAGE).toBe('Your password was changed. Log in again.')
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
