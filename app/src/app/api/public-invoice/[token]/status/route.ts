import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const invoice = await prisma.invoice.findUnique({
    where: { shareToken: token },
    select: {
      status: true,
      amountPaid: true,
      amountDue: true,
      total: true,
      currency: true,
    },
  })

  if (!invoice) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({
    status: invoice.status,
    amountPaid: Number(invoice.amountPaid),
    amountDue: Number(invoice.amountDue),
    total: Number(invoice.total),
    currency: invoice.currency,
  })
}
