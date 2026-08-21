import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { formatInvoiceNumber } from '@/lib/utils'

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const lastInvoice = await prisma.invoice.findFirst({
    orderBy: { invoiceNumber: 'desc' },
    select: { invoiceNumber: true },
  })

  const nextNum = lastInvoice
    ? parseInt(lastInvoice.invoiceNumber, 10) + 1
    : 1

  return Response.json({ nextNumber: formatInvoiceNumber(nextNum) })
}
