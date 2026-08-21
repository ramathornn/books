import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { clientSchema } from '@/lib/validators'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      invoices: {
        orderBy: { dateIssued: 'desc' },
        include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
      },
      estimates: {
        orderBy: { dateIssued: 'desc' },
        include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
      },
      payments: {
        orderBy: { paymentDate: 'desc' },
      },
    },
  })

  if (!client) {
    return Response.json({ error: 'Client not found' }, { status: 404 })
  }

  return Response.json(client)
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
    const existing = await prisma.client.findUnique({ where: { id } })
    if (!existing) {
      return Response.json({ error: 'Client not found' }, { status: 404 })
    }

    const body = await request.json()
    const parsed = clientSchema.safeParse(body)

    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const client = await prisma.client.update({
      where: { id },
      data: parsed.data,
    })

    return Response.json(client)
  } catch (error) {
    console.error('Update client error:', error)
    const msg = error instanceof Error ? error.message : 'Internal server error'
    return Response.json({ error: msg }, { status: 500 })
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

  const existing = await prisma.client.findUnique({ where: { id } })
  if (!existing) {
    return Response.json({ error: 'Client not found' }, { status: 404 })
  }

  // Check for related records
  const [invoiceCount, estimateCount] = await Promise.all([
    prisma.invoice.count({ where: { clientId: id } }),
    prisma.estimate.count({ where: { clientId: id } }),
  ])

  if (invoiceCount > 0 || estimateCount > 0) {
    return Response.json(
      {
        error: 'Cannot delete client with existing invoices or estimates. Remove them first.',
        counts: { invoices: invoiceCount, estimates: estimateCount },
      },
      { status: 409 }
    )
  }

  await prisma.client.delete({ where: { id } })

  return Response.json({ message: 'Client deleted successfully' })
}
