import { ExecutionContext, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TASK_RUNNER_SECRET } from '../../constants'
import { UnauthorizedException } from '../../errors'
import {
  TaskRunnerSecretGuard,
  TASK_RUNNER_SECRET_HEADER,
  TASK_RUNNER_REFUSAL,
  TASK_RUNNER_SECRET_MIN_LENGTH,
  usableTaskRunnerSecret,
  warnIfTaskRunnerSecretTooShort,
} from './task-runner-secret.guard'

describe('TaskRunnerSecretGuard (Row 94, Decision 94.1)', () => {
  let guard: TaskRunnerSecretGuard
  let mockConfigService: {
    get: jest.Mock
  }
  let warnSpy: jest.SpyInstance

  // Helper to build a minimal NestJS ExecutionContext with request headers
  const createMockExecutionContext = (headers?: Record<string, any>): ExecutionContext => {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ headers }),
      }),
    } as unknown as ExecutionContext
  }

  beforeEach(() => {
    // Intercept Logger.warn so tests can inspect warnings and keep test output clean
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
    mockConfigService = {
      get: jest.fn(),
    }
    guard = new TaskRunnerSecretGuard(mockConfigService as unknown as ConfigService)
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  describe('When TASK_RUNNER_SECRET is unset or empty (closed by default)', () => {
    it('refuses call with 401 UnauthorizedException when secret is undefined in config', () => {
      mockConfigService.get.mockReturnValue(undefined)
      const context = createMockExecutionContext({
        [TASK_RUNNER_SECRET_HEADER]: 'some-secret-token',
      })

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
      try {
        guard.canActivate(context)
      } catch (err: any) {
        expect(err).toBeInstanceOf(UnauthorizedException)
        expect(err.getStatus()).toBe(401)
        expect(err.message).toBe(TASK_RUNNER_REFUSAL)
      }
    })

    it('refuses call with 401 when secret is empty string in config and no header sent', () => {
      mockConfigService.get.mockReturnValue('')
      const context = createMockExecutionContext({})

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
      try {
        guard.canActivate(context)
      } catch (err: any) {
        expect(err).toBeInstanceOf(UnauthorizedException)
        expect(err.getStatus()).toBe(401)
        expect(err.message).toBe(TASK_RUNNER_REFUSAL)
      }
    })

    it('refuses call with 401 when secret is empty string even if caller sends empty header', () => {
      // Both expected and sent are empty string, but unset/empty must never allow access
      mockConfigService.get.mockReturnValue('')
      const context = createMockExecutionContext({
        [TASK_RUNNER_SECRET_HEADER]: '',
      })

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
      try {
        guard.canActivate(context)
      } catch (err: any) {
        expect(err).toBeInstanceOf(UnauthorizedException)
        expect(err.getStatus()).toBe(401)
        expect(err.message).toBe(TASK_RUNNER_REFUSAL)
      }
    })

    it('refuses call when request has no headers object defined', () => {
      mockConfigService.get.mockReturnValue(undefined)
      const context = createMockExecutionContext(undefined)

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
    })

    it('does not log any warning when secret is unset or empty string', () => {
      mockConfigService.get.mockReturnValue(undefined)
      const context = createMockExecutionContext({ [TASK_RUNNER_SECRET_HEADER]: 'some-secret' })

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
      expect(warnSpy).not.toHaveBeenCalled()

      mockConfigService.get.mockReturnValue('')
      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
      expect(warnSpy).not.toHaveBeenCalled()
    })
  })

  describe('When TASK_RUNNER_SECRET is configured', () => {
    const CONFIGURED_SECRET = 'fake-task-secret-key-for-test-xyz-987'

    beforeEach(() => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === TASK_RUNNER_SECRET) return CONFIGURED_SECRET
        return undefined
      })
    })

    it('refuses call when x-task-secret header is completely missing', () => {
      const context = createMockExecutionContext({})

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
      try {
        guard.canActivate(context)
      } catch (err: any) {
        expect(err).toBeInstanceOf(UnauthorizedException)
        expect(err.getStatus()).toBe(401)
        expect(err.message).toBe(TASK_RUNNER_REFUSAL)
      }
    })

    it('refuses call when x-task-secret header is empty string', () => {
      const context = createMockExecutionContext({
        [TASK_RUNNER_SECRET_HEADER]: '',
      })

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
      try {
        guard.canActivate(context)
      } catch (err: any) {
        expect(err).toBeInstanceOf(UnauthorizedException)
        expect(err.getStatus()).toBe(401)
        expect(err.message).toBe(TASK_RUNNER_REFUSAL)
      }
    })

    it('refuses call when header value is of different length (shorter)', () => {
      const context = createMockExecutionContext({
        [TASK_RUNNER_SECRET_HEADER]: 'fake-task-secret',
      })

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
      try {
        guard.canActivate(context)
      } catch (err: any) {
        expect(err).toBeInstanceOf(UnauthorizedException)
        expect(err.getStatus()).toBe(401)
        expect(err.message).toBe(TASK_RUNNER_REFUSAL)
      }
    })

    it('refuses call when header value is of different length (longer)', () => {
      const context = createMockExecutionContext({
        [TASK_RUNNER_SECRET_HEADER]: `${CONFIGURED_SECRET}-extra-suffix`,
      })

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
      try {
        guard.canActivate(context)
      } catch (err: any) {
        expect(err).toBeInstanceOf(UnauthorizedException)
        expect(err.getStatus()).toBe(401)
        expect(err.message).toBe(TASK_RUNNER_REFUSAL)
      }
    })

    it('refuses call when header value has same length but differs by one character', () => {
      // Modify only the last character of the secret
      const lastChar = CONFIGURED_SECRET.slice(-1)
      const modifiedLastChar = lastChar === 'a' ? 'b' : 'a'
      const tamperedSecret = CONFIGURED_SECRET.slice(0, -1) + modifiedLastChar

      expect(tamperedSecret.length).toBe(CONFIGURED_SECRET.length)
      expect(tamperedSecret).not.toBe(CONFIGURED_SECRET)

      const context = createMockExecutionContext({
        [TASK_RUNNER_SECRET_HEADER]: tamperedSecret,
      })

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
      try {
        guard.canActivate(context)
      } catch (err: any) {
        expect(err).toBeInstanceOf(UnauthorizedException)
        expect(err.getStatus()).toBe(401)
        expect(err.message).toBe(TASK_RUNNER_REFUSAL)
      }
    })

    it('refuses call when header value has same length but differs by the first character', () => {
      const firstChar = CONFIGURED_SECRET[0]
      const modifiedFirstChar = firstChar === 'x' ? 'y' : 'x'
      const tamperedSecret = modifiedFirstChar + CONFIGURED_SECRET.slice(1)

      const context = createMockExecutionContext({
        [TASK_RUNNER_SECRET_HEADER]: tamperedSecret,
      })

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
    })

    it('permits call and returns true when x-task-secret header matches exact value', () => {
      const context = createMockExecutionContext({
        [TASK_RUNNER_SECRET_HEADER]: CONFIGURED_SECRET,
      })

      const allowed = guard.canActivate(context)
      expect(allowed).toBe(true)
    })

    it('permits call when header is passed as string array or object with toString() matching exact secret', () => {
      const context = createMockExecutionContext({
        [TASK_RUNNER_SECRET_HEADER]: [CONFIGURED_SECRET],
      })

      const allowed = guard.canActivate(context)
      expect(allowed).toBe(true)
    })

    it('does not log any warning when secret is configured properly with sufficient length', () => {
      const context = createMockExecutionContext({
        [TASK_RUNNER_SECRET_HEADER]: CONFIGURED_SECRET,
      })

      expect(guard.canActivate(context)).toBe(true)
      expect(warnSpy).not.toHaveBeenCalled()
    })
  })

  describe('When TASK_RUNNER_SECRET is configured with surrounding spaces or newlines (PIN)', () => {
    const CLEAN_SECRET = 'fake-task-secret-key-for-test-xyz-987'

    it('matches the header carrying the trimmed value when configured secret has spaces and a trailing newline', () => {
      // Configuration injected with leading/trailing spaces and newline
      mockConfigService.get.mockReturnValue(`   ${CLEAN_SECRET}   \n`)

      const context = createMockExecutionContext({
        [TASK_RUNNER_SECRET_HEADER]: CLEAN_SECRET,
      })

      const allowed = guard.canActivate(context)
      expect(allowed).toBe(true)
      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('matches the header carrying the trimmed value when configured secret has surrounding tabs and carriage returns', () => {
      mockConfigService.get.mockReturnValue(`\t\r\n  ${CLEAN_SECRET}  \r\n\t`)

      const context = createMockExecutionContext({
        [TASK_RUNNER_SECRET_HEADER]: CLEAN_SECRET,
      })

      const allowed = guard.canActivate(context)
      expect(allowed).toBe(true)
    })

    it('refuses call when header sends untrimmed secret with spaces while configured secret is trimmed', () => {
      mockConfigService.get.mockReturnValue(CLEAN_SECRET)

      const context = createMockExecutionContext({
        [TASK_RUNNER_SECRET_HEADER]: `  ${CLEAN_SECRET}  `,
      })

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
    })
  })

  describe('When TASK_RUNNER_SECRET is shorter than TASK_RUNNER_SECRET_MIN_LENGTH (32 chars) (PIN)', () => {
    it('defines TASK_RUNNER_SECRET_MIN_LENGTH as 32', () => {
      expect(TASK_RUNNER_SECRET_MIN_LENGTH).toBe(32)
    })

    it('refuses call when configured secret has length 31 (TASK_RUNNER_SECRET_MIN_LENGTH - 1), even when caller sends that exact short value', () => {
      // 31 characters long: one char below the required 32-character minimum
      const SHORT_SECRET = 'fake-short-secret-31-chars-long'
      expect(SHORT_SECRET.length).toBe(31)
      expect(SHORT_SECRET.length).toBeLessThan(TASK_RUNNER_SECRET_MIN_LENGTH)

      mockConfigService.get.mockReturnValue(SHORT_SECRET)
      const context = createMockExecutionContext({
        [TASK_RUNNER_SECRET_HEADER]: SHORT_SECRET,
      })

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
      try {
        guard.canActivate(context)
      } catch (err: any) {
        expect(err).toBeInstanceOf(UnauthorizedException)
        expect(err.getStatus()).toBe(401)
        expect(err.message).toBe(TASK_RUNNER_REFUSAL)
      }
    })

    it('refuses call when configured secret is a single character placeholder (e.g. "x") even when caller sends "x"', () => {
      mockConfigService.get.mockReturnValue('x')
      const context = createMockExecutionContext({
        [TASK_RUNNER_SECRET_HEADER]: 'x',
      })

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
    })

    it('refuses call when configured secret has untrimmed length >= 32 but trimmed length < 32', () => {
      // Untrimmed length is 32 (surrounding spaces padding a 20-character secret)
      const UNTRIMMED_SHORT = '      fake-short-secret-20      '
      expect(UNTRIMMED_SHORT.length).toBe(32)
      expect(UNTRIMMED_SHORT.trim().length).toBeLessThan(TASK_RUNNER_SECRET_MIN_LENGTH)

      mockConfigService.get.mockReturnValue(UNTRIMMED_SHORT)
      const context = createMockExecutionContext({
        [TASK_RUNNER_SECRET_HEADER]: UNTRIMMED_SHORT.trim(),
      })

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
    })

    it('permits call and returns true when configured secret has length exactly 32 characters', () => {
      // Exactly 32 characters long
      const EXACT_32_CHAR_SECRET = 'fake-secret-with-exact-32-chars!'
      expect(EXACT_32_CHAR_SECRET.length).toBe(32)
      expect(EXACT_32_CHAR_SECRET.length).toBe(TASK_RUNNER_SECRET_MIN_LENGTH)

      mockConfigService.get.mockReturnValue(EXACT_32_CHAR_SECRET)
      const context = createMockExecutionContext({
        [TASK_RUNNER_SECRET_HEADER]: EXACT_32_CHAR_SECRET,
      })

      const allowed = guard.canActivate(context)
      expect(allowed).toBe(true)
      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('logs one warning that names TASK_RUNNER_SECRET and never contains the configured value, and does not warn again on subsequent calls', () => {
      const SHORT_SECRET = 'obvious-fake-short-secret-xyz'
      mockConfigService.get.mockReturnValue(SHORT_SECRET)

      const context1 = createMockExecutionContext({
        [TASK_RUNNER_SECRET_HEADER]: SHORT_SECRET,
      })
      const context2 = createMockExecutionContext({
        [TASK_RUNNER_SECRET_HEADER]: SHORT_SECRET,
      })

      // First call: throws 401 and logs warning once
      expect(() => guard.canActivate(context1)).toThrow(UnauthorizedException)
      expect(warnSpy).toHaveBeenCalledTimes(1)

      const warningMessage = warnSpy.mock.calls[0][0]
      expect(typeof warningMessage).toBe('string')
      // Must explicitly name TASK_RUNNER_SECRET
      expect(warningMessage).toContain(TASK_RUNNER_SECRET)
      // Must name minimum length requirement
      expect(warningMessage).toContain(TASK_RUNNER_SECRET_MIN_LENGTH.toString())
      // Must NEVER contain the configured secret
      expect(warningMessage).not.toContain(SHORT_SECRET)

      // Ensure all logged arguments across all calls never leak the secret
      for (const callArgs of warnSpy.mock.calls) {
        const text = callArgs.map((arg: any) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')
        expect(text).not.toContain(SHORT_SECRET)
      }

      // Second call: throws 401 but does NOT log a second warning
      expect(() => guard.canActivate(context2)).toThrow(UnauthorizedException)
      expect(warnSpy).toHaveBeenCalledTimes(1)

      // Third call: also does not warn again
      expect(() => guard.canActivate(context1)).toThrow(UnauthorizedException)
      expect(warnSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('usableTaskRunnerSecret helper (Row 94, PIN)', () => {
    it('returns empty string when configured secret is undefined', () => {
      expect(usableTaskRunnerSecret(undefined)).toBe('')
    })

    it('returns empty string when configured secret is empty string', () => {
      expect(usableTaskRunnerSecret('')).toBe('')
    })

    it('returns empty string when configured secret is only whitespace', () => {
      expect(usableTaskRunnerSecret('   ')).toBe('')
      expect(usableTaskRunnerSecret('\t\r\n  \n')).toBe('')
    })

    it('returns empty string when configured secret is under 32 characters', () => {
      expect(usableTaskRunnerSecret('x')).toBe('')
      expect(usableTaskRunnerSecret('short-secret')).toBe('')
      expect(usableTaskRunnerSecret('1234567890123456789012345678901')).toBe('') // 31 characters
    })

    it('returns empty string when configured secret has raw length >= 32 but trimmed length < 32', () => {
      // 20 characters surrounded by 6 spaces on each side = 32 raw chars, but trimmed is 20
      const paddedShort = '      fake-short-secret-20      '
      expect(paddedShort.length).toBe(32)
      expect(usableTaskRunnerSecret(paddedShort)).toBe('')
    })

    it('returns trimmed secret when 32+ characters with surrounding spaces, tabs, or a trailing newline', () => {
      const validSecret = 'fake-task-secret-value-32-chars!'
      expect(validSecret.length).toBe(32)

      // Surrounding spaces and trailing newline
      expect(usableTaskRunnerSecret(`   ${validSecret}   \n`)).toBe(validSecret)
      // Surrounding tabs and carriage returns
      expect(usableTaskRunnerSecret(`\t\r\n  ${validSecret}  \r\n\t`)).toBe(validSecret)
      // Trailing newline only
      expect(usableTaskRunnerSecret(`${validSecret}\n`)).toBe(validSecret)
      // Longer valid secret with whitespace
      const longerSecret = 'fake-task-runner-secret-key-xyz-longer-than-32-chars'
      expect(usableTaskRunnerSecret(`  ${longerSecret}  \n`)).toBe(longerSecret)
    })

    it('returns secret as-is when already trimmed and at least 32 characters', () => {
      const validSecret = 'fake-task-secret-value-32-chars!'
      expect(usableTaskRunnerSecret(validSecret)).toBe(validSecret)
    })
  })

  describe('warnIfTaskRunnerSecretTooShort helper (Row 94, PIN)', () => {
    let mockLogger: {
      warn: jest.Mock
    }

    beforeEach(() => {
      mockLogger = {
        warn: jest.fn(),
      }
    })

    it('warns once naming TASK_RUNNER_SECRET and never the value for a set but short secret', () => {
      const shortSecret = 'fake-short-secret'
      warnIfTaskRunnerSecretTooShort(shortSecret, mockLogger as unknown as Logger)

      expect(mockLogger.warn).toHaveBeenCalledTimes(1)
      const message = mockLogger.warn.mock.calls[0][0]

      expect(typeof message).toBe('string')
      expect(message).toContain(TASK_RUNNER_SECRET)
      expect(message).toContain(TASK_RUNNER_SECRET_MIN_LENGTH.toString())
      expect(message).not.toContain(shortSecret)
    })

    it('says nothing when secret is undefined', () => {
      warnIfTaskRunnerSecretTooShort(undefined, mockLogger as unknown as Logger)
      expect(mockLogger.warn).not.toHaveBeenCalled()
    })

    it('says nothing when secret is empty string', () => {
      warnIfTaskRunnerSecretTooShort('', mockLogger as unknown as Logger)
      expect(mockLogger.warn).not.toHaveBeenCalled()
    })

    it('says nothing when secret is only whitespace', () => {
      warnIfTaskRunnerSecretTooShort('   \t\r\n  ', mockLogger as unknown as Logger)
      expect(mockLogger.warn).not.toHaveBeenCalled()
    })

    it('says nothing when secret is long enough (32+ characters)', () => {
      const validSecret = 'fake-valid-task-secret-value-32chars!'
      expect(validSecret.length).toBeGreaterThanOrEqual(TASK_RUNNER_SECRET_MIN_LENGTH)

      warnIfTaskRunnerSecretTooShort(validSecret, mockLogger as unknown as Logger)
      expect(mockLogger.warn).not.toHaveBeenCalled()
    })

    it('says nothing when secret is long enough with surrounding whitespace', () => {
      const validSecret = '   fake-valid-task-secret-value-32chars!   \n'
      warnIfTaskRunnerSecretTooShort(validSecret, mockLogger as unknown as Logger)
      expect(mockLogger.warn).not.toHaveBeenCalled()
    })
  })
})
