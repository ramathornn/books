import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const activities = await prisma.invoiceActivity.findMany({
    where: { invoiceId: id },
    orderBy: { createdAt: 'desc' },
  })

  return Response.json({ data: activities })
}
