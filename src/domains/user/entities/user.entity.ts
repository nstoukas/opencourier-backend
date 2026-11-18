import { EnumUserRole, User } from '@prisma/types'

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

  constructor(data: User) {
    this.id = data.id
    this.email = data.email
    this.password = data.password
    this.role = data.role

    this.username = data.username
    this.credentialsChangedAt = data.credentialsChangedAt

    this.createdAt = data.createdAt
    this.updatedAt = data.updatedAt
  }
}
