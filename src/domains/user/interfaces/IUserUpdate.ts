export class IUserUpdate {
  apiKey?: string | null
  password?: string
  // Set with the password by an admin change, from Node's clock (spec 0013).
  credentialsChangedAt?: Date
}
