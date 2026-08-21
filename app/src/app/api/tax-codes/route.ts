import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = request.nextUrl.searchParams
  const appliesTo = sp.get('appliesTo') // sale | purchase | both

  const where: Record<string, unknown> = { isArchived: false }
  if (appliesTo) {
    where.OR = [{ appliesTo }, { appliesTo: 'both' }]
  }

  const codes = await prisma.taxCode.findMany({
    where,
    orderBy: { code: 'asc' },
  })
  return Response.json({ data: codes })
}
