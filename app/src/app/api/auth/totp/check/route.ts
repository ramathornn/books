import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import prisma from '@/lib/prisma'

// POST — check if a user has TOTP enabled AND validate password
// Returns { totpRequired, passwordValid } without creating a session
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { email, password } = body

  if (!email || typeof email !== 'string') {
    return Response.json({ totpRequired: false, passwordValid: false })
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { totpEnabled: true, hashedPassword: true },
  })

  if (!user) {
    // Don't reveal if user exists — simulate timing
    await bcrypt.hash('dummy', 12)
    return Response.json({ totpRequired: false, passwordValid: false })
  }

  // If password provided, validate it
  if (password) {
    const isValid = await bcrypt.compare(password, user.hashedPassword)
    if (!isValid) {
      return Response.json({ totpRequired: false, passwordValid: false })
    }
    return Response.json({ totpRequired: user.totpEnabled, passwordValid: true })
  }

  // No password — just check if TOTP is enabled (don't reveal)
  return Response.json({ totpRequired: user.totpEnabled, passwordValid: false })
}
