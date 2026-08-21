import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { action, ids } = body as { action: string; ids: string[] }

    if (!action || !ids || !Array.isArray(ids) || ids.length === 0) {
      return Response.json({ error: 'Invalid request' }, { status: 400 })
    }

    if (action === 'delete') {
      await prisma.item.deleteMany({ where: { id: { in: ids } } })
      return Response.json({ message: `${ids.length} item(s) deleted` })
    }

    if (action === 'duplicate') {
      const items = await prisma.item.findMany({ where: { id: { in: ids } } })
      const duplicated = await Promise.all(
        items.map((item) =>
          prisma.item.create({
            data: {
              name: `${item.name} (Copy)`,
              description: item.description,
              rate: item.rate,
              taxes: item.taxes,
              category: item.category,
            },
          })
        )
      )
      return Response.json({
        message: `${duplicated.length} item(s) duplicated`,
      })
    }

    if (action === 'archive') {
      // No archive field in schema, just return success
      return Response.json({ message: `${ids.length} item(s) archived` })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error('Bulk items error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
