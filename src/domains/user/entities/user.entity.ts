import { EnumUserRole, User } from '@prisma/types'

export class UserEntity implements User {
  id: string
  email: string | null
  password: string | null
  role: EnumUserRole[]
  createdAt: Date
  updatedAt: Date

  username: string | null
  apiKey: string | null
  // When an admin last set this user's password; older tokens are refused (spec 0013).
  credentialsChangedAt: Date | null

  constructor(data: User) {
    this.id = data.id
    this.email = data.email
    this.password = data.password
    this.role = data.role

    this.username = data.username
    this.apiKey = data.apiKey
    this.credentialsChangedAt = data.credentialsChangedAt

    this.createdAt = data.createdAt
    this.updatedAt = data.updatedAt
  }
}
