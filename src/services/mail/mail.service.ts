import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createTransport, Transporter } from 'nodemailer'
import { MAIL_FROM, SMTP_HOST, SMTP_PASS, SMTP_PORT, SMTP_SECURE, SMTP_USER } from 'src/constants'

// What a caller hands MailService: one recipient, a subject, and the same message as plain text
// and as simple HTML (a mail program shows whichever it can).
export interface MailMessage {
  to: string
  subject: string
  text: string
  html: string
}

// The backend's only mail sender (row 17, spec 0039). It knows nothing about riders or codes: it
// takes a finished message and hands it to the SMTP server named in the env (Mailpit in dev, the
// co-op's provider at go live, decision 17.10).
//
// Mail is OFF while SMTP_HOST is unset (AC-12): the server still starts, logs "Mail is off" once,
// and callers check isConfigured() before doing any work.
@Injectable()
// `implements OnModuleInit` promises Nest an onModuleInit() method, which Nest calls once at startup.
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name)
  // `Transporter` is Nodemailer's connection to the SMTP server; null means mail is off.
  private transporter: Transporter | null = null
  private from = ''

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.transporter = this.startTransport()
  }

  isConfigured(): boolean {
    return this.transporter !== null
  }

  // Sends one message. Throws when the server refuses it or cannot be reached: the caller decides
  // what to log, and must never log the message itself (it holds a code and an address, AC-13).
  async send(message: MailMessage): Promise<void> {
    if (!this.transporter) {
      throw new Error('Mail is off')
    }
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    })
  }

  private startTransport(): Transporter | null {
    const host = this.configService.get<string>(SMTP_HOST)?.trim()
    if (!host) {
      this.logger.log(`Mail is off: ${SMTP_HOST} is not set`)
      return null
    }
    const from = this.configService.get<string>(MAIL_FROM)?.trim()
    if (!from) {
      this.logger.log(`Mail is off: ${MAIL_FROM} is not set`)
      return null
    }

    // Env values are always text, so the port and the TLS switch are read from text here.
    const port = Number(this.configService.get<string>(SMTP_PORT)) || 587
    const secure = this.configService.get<string>(SMTP_SECURE)?.trim().toLowerCase() === 'true'
    const user = this.configService.get<string>(SMTP_USER)?.trim()
    const pass = this.configService.get<string>(SMTP_PASS) ?? ''

    this.from = from
    // `secure: false` still upgrades to TLS (STARTTLS) when the server offers it. No user means no
    // login, which is how Mailpit runs in dev. Only the host and port are ever logged.
    const transporter = createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass } : undefined,
    })
    this.logger.log(`Mail is on: SMTP ${host}:${port}`)
    return transporter
  }
}
