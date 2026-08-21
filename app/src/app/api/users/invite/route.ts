import crypto from 'node:crypto'
import { NextRequest } from 'next/server'
import { requireOwner } from '@/lib/requireOwner'
import prisma from '@/lib/prisma'
import { audit } from '@/lib/audit'

const INVITE_TTL_DAYS = 7
const VALID_ROLES = new Set(['owner', 'accountant'])
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Create a user invite (owner-only). Returns the single-use accept URL — the
// app sends no email; the owner shares the link out-of-band.
export async function POST(request: NextRequest) {
  const gate = await requireOwner()
  if (!gate.ok) return Response.json({ error: gate.error }, { status: gate.status })

  const body = await request.json().catch(() => ({}))
  const email = String(body.email ?? '').trim().toLowerCase()
  const role = String(body.role ?? 'accountant')

  if (!EMAIL_RE.test(email)) {
    return Response.json({ error: 'A valid email is required.' }, { status: 400 })
  }
  if (!VALID_ROLES.has(role)) {
    return Response.json({ error: `Role must be one of: ${[...VALID_ROLES].join(', ')}.` }, { status: 400 })
  }

  const existingUser = await prisma.user.findUnique({ where: { email } })
  if (existingUser) {
    return Response.json({ error: 'A user with this email already exists.' }, { status: 409 })
  }

  // One live invite per email — replace any pending one so the newest link wins.
  await prisma.userInvite.deleteMany({ where: { email, acceptedAt: null } })

  const token = crypto.randomBytes(32).toString('hex')
  const invite = await prisma.userInvite.create({
    data: {
      email,
      role,
      token,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  })

  await audit({
    entityType: 'user',
    entityId: invite.id,
    action: 'create',
    summary: `Invite created for ${email} (${role})`,
    metadata: { email, role, expiresAt: invite.expiresAt.toISOString() },
  })

  return Response.json(
    {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt.toISOString(),
      inviteUrl: `${request.nextUrl.origin}/invite/${token}`,
    },
    { status: 201 }
  )
}
