import { NextRequest } from 'next/server'
import { TOTP, Secret } from 'otpauth'
import QRCode from 'qrcode'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

// GET — generate a new TOTP secret + QR code (for setup)
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, totpEnabled: true },
  })

  if (!user) {
    return Response.json({ error: 'User not found' }, { status: 404 })
  }

  if (user.totpEnabled) {
    return Response.json({ error: 'TOTP is already enabled' }, { status: 400 })
  }

  // Generate a new secret
  const secret = new Secret({ size: 20 })

  const totp = new TOTP({
    issuer: 'Books',
    label: user.email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  })

  const otpauthUrl = totp.toString()
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl)

  // Store the secret temporarily (not enabled yet — user must verify first)
  await prisma.user.update({
    where: { id: session.user.id },
    data: { totpSecret: secret.base32 },
  })

  return Response.json({
    secret: secret.base32,
    qrCode: qrCodeDataUrl,
    otpauthUrl,
  })
}

// POST — verify TOTP code and enable 2FA
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { code } = body

  if (!code || typeof code !== 'string' || code.length !== 6) {
    return Response.json({ error: 'Invalid code. Enter a 6-digit code.' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { totpSecret: true, totpEnabled: true },
  })

  if (!user || !user.totpSecret) {
    return Response.json({ error: 'No TOTP setup in progress. Start setup first.' }, { status: 400 })
  }

  if (user.totpEnabled) {
    return Response.json({ error: 'TOTP is already enabled.' }, { status: 400 })
  }

  const totp = new TOTP({
    secret: user.totpSecret,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  })

  const delta = totp.validate({ token: code, window: 1 })

  if (delta === null) {
    return Response.json({ error: 'Invalid code. Please try again.' }, { status: 400 })
  }

  // Enable TOTP
  await prisma.user.update({
    where: { id: session.user.id },
    data: { totpEnabled: true },
  })

  return Response.json({ success: true, message: 'Two-factor authentication enabled.' })
}

// DELETE — disable TOTP
export async function DELETE(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { code } = body

  if (!code || typeof code !== 'string' || code.length !== 6) {
    return Response.json({ error: 'Enter your current TOTP code to disable 2FA.' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { totpSecret: true, totpEnabled: true },
  })

  if (!user || !user.totpEnabled || !user.totpSecret) {
    return Response.json({ error: 'TOTP is not enabled.' }, { status: 400 })
  }

  const totp = new TOTP({
    secret: user.totpSecret,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  })

  const delta = totp.validate({ token: code, window: 1 })

  if (delta === null) {
    return Response.json({ error: 'Invalid code. Cannot disable 2FA without a valid code.' }, { status: 400 })
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { totpEnabled: false, totpSecret: null },
  })

  return Response.json({ success: true, message: 'Two-factor authentication disabled.' })
}
