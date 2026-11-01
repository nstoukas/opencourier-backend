// A rider and their login, created together by an admin (spec 0013). Values arrive already
// trimmed, lower cased (the email) and hashed (the password).
export interface ICourierCreateWithLogin {
  firstName: string
  lastName: string
  phoneNumber: string
  login: {
    email: string
    hashedPassword: string
  }
}
