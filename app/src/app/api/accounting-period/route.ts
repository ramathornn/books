import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { getPeriodLock, setPeriodLock } from '@/lib/periodLock'
import { audit } from '@/lib/audit'

export async function GET() {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const lock = await getPeriodLock()
  return Response.json(lock)
}

export async function PUT(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  let lockedThrough: Date | null = null
  if (body.lockedThrough) {
    lockedThrough = new Date(String(body.lockedThrough))
    if (isNaN(lockedThrough.getTime())) {
      return Response.json({ error: 'Invalid lockedThrough date' }, { status: 400 })
    }
  }

  const userId = (session.user as { id?: string }).id ?? null
  const lock = await setPeriodLock({
    lockedThrough,
    userId,
    notes: body.notes || '',
  })
  await audit({
    entityType: 'period_lock',
    entityId: 'singleton',
    action: lockedThrough ? 'lock' : 'unlock',
    summary: lockedThrough
      ? `Books locked through ${lockedThrough.toISOString().slice(0, 10)}`
      : 'Period lock removed',
    metadata: { notes: body.notes || '' },
  })
  return Response.json(lock)
}
