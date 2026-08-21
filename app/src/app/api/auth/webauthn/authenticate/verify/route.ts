import { NextRequest } from 'next/server'
import { randomBytes } from 'crypto'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import prisma from '@/lib/prisma'
import {
  AUTH_CHALLENGE_COOKIE,
  getOrigin,
  getRpId,
  readChallengeCookie,
  clearChallengeCookie,
} from '@/lib/webauthn'

const LOGIN_TOKEN_TTL_MS = 60_000

export async function POST(request: NextRequest) {
  const expectedChallenge = await readChallengeCookie(AUTH_CHALLENGE_COOKIE)
  if (!expectedChallenge) {
    return Response.json(
      { error: 'Sign-in expired. Please try again.' },
      { status: 400 }
    )
  }

  const body = await request.json()
  const credentialId: string | undefined = body?.id

  if (!credentialId) {
    await clearChallengeCookie(AUTH_CHALLENGE_COOKIE)
    return Response.json({ error: 'Invalid passkey response.' }, { status: 400 })
  }

  const authenticator = await prisma.authenticator.findUnique({
    where: { credentialId },
    include: { user: { select: { id: true, email: true } } },
  })

  if (!authenticator) {
    await clearChallengeCookie(AUTH_CHALLENGE_COOKIE)
    return Response.json(
      { error: 'This passkey is not registered.' },
      { status: 400 }
    )
  }

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: getOrigin(request),
      expectedRPID: getRpId(request),
      requireUserVerification: false,
      authenticator: {
        credentialID: isoBase64URL.toBuffer(authenticator.credentialId),
        credentialPublicKey: new Uint8Array(authenticator.publicKey),
        counter: authenticator.counter,
        transports: authenticator.transports
          ? (authenticator.transports.split(',') as AuthenticatorTransport[])
          : undefined,
      },
    })
  } catch {
    await clearChallengeCookie(AUTH_CHALLENGE_COOKIE)
    return Response.json(
      { error: 'Passkey could not be verified.' },
      { status: 400 }
    )
  }

  await clearChallengeCookie(AUTH_CHALLENGE_COOKIE)

  if (!verification.verified) {
    return Response.json({ error: 'Passkey sign-in failed.' }, { status: 400 })
  }

  await prisma.authenticator.update({
    where: { id: authenticator.id },
    data: {
      counter: verification.authenticationInfo.newCounter,
      lastUsedAt: new Date(),
    },
  })

  // One-time token consumed by the NextAuth credentials provider to mint a session.
  const token = randomBytes(32).toString('base64url')
  await prisma.webauthnLoginToken.create({
    data: {
      token,
      userId: authenticator.user.id,
      expiresAt: new Date(Date.now() + LOGIN_TOKEN_TTL_MS),
    },
  })

  return Response.json({ ok: true, email: authenticator.user.email, token })
}
