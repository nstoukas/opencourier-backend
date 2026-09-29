import { EnumUserRole, PrismaClient } from '@prisma/types'
import { hash } from 'bcryptjs'
import { createHash, randomBytes } from 'crypto'
import { parseSalt } from 'src/domains/auth/password.service'

// Upstream seeded every instance with one fixed API key, and that key is public in
// upstream's git history. We keep only its SHA-256 so a re-seed can spot and replace it.
const LEAKED_PARTNER_API_KEY_SHA256 =
  '13f8d6ae170cceb068ac2a2c614445868b089b69fb0958d19e5166b7552b699b'

// A fresh key per seed. Dev logins use email and password, so nothing needs to know it.
const newPartnerApiKey = () => randomBytes(48).toString('base64url')

const isLeakedKey = (apiKey: string | null) =>
  apiKey !== null &&
  createHash('sha256').update(apiKey).digest('hex') === LEAKED_PARTNER_API_KEY_SHA256

export async function seedPartnerUser(prisma: PrismaClient) {
  if (!process.env.BCRYPT_SALT) {
    throw new Error('BCRYPT_SALT is not defined')
  }

  const userSalt = parseSalt(process.env.BCRYPT_SALT)

  console.log('Seeding partner user...')

  const email = `opencourier-partner@opencourier.com`
  const pwd = `partnerUser@123`
  const existingUser = await prisma.user.findUnique({
    where: {
      email,
    },
  })

  if (existingUser) {
    console.log(`User with email ${email} already exists. Skipping...`)

    if (isLeakedKey(existingUser.apiKey)) {
      await prisma.user.update({
        where: { id: existingUser.id },
        data: { apiKey: newPartnerApiKey() },
      })
      console.log(`Replaced the leaked upstream API key for ${email}.`)
    }

    const existsInPartnerDB = await prisma.partner.findFirst({
      where: {
        userId: existingUser.id,
      },
    })

    if (!existsInPartnerDB) {
      await createOnDb(prisma, existingUser.id)
    }
    return
  }

  const user = await prisma.user.create({
    data: {
      email,
      password: await hash(pwd, userSalt),
      role: [EnumUserRole.PARTNER],
      apiKey: newPartnerApiKey(),
    },
  })

  const partnerDB = await createOnDb(prisma, user.id)

  console.log(`Created partner "${partnerDB.name}" with email "${user.email}"`)
}

const createOnDb = async (prisma: PrismaClient, userId: string) => {
  return await prisma.partner.create({
    data: {
      name: 'Nosh',
      logo: 'http://localhost:1231/assets/partner-logo.png',
      phoneNumber: `+${Math.floor(Math.random() * 10000000000)}`,
      webhookUrl: 'http://localhost:3000/v1/courier/webhooks',
      userId: userId,
    },
  })
}
