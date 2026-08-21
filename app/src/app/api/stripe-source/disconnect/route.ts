import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

// Remove a Stripe revenue-source connection. Deletes the row (and with it the
// encrypted key). Posted journal entries are independent of the connection and
// are left untouched.
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const connectionId = String(body.connectionId || '').trim()
  if (!connectionId) return Response.json({ error: 'connectionId required' }, { status: 400 })

  await prisma.stripeConnection.deleteMany({ where: { id: connectionId } })
  return Response.json({ ok: true })
}
