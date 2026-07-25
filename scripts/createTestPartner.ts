import { config as loadEnv } from 'dotenv'
loadEnv()

import { randomBytes } from 'crypto'
import { EnumUserRole, PrismaClient } from '@prisma/types'
import { hash } from 'bcryptjs'

const prisma = new PrismaClient()

const PARTNER_NAME = 'Volos Test Kitchen'
const PARTNER_EMAIL = 'volos-partner@opencourier.com'
const PARTNER_PASSWORD = 'partnerUser@123'

async function main() {
  const rounds = Number(process.env.BCRYPT_SALT)
  if (!rounds) {
    throw new Error('BCRYPT_SALT is not defined / not numeric')
  }

  const existing = await prisma.user.findUnique({ where: { email: PARTNER_EMAIL } })
  if (existing) {
    const partner = await prisma.partner.findFirst({ where: { userId: existing.id } })
    console.log(`Partner user ${PARTNER_EMAIL} already exists (partner: ${partner?.name}).`)
    console.log(`Existing API key: ${existing.apiKey}`)
    return
  }

  // Fresh, unique API key for this test partner.
  const apiKey = randomBytes(48).toString('base64url')

  const user = await prisma.user.create({
    data: {
      email: PARTNER_EMAIL,
      password: await hash(PARTNER_PASSWORD, rounds),
      role: [EnumUserRole.PARTNER],
      apiKey,
    },
  })

  const partner = await prisma.partner.create({
    data: {
      name: PARTNER_NAME,
      logo: 'http://localhost:3000/assets/partner-logo.png',
      phoneNumber: `+3024210${Math.floor(10000 + Math.random() * 89999)}`,
      webhookUrl: 'http://localhost:3000/v1/courier/webhooks',
      userId: user.id,
    },
  })

  console.log('Created test partner:')
  console.log(`  name:     ${partner.name}`)
  console.log(`  email:    ${user.email}`)
  console.log(`  password: ${PARTNER_PASSWORD}`)
  console.log(`  API key:  ${apiKey}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
