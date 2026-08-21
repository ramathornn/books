import 'dotenv/config'
import { PrismaClient } from '../src/generated/prisma/client'

const prisma = new PrismaClient()

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, email: true, name: true } })
  console.log('Current users:', JSON.stringify(users))

  const targetEmail = process.env.OLD_ADMIN_EMAIL || 'old-admin@example.com'
  const deleted = await prisma.user.deleteMany({ where: { email: targetEmail } })
  console.log(`Deleted old ${targetEmail}:`, deleted.count)

  const remaining = await prisma.user.findMany({ select: { id: true, email: true, name: true } })
  console.log('Remaining users:', JSON.stringify(remaining))

  await prisma.$disconnect()
}

main()
