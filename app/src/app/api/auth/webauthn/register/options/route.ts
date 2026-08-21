import { NextRequest } from 'next/server'
import { generateRegistrationOptions } from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import {
  RP_NAME,
  REG_CHALLENGE_COOKIE,
  getRpId,
  setChallengeCookie,
} from '@/lib/webauthn'

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true },
  })
  if (!user) {
    return Response.json({ error: 'User not found' }, { status: 404 })
  }

  const existing = await prisma.authenticator.findMany({
    where: { userId: user.id },
    select: { credentialId: true, transports: true },
  })

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: getRpId(request),
    userID: user.id,
    userName: user.email,
    userDisplayName: user.name,
    attestationType: 'none',
    excludeCredentials: existing.map((a) => ({
      id: isoBase64URL.toBuffer(a.credentialId),
      type: 'public-key' as const,
      transports: a.transports
        ? (a.transports.split(',') as AuthenticatorTransport[])
        : undefined,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  })

  await setChallengeCookie(REG_CHALLENGE_COOKIE, options.challenge)

  return Response.json(options)
}
