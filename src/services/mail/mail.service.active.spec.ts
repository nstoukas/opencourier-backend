import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as nodemailer from 'nodemailer'
import { MailService } from './mail.service'
import { MAIL_FROM, SMTP_HOST, SMTP_PASS, SMTP_PORT, SMTP_SECURE, SMTP_USER } from 'src/constants'

jest.mock('nodemailer')

describe('MailService (Clause 6, spec 0039 AC-12, AC-14)', () => {
  let service: MailService
  let mockConfigService: { get: jest.Mock }
  let mockSendMail: jest.Mock
  let loggerSpies: {
    log: jest.SpyInstance
    error: jest.SpyInstance
    warn: jest.SpyInstance
  }

  beforeEach(() => {
    mockSendMail = jest.fn().mockResolvedValue({ messageId: 'msg-123' })
    ;(nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail: mockSendMail,
    })

    mockConfigService = {
      get: jest.fn(),
    }
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('onModuleInit and isConfigured (AC-12: Mail is off logged once at init)', () => {
    test('when SMTP_HOST is unset, logs "Mail is off: SMTP_HOST is not set" and isConfigured is false', () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === SMTP_HOST) return undefined
        if (key === MAIL_FROM) return 'no-reply@coop.gr'
        return undefined
      })

      service = new MailService(mockConfigService as unknown as ConfigService)
      const logger = (service as any).logger as Logger
      loggerSpies = {
        log: jest.spyOn(logger, 'log').mockImplementation(() => {}),
        error: jest.spyOn(logger, 'error').mockImplementation(() => {}),
        warn: jest.spyOn(logger, 'warn').mockImplementation(() => {}),
      }

      service.onModuleInit()

      expect(service.isConfigured()).toBe(false)
      expect(loggerSpies.log).toHaveBeenCalledWith('Mail is off: SMTP_HOST is not set')
      expect(nodemailer.createTransport).not.toHaveBeenCalled()
    })

    test('when MAIL_FROM is unset, logs "Mail is off: MAIL_FROM is not set" and isConfigured is false', () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === SMTP_HOST) return 'smtp.coop.gr'
        if (key === MAIL_FROM) return undefined
        return undefined
      })

      service = new MailService(mockConfigService as unknown as ConfigService)
      const logger = (service as any).logger as Logger
      loggerSpies = {
        log: jest.spyOn(logger, 'log').mockImplementation(() => {}),
        error: jest.spyOn(logger, 'error').mockImplementation(() => {}),
        warn: jest.spyOn(logger, 'warn').mockImplementation(() => {}),
      }

      service.onModuleInit()

      expect(service.isConfigured()).toBe(false)
      expect(loggerSpies.log).toHaveBeenCalledWith('Mail is off: MAIL_FROM is not set')
      expect(nodemailer.createTransport).not.toHaveBeenCalled()
    })

    test('when SMTP_HOST and MAIL_FROM are set, configures transport and logs "Mail is on: SMTP ..."', () => {
      mockConfigService.get.mockImplementation((key: string) => {
        switch (key) {
          case SMTP_HOST:
            return 'localhost'
          case MAIL_FROM:
            return 'Volos Couriers <no-reply@volos.coop>'
          case SMTP_PORT:
            return '1025'
          case SMTP_SECURE:
            return 'false'
          case SMTP_USER:
            return ''
          case SMTP_PASS:
            return ''
          default:
            return undefined
        }
      })

      service = new MailService(mockConfigService as unknown as ConfigService)
      const logger = (service as any).logger as Logger
      loggerSpies = {
        log: jest.spyOn(logger, 'log').mockImplementation(() => {}),
        error: jest.spyOn(logger, 'error').mockImplementation(() => {}),
        warn: jest.spyOn(logger, 'warn').mockImplementation(() => {}),
      }

      service.onModuleInit()

      expect(service.isConfigured()).toBe(true)
      expect(loggerSpies.log).toHaveBeenCalledWith('Mail is on: SMTP localhost:1025')
      expect(nodemailer.createTransport).toHaveBeenCalledWith({
        host: 'localhost',
        port: 1025,
        secure: false,
        auth: undefined,
      })
    })

    test('configures auth credentials when SMTP_USER is set', () => {
      mockConfigService.get.mockImplementation((key: string) => {
        switch (key) {
          case SMTP_HOST:
            return 'smtp.provider.com'
          case MAIL_FROM:
            return 'Co-op <info@coop.gr>'
          case SMTP_PORT:
            return '465'
          case SMTP_SECURE:
            return 'true'
          case SMTP_USER:
            return 'smtp-user-1'
          case SMTP_PASS:
            return 'secret-smtp-password'
          default:
            return undefined
        }
      })

      service = new MailService(mockConfigService as unknown as ConfigService)
      service.onModuleInit()

      expect(service.isConfigured()).toBe(true)
      expect(nodemailer.createTransport).toHaveBeenCalledWith({
        host: 'smtp.provider.com',
        port: 465,
        secure: true,
        auth: {
          user: 'smtp-user-1',
          pass: 'secret-smtp-password',
        },
      })
    })
  })

  describe('send', () => {
    test('throws Error("Mail is off") when not configured', async () => {
      mockConfigService.get.mockReturnValue(undefined)
      service = new MailService(mockConfigService as unknown as ConfigService)
      service.onModuleInit()

      await expect(
        service.send({
          to: 'rider@coop.gr',
          subject: 'Test Subject',
          text: 'Body text',
          html: '<p>Body text</p>',
        })
      ).rejects.toThrow('Mail is off')

      expect(mockSendMail).not.toHaveBeenCalled()
    })

    test('delegates to transporter.sendMail with configured from address', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === SMTP_HOST) return 'localhost'
        if (key === MAIL_FROM) return 'Coop Dispatch <dispatch@coop.gr>'
        return undefined
      })

      service = new MailService(mockConfigService as unknown as ConfigService)
      service.onModuleInit()

      const message = {
        to: 'rider@coop.gr',
        subject: 'Reset Code',
        text: '004219',
        html: '<p>004219</p>',
      }

      await service.send(message)

      expect(mockSendMail).toHaveBeenCalledWith({
        from: 'Coop Dispatch <dispatch@coop.gr>',
        to: 'rider@coop.gr',
        subject: 'Reset Code',
        text: '004219',
        html: '<p>004219</p>',
      })
    })
  })
})
