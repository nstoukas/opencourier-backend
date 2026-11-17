import { Logger } from '@nestjs/common'
import {
  DEFAULT_CHAT_QUICK_REPLIES_COURIER,
  DEFAULT_CHAT_QUICK_REPLIES_DISPATCH,
  DEFAULT_CHAT_RETENTION_DAYS,
  CHAT_RETENTION_DAYS_MIN,
  CHAT_RETENTION_DAYS_MAX,
} from 'src/constants'
import { ConfigKey } from 'src/shared-types'
import { ConfigEntity } from './entities/config.entity'
import { ConfigRepository } from 'src/persistence/repositories/config.repository'
import { checkChatQuickReplies, storedChatQuickReplies } from './chat-quick-replies'
import {
  InstanceConfigDomainService,
  NUMERIC_SETTING_RULES,
} from './instance-config.domain.service'

describe('chat-quick-replies and chat config settings (spec 0034, AC-13, AC-18)', () => {
  describe('checkChatQuickReplies', () => {
    test('refuses by name when value is not a list', () => {
      expect(checkChatQuickReplies('chatQuickRepliesDispatch', 'not-a-list')).toEqual({
        refusal: 'chatQuickRepliesDispatch must be a list of texts',
      })
      expect(checkChatQuickReplies('chatQuickRepliesCourier', null)).toEqual({
        refusal: 'chatQuickRepliesCourier must be a list of texts',
      })
      expect(checkChatQuickReplies('chatQuickRepliesCourier', { 0: 'a' })).toEqual({
        refusal: 'chatQuickRepliesCourier must be a list of texts',
      })
    })

    test('refuses by name when list contains non-text entries', () => {
      expect(checkChatQuickReplies('chatQuickRepliesDispatch', [123])).toEqual({
        refusal: 'chatQuickRepliesDispatch must be a list of texts',
      })
      expect(checkChatQuickReplies('chatQuickRepliesCourier', ['ok', false])).toEqual({
        refusal: 'chatQuickRepliesCourier must be a list of texts',
      })
    })

    test('refuses by name more than 8 entries', () => {
      const nineEntries = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
      expect(checkChatQuickReplies('chatQuickRepliesDispatch', nineEntries)).toEqual({
        refusal: 'chatQuickRepliesDispatch can have at most 8 presets',
      })
      expect(checkChatQuickReplies('chatQuickRepliesCourier', nineEntries)).toEqual({
        refusal: 'chatQuickRepliesCourier can have at most 8 presets',
      })
    })

    test('refuses by name an empty or blank entry', () => {
      expect(checkChatQuickReplies('chatQuickRepliesDispatch', [''])).toEqual({
        refusal: 'chatQuickRepliesDispatch cannot have an empty preset',
      })
      expect(checkChatQuickReplies('chatQuickRepliesCourier', ['   ', 'Valid'])).toEqual({
        refusal: 'chatQuickRepliesCourier cannot have an empty preset',
      })
      expect(checkChatQuickReplies('chatQuickRepliesCourier', ['\t\n'])).toEqual({
        refusal: 'chatQuickRepliesCourier cannot have an empty preset',
      })
    })

    test('refuses by name an entry over 100 characters', () => {
      const longEntry = 'a'.repeat(101)
      expect(checkChatQuickReplies('chatQuickRepliesDispatch', [longEntry])).toEqual({
        refusal: 'chatQuickRepliesDispatch: each preset can be at most 100 characters',
      })
      expect(checkChatQuickReplies('chatQuickRepliesCourier', ['Short', longEntry])).toEqual({
        refusal: 'chatQuickRepliesCourier: each preset can be at most 100 characters',
      })
    })

    test('trims entries and accepts valid list up to 8 entries', () => {
      const input = ['  Περίμενε 5 λεπτά ακόμα  ', ' Άφησέ το στην πόρτα ']
      const result = checkChatQuickReplies('chatQuickRepliesDispatch', input)
      expect(result).toEqual({
        replies: ['Περίμενε 5 λεπτά ακόμα', 'Άφησέ το στην πόρτα'],
      })
    })

    test('accepts an empty list (clearing all presets is valid)', () => {
      expect(checkChatQuickReplies('chatQuickRepliesCourier', [])).toEqual({
        replies: [],
      })
    })
  })

  describe('storedChatQuickReplies', () => {
    test('returns null for an invalid stored value', () => {
      expect(storedChatQuickReplies('invalid')).toBeNull()
      expect(storedChatQuickReplies(['', 'good'])).toBeNull()
      expect(storedChatQuickReplies(['a'.repeat(101)])).toBeNull()
    })

    test('returns trimmed strings for valid stored list', () => {
      expect(storedChatQuickReplies(['  reply 1  '])).toEqual(['reply 1'])
    })
  })

  describe('chatRetentionDays in NUMERIC_SETTING_RULES', () => {
    test('chatRetentionDays has min 7, max 365, mustBeInteger true, and zero refused', () => {
      const rule = NUMERIC_SETTING_RULES.find((r) => r.key === 'chatRetentionDays')
      expect(rule).toBeDefined()
      expect(rule?.min).toBe(CHAT_RETENTION_DAYS_MIN)
      expect(rule?.min).toBe(7)
      expect(rule?.max).toBe(CHAT_RETENTION_DAYS_MAX)
      expect(rule?.max).toBe(365)
      expect(rule?.mustBeInteger).toBe(true)
      expect(rule?.whyZeroIsRefused).toBeTruthy()
    })
  })

  describe('InstanceConfigDomainService getters for chat', () => {
    let service: InstanceConfigDomainService
    let mockConfigRepository: jest.Mocked<ConfigRepository>
    const notFoundError = new Error('Record not found in config table')
    notFoundError.name = 'NotFoundError'

    beforeEach(() => {
      mockConfigRepository = {
        getByKey: jest.fn(),
        saveByKey: jest.fn(),
      } as unknown as jest.Mocked<ConfigRepository>

      service = new InstanceConfigDomainService(
        mockConfigRepository,
        { get: jest.fn() } as any
      )
    })

    test('getChatRetentionDays returns default 90 on missing row', async () => {
      mockConfigRepository.getByKey.mockRejectedValueOnce(notFoundError)
      expect(await service.getChatRetentionDays()).toBe(DEFAULT_CHAT_RETENTION_DAYS)
      expect(DEFAULT_CHAT_RETENTION_DAYS).toBe(90)
    })

    test('getChatRetentionDays returns stored value when in range', async () => {
      mockConfigRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({ key: ConfigKey.CHAT_RETENTION_DAYS, value: '60', type: 'number' })
      )
      expect(await service.getChatRetentionDays()).toBe(60)
    })

    test('getChatQuickRepliesDispatch falls back to Greek defaults quietly on missing row', async () => {
      mockConfigRepository.getByKey.mockRejectedValueOnce(notFoundError)
      const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()

      const result = await service.getChatQuickRepliesDispatch()
      expect(result).toEqual(DEFAULT_CHAT_QUICK_REPLIES_DISPATCH)
      expect(DEFAULT_CHAT_QUICK_REPLIES_DISPATCH).toEqual([
        'Περίμενε 5 λεπτά ακόμα',
        'Άφησέ το στην πόρτα',
        'Πήγαινέ το πίσω στο κατάστημα',
      ])
      // Quiet fallback: no warning logged
      expect(warnSpy).not.toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    test('getChatQuickRepliesCourier falls back to Greek defaults quietly on missing row', async () => {
      mockConfigRepository.getByKey.mockRejectedValueOnce(notFoundError)
      const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()

      const result = await service.getChatQuickRepliesCourier()
      expect(result).toEqual(DEFAULT_CHAT_QUICK_REPLIES_COURIER)
      expect(DEFAULT_CHAT_QUICK_REPLIES_COURIER).toEqual([
        'Είμαι στην πόρτα, δεν απαντούν',
        'Το φαγητό δεν είναι έτοιμο',
        'Θα αργήσω λίγο',
      ])
      expect(warnSpy).not.toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    test('getChatQuickReplies falls back with a warning on bad stored list', async () => {
      // Stored list has an entry over 100 chars
      mockConfigRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({
          key: ConfigKey.CHAT_QUICK_REPLIES_DISPATCH,
          value: JSON.stringify(['x'.repeat(105)]),
          type: 'json',
        })
      )
      const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation()

      const result = await service.getChatQuickRepliesDispatch()
      expect(result).toEqual(DEFAULT_CHAT_QUICK_REPLIES_DISPATCH)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Invalid ${ConfigKey.CHAT_QUICK_REPLIES_DISPATCH} in config`)
      )
      warnSpy.mockRestore()
    })

    test('getChatQuickReplies returns valid stored presets', async () => {
      mockConfigRepository.getByKey.mockResolvedValueOnce(
        new ConfigEntity({
          key: ConfigKey.CHAT_QUICK_REPLIES_COURIER,
          value: JSON.stringify(['Έφτασα', 'Κατεβαίνω']),
          type: 'object',
        })
      )
      const result = await service.getChatQuickRepliesCourier()
      expect(result).toEqual(['Έφτασα', 'Κατεβαίνω'])
    })
  })
})
