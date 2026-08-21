import { NextRequest } from 'next/server'
import { generateAuthenticationOptions } from '@simplewebauthn/server'
import {
  AUTH_CHALLENGE_COOKIE,
  getRpId,
  setChallengeCookie,
} from '@/lib/webauthn'

export async function POST(request: NextRequest) {
  const options = await generateAuthenticationOptions({
    rpID: getRpId(request),
    userVerification: 'preferred',
    // Empty allowCredentials → the browser offers the user's discoverable
    // passkeys for this site (one-tap, no email needed).
    allowCredentials: [],
  })

  await setChallengeCookie(AUTH_CHALLENGE_COOKIE, options.challenge)

  return Response.json(options)
}
