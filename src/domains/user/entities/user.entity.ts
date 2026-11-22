import { EnumUserRole, User } from '@prisma/types'
import { Language, languageOf } from 'src/localization/translate'

export class UserEntity implements User {
  id: string
  email: string | null
  password: string | null
  role: EnumUserRole[]
  createdAt: Date
  updatedAt: Date

  username: string | null
  // A restaurant's API key hash and when it was made (spec 0037). `declare` emits nothing at runtime,
  // so the hash is never copied onto an entity, and an entity sent whole (as the courier login once
  // was, decision 66.12) can never carry it. Read them only through UserRepository's key methods.
  declare apiKeyHash: string | null
  declare apiKeyCreatedAt: Date | null
  // When an admin last set this user's password; older tokens are refused (spec 0013).
  credentialsChangedAt: Date | null
  // The language this person reads the apps in (spec 0054); mails to them use it too.
  language: Language

  // `& { language?: string }`: the column comes with spec 0054's migration, so this compiles before and
  // after `prisma generate` adds it to User. A missing or unknown value reads as Greek.
  constructor(data: User & { language?: string }) {
    this.id = data.id
    this.email = data.email
    this.password = data.password
    this.role = data.role

    this.username = data.username
    this.credentialsChangedAt = data.credentialsChangedAt
    this.language = languageOf(data.language)

    this.createdAt = data.createdAt
    this.updatedAt = data.updatedAt
  }
}
