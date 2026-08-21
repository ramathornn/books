import { NextRequest } from 'next/server'
import { verifyRegistrationResponse } from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import {
  REG_CHALLENGE_COOKIE,
  getOrigin,
  getRpId,
  readChallengeCookie,
  clearChallengeCookie,
} from '@/lib/webauthn'

function deviceNameFromUA(ua: string): string {
  if (/iPhone|iPad|iOS/i.test(ua)) return 'iPhone / iPad (Face ID)'
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac (Touch ID)'
  if (/Android/i.test(ua)) return 'Android device'
  if (/Windows/i.test(ua)) return 'Windows (Hello)'
  return 'Passkey'
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const expectedChallenge = await readChallengeCookie(REG_CHALLENGE_COOKIE)
  if (!expectedChallenge) {
    return Response.json(
      { error: 'Passkey setup expired. Please try again.' },
      { status: 400 }
    )
  }

  const body = await request.json()

  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: getOrigin(request),
      expectedRPID: getRpId(request),
      requireUserVerification: false,
    })
  } catch {
    await clearChallengeCookie(REG_CHALLENGE_COOKIE)
    return Response.json(
      { error: 'Passkey could not be verified.' },
      { status: 400 }
    )
  }

  await clearChallengeCookie(REG_CHALLENGE_COOKIE)

  if (!verification.verified || !verification.registrationInfo) {
    return Response.json(
      { error: 'Passkey verification failed.' },
      { status: 400 }
    )
  }

  const { credentialID, credentialPublicKey, counter } =
    verification.registrationInfo
  const credentialId = isoBase64URL.fromBuffer(credentialID)

  const transports: string = Array.isArray(body?.response?.transports)
    ? body.response.transports.join(',')
    : ''

  await prisma.authenticator.create({
    data: {
      credentialId,
      publicKey: Buffer.from(credentialPublicKey),
      counter,
      transports,
      deviceName: deviceNameFromUA(request.headers.get('user-agent') || ''),
      userId: session.user.id,
    },
  })

  return Response.json({ verified: true })
}
