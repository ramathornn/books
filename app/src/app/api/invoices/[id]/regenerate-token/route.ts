import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { generateShareToken } from '@/lib/utils'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  try {
    const existing = await prisma.invoice.findUnique({ where: { id } })
    if (!existing) {
      return Response.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const newToken = generateShareToken()

    const invoice = await prisma.invoice.update({
      where: { id },
      data: { shareToken: newToken },
    })

    return Response.json({ shareToken: invoice.shareToken })
  } catch (error) {
    console.error('Regenerate token error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
