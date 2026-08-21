import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { estimateSchema } from '@/lib/validators'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const estimate = await prisma.estimate.findUnique({
    where: { id },
    include: {
      client: true,
      lineItems: { orderBy: { sortOrder: 'asc' } },
    },
  })

  if (!estimate) {
    return Response.json({ error: 'Estimate not found' }, { status: 404 })
  }

  return Response.json(estimate)
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
    const existing = await prisma.estimate.findUnique({ where: { id } })
    if (!existing) {
      return Response.json({ error: 'Estimate not found' }, { status: 404 })
    }

    const body = await request.json()

    // Handle status-only updates (Mark as Accepted/Declined/Archived)
    if (body.status && !body.lineItems) {
      const estimate = await prisma.estimate.update({
        where: { id },
        data: { status: body.status },
        include: {
          client: true,
          lineItems: { orderBy: { sortOrder: 'asc' } },
        },
      })
      return Response.json(estimate)
    }

    const parsed = estimateSchema.safeParse(body)

    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { clientId, currency, dateIssued, lineItems, description, notes, terms } = parsed.data

    // Verify client exists
    const client = await prisma.client.findUnique({ where: { id: clientId } })
    if (!client) {
      return Response.json({ error: 'Client not found' }, { status: 404 })
    }

    // Calculate totals
    const calculatedLineItems = lineItems.map((li, index) => {
      const lineTotal = li.rate * li.quantity
      return {
        title: li.title,
        description: li.description,
        rate: li.rate,
        quantity: li.quantity,
        lineTotal,
        taxCodes: li.taxCodes,
        sortOrder: index,
      }
    })

    const subtotal = calculatedLineItems.reduce((sum, li) => sum + li.lineTotal, 0)

    let taxTotal = 0
    for (const li of calculatedLineItems) {
      if (li.taxCodes.length > 0) {
        for (const code of li.taxCodes) {
          if (code.toUpperCase().includes('GST')) {
            taxTotal += li.lineTotal * 0.05
          }
        }
      }
    }

    const total = subtotal + taxTotal

    // Delete existing line items and recreate
    await prisma.estimateLineItem.deleteMany({ where: { estimateId: id } })

    const estimate = await prisma.estimate.update({
      where: { id },
      data: {
        clientId,
        currency,
        dateIssued: new Date(dateIssued),
        subtotal,
        taxTotal,
        total,
        description: description || '',
        notes: notes || '',
        terms: terms || '',
        lineItems: {
          create: calculatedLineItems,
        },
      },
      include: {
        client: true,
        lineItems: { orderBy: { sortOrder: 'asc' } },
      },
    })

    return Response.json(estimate)
  } catch (error) {
    console.error('Update estimate error:', error)
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

  const existing = await prisma.estimate.findUnique({ where: { id } })
  if (!existing) {
    return Response.json({ error: 'Estimate not found' }, { status: 404 })
  }

  // Line items will be cascade deleted
  await prisma.estimate.delete({ where: { id } })

  return Response.json({ message: 'Estimate deleted successfully' })
}
