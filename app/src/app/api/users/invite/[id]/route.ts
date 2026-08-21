import { NextRequest } from 'next/server'
import { requireOwner } from '@/lib/requireOwner'
import prisma from '@/lib/prisma'
import { audit } from '@/lib/audit'

// Revoke a pending invite (owner-only). Accepted invites are history — 409.
export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await requireOwner()
  if (!gate.ok) return Response.json({ error: gate.error }, { status: gate.status })
  const { id } = await context.params

  const invite = await prisma.userInvite.findUnique({ where: { id } })
  if (!invite) return Response.json({ error: 'Invite not found' }, { status: 404 })
  if (invite.acceptedAt) {
    return Response.json({ error: 'Invite was already accepted; remove the user instead.' }, { status: 409 })
  }

  await prisma.userInvite.delete({ where: { id } })
  await audit({
    entityType: 'user',
    entityId: id,
    action: 'delete',
    summary: `Invite revoked for ${invite.email}`,
    metadata: { email: invite.email, role: invite.role },
  })
  return Response.json({ ok: true })
}
