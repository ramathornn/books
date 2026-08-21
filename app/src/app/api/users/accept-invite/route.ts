import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import prisma from '@/lib/prisma'
import { audit } from '@/lib/audit'

// Accept a user invite (anonymous; the single-use token IS the credential).
// Creates the User with the invite's role and consumes the invite atomically —
// two racing accepts cannot both win (the update is guarded on acceptedAt).
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const token = String(body.token ?? '').trim()
  const name = String(body.name ?? '').trim()
  const password = String(body.password ?? '')

  if (!/^[a-f0-9]{64}$/.test(token)) {
    return Response.json({ error: 'Invalid invite token.' }, { status: 400 })
  }
  if (!name) {
    return Response.json({ error: 'Your name is required.' }, { status: 400 })
  }
  if (password.length < 12) {
    return Response.json({ error: 'Password must be at least 12 characters.' }, { status: 400 })
  }

  const invite = await prisma.userInvite.findUnique({ where: { token } })
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    return Response.json({ error: 'This invite link is invalid or has expired.' }, { status: 410 })
  }

  const existing = await prisma.user.findUnique({ where: { email: invite.email } })
  if (existing) {
    return Response.json({ error: 'An account with this email already exists. Sign in instead.' }, { status: 409 })
  }

  const hashedPassword = await bcrypt.hash(password, 12)

  const user = await prisma.$transaction(async (tx) => {
    // Consume the invite first with an acceptedAt guard — a concurrent accept
    // sees count 0 and aborts, so the token is strictly single-use.
    const consumed = await tx.userInvite.updateMany({
      where: { id: invite.id, acceptedAt: null },
      data: { acceptedAt: new Date() },
    })
    if (consumed.count === 0) {
      throw Object.assign(new Error('This invite link is invalid or has expired.'), { code: 'INVITE_CONSUMED' })
    }
    return tx.user.create({
      data: {
        name,
        email: invite.email,
        hashedPassword,
        role: invite.role,
      },
      select: { id: true, email: true, role: true },
    })
  }).catch((e: Error & { code?: string }) => {
    if (e.code === 'INVITE_CONSUMED') return null
    throw e
  })

  if (!user) {
    return Response.json({ error: 'This invite link is invalid or has expired.' }, { status: 410 })
  }

  await audit({
    entityType: 'user',
    entityId: user.id,
    action: 'create',
    summary: `Invite accepted — ${user.email} (${user.role})`,
    metadata: { inviteId: invite.id, role: user.role },
  })

  return Response.json({ ok: true, email: user.email }, { status: 201 })
}
