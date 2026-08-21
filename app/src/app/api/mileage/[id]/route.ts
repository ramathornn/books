import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { audit } from '@/lib/audit'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  await prisma.mileage.update({ where: { id }, data: { isArchived: true } })
  await audit({ entityType: 'mileage', entityId: id, action: 'archive', summary: 'Mileage entry archived' })
  return Response.json({ ok: true })
}
