import { requireOwner } from '@/lib/requireOwner'
import prisma from '@/lib/prisma'

// Users & Access (Settings) — owner-only listing of users + pending invites.
export async function GET() {
  const gate = await requireOwner()
  if (!gate.ok) return Response.json({ error: gate.error }, { status: gate.status })

  const [users, invites] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.userInvite.findMany({
      where: { acceptedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, email: true, role: true, token: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  return Response.json({ users, invites })
}
