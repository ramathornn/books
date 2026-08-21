import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { itemSchema } from '@/lib/validators'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const item = await prisma.item.findUnique({
    where: { id },
  })

  if (!item) {
    return Response.json({ error: 'Item not found' }, { status: 404 })
  }

  return Response.json(item)
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  try {
    const existing = await prisma.item.findUnique({ where: { id } })
    if (!existing) {
      return Response.json({ error: 'Item not found' }, { status: 404 })
    }

    const body = await request.json()
    const parsed = itemSchema.safeParse(body)

    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const item = await prisma.item.update({
      where: { id },
      data: parsed.data,
    })

    return Response.json(item)
  } catch (error) {
    console.error('Update item error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const existing = await prisma.item.findUnique({ where: { id } })
  if (!existing) {
    return Response.json({ error: 'Item not found' }, { status: 404 })
  }

  await prisma.item.delete({ where: { id } })

  return Response.json({ message: 'Item deleted successfully' })
}
